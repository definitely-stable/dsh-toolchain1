import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'

import { H2_POLICY, H2_REASONING_EFFORTS } from './h2-config.mjs'

export const ACP_PROTOCOL_VERSION = 1

/** Minimal, frozen ACP v1 method surface used by the H2 controller. */
export const ACP_METHODS = Object.freeze({
  initialize: 'initialize',
  authenticate: 'authenticate',
  sessionNew: 'session/new',
  sessionPrompt: 'session/prompt',
  sessionCancel: 'session/cancel',
  sessionClose: 'session/close',
  sessionSetConfigOption: 'session/set_config_option',
  sessionUpdate: 'session/update',
  requestPermission: 'session/request_permission',
})

/** The client advertises no filesystem/terminal authority: DSH owns the workspace. */
export const ACP_CLIENT_CAPABILITIES = Object.freeze({
  fs: Object.freeze({ readTextFile: false, writeTextFile: false }),
  terminal: false,
  auth: Object.freeze({ terminal: false }),
})

/**
 * Frozen permission policy: both arms answer identically, and the answer is
 * always `reject`.
 *
 * The benchmark measures what an agent can do inside its own workspace. DSH
 * fences writes to the session workspace but not reads, and the file tools
 * advertise a `sandbox_permissions` escalation; auto-allowing requests would
 * let a single preemptive escalation write outside the workspace — including
 * over another observation's data. Denying keeps the fence authoritative, is
 * identical in both arms, and costs the task nothing because in-workspace work
 * needs no permission at all.
 */
export const H2_PERMISSION_POLICY = 'reject'

const REASONING_EFFORTS = H2_REASONING_EFFORTS

export class AcpError extends Error {
  /** @param {string} message @param {{code?: number, method?: string}} [options] */
  constructor(message, { code, method } = {}) {
    super(message)
    this.name = 'AcpError'
    this.code = code
    this.method = method
  }
}

/** Fail-closed argument validation for the two pinned session config options. */
export function validateConfigOption({ configId, value }) {
  if (configId !== 'model' && configId !== 'reasoning_effort') throw new Error(`unsupported ACP config option: ${configId}`)
  if (typeof value !== 'string' || value.length === 0) throw new Error('ACP config option value must be a non-empty string')
  if (configId === 'reasoning_effort' && !REASONING_EFFORTS.includes(value)) {
    throw new Error(`unsupported reasoning effort: ${value}`)
  }
  return true
}

/**
 * The ACP `model` option is a select whose value is the JSON pair
 * `["<provider>","<model>"]`, not a bare model id: sending the bare id is
 * rejected by the target with `unknown model option`, and the target never
 * falls back to the default model, so mistaking the shape fails every
 * observation at its first request.
 *
 * @param {{provider: string, model: string}} model
 */
export function modelConfigOptionValue({ provider, model }) {
  for (const [label, value] of [['provider', provider], ['model', model]]) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`ACP model option requires a non-empty ${label}`)
  }
  return JSON.stringify([provider, model])
}

/**
 * Proves the pinned route is actually offered by the target session before any
 * model token is spent. The option list is the target's own catalog, so a
 * missing pair means the frozen route cannot run here at all — a loud stop
 * instead of a run that silently executes on a different model.
 *
 * @param {{configOptions: any[], value: string}} input
 */
export function assertModelOptionAdvertised({ configOptions, value }) {
  if (!Array.isArray(configOptions)) throw new Error('ACP session did not advertise any config options')
  const option = configOptions.find(candidate => candidate?.id === 'model')
  if (option === undefined) throw new Error('ACP session does not advertise a model config option')
  const values = []
  for (const group of option.options ?? []) {
    for (const entry of group?.options ?? []) values.push(entry?.value)
  }
  if (!values.includes(value)) {
    throw new Error(`the target does not offer the frozen model option ${value}; it offers ${values.join(', ')}`)
  }
  return true
}

/**
 * Frozen auto-answer policy for `session/request_permission`. `allow` prefers
 * an always-allow option so a long task cannot stall on repeated prompts;
 * both arms use the same policy, so the difference between them stays zero.
 */
export function choosePermissionOption(options, policy = H2_PERMISSION_POLICY) {
  if (!Array.isArray(options) || options.length === 0) return Object.freeze({ outcome: Object.freeze({ outcome: 'cancelled' }) })
  const preferred = policy === 'allow' ? ['allow_always', 'allow_once'] : ['reject_once', 'reject_always']
  const selected = options.find(option => preferred.includes(option?.kind)) ?? options[0]
  return Object.freeze({ outcome: Object.freeze({ outcome: 'selected', optionId: selected.optionId }) })
}

/**
 * ACP v1 control plane: drives one real DSH agent session over an injected
 * transport. The transport is object-level (`send`/`onFrame`), so the whole
 * protocol flow is unit-testable against an in-memory agent and the same
 * code drives the real NDJSON stdio server in a dry-run.
 *
 * @param {{transport: {send: (frame: any) => void, onFrame: (handler: (frame: any) => void) => void,
 *   onExit?: (handler: (result: {code: number | null, signal: string | null, error: any}) => void) => void},
 *   permissionPolicy?: string, onPermissionDecision?: (decision: {requestedKinds: any[], selectedKind: string|null}) => void}} input
 */
export function createAcpControlPlane({ transport, permissionPolicy = H2_PERMISSION_POLICY, onPermissionDecision }) {
  if (transport === null || typeof transport !== 'object') throw new Error('ACP control plane requires a transport')
  let nextId = 1
  const pending = new Map()
  const toolCalls = []
  const toolCallsById = new Map()
  const updates = { toolCalls, usageUpdates: 0, messageChunks: 0, thoughtChunks: 0, otherUpdates: 0 }
  let sessionConfigOptions = []

  function request(method, params) {
    const id = nextId
    nextId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method })
      transport.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  function respondResult(id, result) {
    transport.send({ jsonrpc: '2.0', id, result })
  }

  function respondError(id, code, message) {
    transport.send({ jsonrpc: '2.0', id, error: { code, message } })
  }

  // A transport that dies before answering would otherwise leave the caller
  // awaiting a promise that cannot settle, which turns a launcher that cannot
  // even start into an indefinite hang instead of a loud failure.
  if (typeof transport.onExit === 'function') {
    transport.onExit(({ code, signal, error }) => {
      if (pending.size === 0) return
      const detail = error === null || error === undefined
        ? `code=${String(code)} signal=${String(signal)}`
        : String(error.message ?? error)
      for (const [id, entry] of [...pending]) {
        pending.delete(id)
        entry.reject(new AcpError(`ACP process exited before "${entry.method}" was answered (${detail})`, { method: entry.method }))
      }
    })
  }

  transport.onFrame(frame => {    if (frame === null || typeof frame !== 'object') return
    const hasMethod = typeof frame.method === 'string'
    const hasId = frame.id !== undefined && frame.id !== null

    if (!hasMethod && hasId) {
      const entry = pending.get(frame.id)
      if (entry === undefined) return
      pending.delete(frame.id)
      if (frame.error !== undefined) {
        entry.reject(new AcpError(frame.error?.message ?? 'ACP request failed', { code: frame.error?.code, method: entry.method }))
      } else {
        entry.resolve(frame.result)
      }
      return
    }

    if (hasMethod && hasId) {
      if (frame.method === ACP_METHODS.requestPermission) {
        const options = frame.params?.options ?? []
        const answer = /** @type {{outcome: {outcome: string, optionId?: string}}} */ (choosePermissionOption(options, permissionPolicy))
        if (typeof onPermissionDecision === 'function') {
          onPermissionDecision({
            requestedKinds: options.map(/** @param {any} option */ option => option?.kind),
            selectedKind: options.find(/** @param {any} option */ option => option?.optionId === answer.outcome.optionId)?.kind ?? null,
          })
        }
        respondResult(frame.id, answer)
        return
      }
      respondError(frame.id, -32601, `unsupported agent request: ${frame.method}`)
      return
    }

    if (hasMethod && !hasId) {
      if (frame.method !== ACP_METHODS.sessionUpdate) {
        updates.otherUpdates += 1
        return
      }
      const update = frame.params?.update
      if (update === null || typeof update !== 'object') return
      switch (update.sessionUpdate) {
        case 'tool_call':
        case 'tool_call_update': {
          const toolCallId = update.toolCallId
          if (typeof toolCallId !== 'string') return
          const existing = toolCallsById.get(toolCallId)
          if (existing !== undefined) {
            if (existing.name === 'unknown' && typeof update.name === 'string') existing.name = update.name
            return
          }
          const record = { toolCallId, name: typeof update.name === 'string' ? update.name : 'unknown', kind: typeof update.kind === 'string' ? update.kind : 'other' }
          toolCallsById.set(toolCallId, record)
          toolCalls.push(record)
          return
        }
        case 'usage_update':
          updates.usageUpdates += 1
          return
        case 'agent_message_chunk':
          updates.messageChunks += 1
          return
        case 'agent_thought_chunk':
          updates.thoughtChunks += 1
          return
        default:
          updates.otherUpdates += 1
      }
    }
  })

  return {
    updates,
    async initialize() {
      return request(ACP_METHODS.initialize, { protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: ACP_CLIENT_CAPABILITIES })
    },
    async authenticate(methodId) {
      return request(ACP_METHODS.authenticate, { methodId })
    },
    async newSession({ cwd }) {
      if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error(`ACP session cwd must be an absolute path: ${String(cwd)}`)
      const response = await request(ACP_METHODS.sessionNew, { cwd, mcpServers: [] })
      sessionConfigOptions = Array.isArray(response?.configOptions) ? response.configOptions : []
      return response
    },
    async setConfigOption({ sessionId, configId, value }) {
      validateConfigOption({ configId, value })
      if (sessionConfigOptions.length > 0 && !sessionConfigOptions.some(option => option?.id === configId)) {
        throw new Error(`ACP session does not advertise config option ${configId}`)
      }
      return request(ACP_METHODS.sessionSetConfigOption, { sessionId, configId, value })
    },
    async prompt({ sessionId, text }) {
      if (typeof text !== 'string' || text.length === 0) throw new Error('ACP prompt must be non-empty text')
      return request(ACP_METHODS.sessionPrompt, { sessionId, prompt: [{ type: 'text', text }] })
    },
    cancel(sessionId) {
      transport.send({ jsonrpc: '2.0', method: ACP_METHODS.sessionCancel, params: { sessionId } })
    },
    async closeSession(sessionId) {
      return request(ACP_METHODS.sessionClose, { sessionId })
    },
    pendingRequestCount() {
      return pending.size
    },
  }
}

/**
 * Frozen budget guard. The provider-completion limit is enforced live from
 * the append-only session log during a run; wall time is enforced from the
 * controller clock. Exhaustion is a product outcome, not an infrastructure
 * failure.
 *
 * The guard reads exactly these two limits out of the frozen resource policy,
 * so a caller may hand it the whole policy or just those fields.
 *
 * @param {{policy?: {providerCompletionsLimit: number, wallTimeLimitMs: number},
 *   now?: () => number}} [input]
 */
export function createBudgetGuard({ policy = H2_POLICY.resource, now = () => Date.now() } = {}) {
  const startedAt = now()
  let completions = 0
  return {
    recordCompletion() {
      completions += 1
    },
    get completions() {
      return completions
    },
    elapsedMs() {
      return now() - startedAt
    },
    evaluate() {
      if (completions > policy.providerCompletionsLimit) return Object.freeze({ exhausted: true, reason: 'PROVIDER_COMPLETIONS' })
      if (now() - startedAt >= policy.wallTimeLimitMs) return Object.freeze({ exhausted: true, reason: 'WALL_TIME' })
      return Object.freeze({ exhausted: false, reason: null })
    },
  }
}

/** Maps an ACP stop reason plus any controller budget trigger to the frozen terminal surface. */
export function classifyTerminal({ stopReason, budgetReason }) {
  if (budgetReason !== null && budgetReason !== undefined) {
    return Object.freeze({ terminalReason: 'RESOURCE_EXHAUSTED', gradeable: true, budgetExhausted: true })
  }
  switch (stopReason) {
    case 'end_turn':
      return Object.freeze({ terminalReason: 'COMPLETED', gradeable: true, budgetExhausted: false })
    case 'max_tokens':
    case 'max_turn_requests':
      return Object.freeze({ terminalReason: 'RESOURCE_EXHAUSTED', gradeable: true, budgetExhausted: true })
    case 'cancelled':
      return Object.freeze({ terminalReason: 'CANCELLED', gradeable: false, budgetExhausted: false })
    case 'refusal':
      return Object.freeze({ terminalReason: 'REFUSAL', gradeable: true, budgetExhausted: false })
    default:
      return Object.freeze({ terminalName: undefined, terminalReason: 'INFRASTRUCTURE_FAILURE', gradeable: false, budgetExhausted: false })
  }
}

/**
 * Quotes an argument for a `cmd.exe` command line. `spawn({shell: true})`
 * concatenates arguments without escaping them, so an argument that contains
 * whitespace or a quote must be quoted here or the launcher would silently
 * receive a different argv than the harness recorded.
 */
function quoteForShell(arg) {
  return /[\s"^&|<>]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/**
 * Real NDJSON stdio transport for `dsh --profile acp`. The `acp` profile
 * reserves stdout for ACP frames; stderr is captured to a bounded tail for
 * diagnostics only.
 *
 * Windows resolves the launcher to a `.cmd` shim (`pnpm.cmd`), and Node refuses
 * to spawn a batch file without a shell, so the default is to go through the
 * platform shell there. `pnpm` writes its own echo of the command it runs to
 * stderr, never to stdout, so the protocol channel stays pure.
 *
 * @param {{command: string, args: readonly string[], env: Record<string, string | undefined>, cwd: string,
 *   spawnImpl?: (command: string, args: string[], options: any) => any, stderrLimitBytes?: number,
 *   shell?: boolean}} input
 */
export function createProcessAcpTransport({
  command, args, env, cwd, spawnImpl = spawnProcess, stderrLimitBytes = 64 * 1024,
  shell = process.platform === 'win32',
}) {
  const argv = shell ? args.map(quoteForShell) : args
  const child = /** @type {any} */ (spawnImpl(command, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell }))
  if (child.error) throw child.error
  const handlers = []
  const exitHandlers = []
  const state = { stdout: '', stderr: '', exited: false, exitCode: null, exitSignal: null, spawnError: null }
  let resolveExit
  const exitPromise = new Promise(resolve => {
    resolveExit = resolve
  })

  function settleExit(result) {
    for (const handler of exitHandlers) handler(result)
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    state.stdout += chunk
    let index = state.stdout.indexOf('\n')
    while (index >= 0) {
      const line = state.stdout.slice(0, index).replace(/\r$/, '')
      state.stdout = state.stdout.slice(index + 1)
      if (line.trim().length > 0) {
        let frame
        try {
          frame = JSON.parse(line)
        } catch {
          state.spawnError = new Error(`ACP stdout produced a non-JSON frame: ${line.slice(0, 200)}`)
          frame = null
        }
        if (frame !== null) for (const handler of handlers) handler(frame)
      }
      index = state.stdout.indexOf('\n')
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    state.stderr = `${state.stderr}${chunk}`
    if (state.stderr.length > stderrLimitBytes) state.stderr = state.stderr.slice(-stderrLimitBytes)
  })
  child.on('error', error => {
    state.spawnError = error
    state.exited = true
    settleExit({ code: null, signal: null, error })
    resolveExit({ code: null, signal: null, error })
  })
  child.on('exit', (code, signal) => {
    state.exited = true
    state.exitCode = code
    state.exitSignal = signal
    settleExit({ code, signal, error: null })
    resolveExit({ code, signal, error: null })
  })

  return {
    send(frame) {
      if (state.exited) throw new AcpError('ACP process already exited')
      child.stdin.write(`${JSON.stringify(frame)}\n`)
    },
    onFrame(handler) {
      handlers.push(handler)
    },
    onExit(handler) {
      exitHandlers.push(handler)
    },
    exitPromise,
    state,
    stderrTail() {
      return state.stderr
    },
    async terminate({ graceMs = 5_000 } = {}) {
      if (state.exited) return
      try {
        child.stdin.end()
      } catch {
        // stdin already closed
      }
      const timer = setTimeout(() => {
        if (state.exited) return
        if (process.platform === 'win32' && typeof child.pid === 'number') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } else {
          child.kill('SIGKILL')
        }
      }, graceMs)
      await exitPromise
      clearTimeout(timer)
    },
  }
}