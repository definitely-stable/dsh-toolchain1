import { H2_POLICY } from './h2-config.mjs'

export const H2_RECEIPT_SCHEMA = 'dsh-toolchain-h2-observation-receipt-v1'

const FORBIDDEN_RECEIPT_KEYS = new Set([
  'prompt', 'promptText', 'taskPrompt', 'reasoning', 'reasoningContent', 'chainOfThought', 'chain_of_thought',
  'arguments', 'rawInput', 'rawOutput', 'rawArguments', 'toolArguments', 'assistantText', 'modelText',
  'text', 'content', 'message', 'messages', 'transcript', 'credentials', 'apiKey', 'api_key', 'secret', 'token',
])

const SECRET_VALUE_PATTERN = /sk-[A-Za-z0-9_-]{8,}|DEEPSEEK_API_KEY\s*=|BEGIN [A-Z ]*PRIVATE KEY/
const MAX_RECEIPT_STRING_LENGTH = 8192

/** Toolchain-owned model-facing tools are classified by the frozen prefix. */
export function classifyToolName(name) {
  return typeof name === 'string' && name.startsWith(H2_POLICY.toolchainToolPrefix) ? 'toolchain' : 'ordinary'
}

/**
 * Parses the append-only session JSONL written under `$DSH_HOME/sessions`.
 * This is the authoritative telemetry plane: the ACP wire is the control
 * plane and cannot be trusted for exact per-completion usage.
 */
export function parseSessionLog(text) {
  if (typeof text !== 'string') throw new Error('session log must be text')
  const records = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch (cause) {
      throw new Error('session log contains a non-JSON line', { cause })
    }
    records.push(parsed)
  }

  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, providerCompletions: 0 }
  const perTool = {}
  const requestIdentities = []
  const responseModels = []
  let turns = 0
  let terminalReason = null
  let usageFromMessages = 0
  let usageFromChunks = 0

  for (const entry of records) {
    if (entry === null || typeof entry !== 'object') continue
    const data = entry.data ?? {}
    switch (entry.type) {
      case 'turn/start':
        turns += 1
        break
      case 'turn/end':
        terminalReason = data.reason?.kind ?? terminalReason
        break
      case 'request/header': {
        // The identity of a request lives under `data.header.config` in the
        // frozen train's log (`session.v3.jsonl`), not under `data.config`. The
        // distinction is not cosmetic: reading the wrong path yields no request
        // identity at all, and every observation is then reported as model
        // identity drift — blaming the model for a harness bug.
        const config = data.header?.config
        if (config !== undefined && config !== null) {
          requestIdentities.push({
            provider: config.provider,
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? null,
          })
        }
        break
      }
      case 'assistant/message': {
        if (data.usage !== undefined) {
          addUsage(usage, data.usage)
          usageFromMessages += 1
        }
        const source = data.message?.source
        if (source?.model !== undefined) responseModels.push(source.model)
        break
      }
      case 'assistant/chunk': {
        if (data.type === 'usage' && data.usage !== undefined) {
          addUsage(usage, data.usage)
          usageFromChunks += 1
        }
        break
      }
      case 'tool/call': {
        const name = typeof data.name === 'string' ? data.name : 'unknown'
        perTool[name] = (perTool[name] ?? 0) + 1
        break
      }
      default:
        break
    }
  }

  // Per-completion usage lives on `assistant/message`. Only fall back to
  // chunk-level usage when no message-level usage was recorded at all, so a
  // stream that emits both is never double counted.
  if (usageFromMessages === 0 && usageFromChunks > 0) {
    usage.providerCompletions = usageFromChunks
  } else {
    usage.providerCompletions = usageFromMessages
  }
  if (usage.totalTokens === 0) usage.totalTokens = usage.inputTokens + usage.outputTokens

  const toolNames = Object.keys(perTool).sort()
  let toolchainToolCalls = 0
  let ordinaryToolCalls = 0
  for (const [name, count] of Object.entries(perTool)) {
    if (classifyToolName(name) === 'toolchain') toolchainToolCalls += count
    else ordinaryToolCalls += count
  }

  const sortedPerTool = {}
  for (const name of toolNames) sortedPerTool[name] = perTool[name]

  return Object.freeze({
    records: Object.freeze(records),
    metrics: Object.freeze({
      providerCompletions: usage.providerCompletions,
      turns,
      terminalReason,
      usage: Object.freeze({ ...usage }),
      tools: Object.freeze({
        totalToolCalls: toolchainToolCalls + ordinaryToolCalls,
        ordinaryToolCalls,
        toolchainToolCalls,
        perTool: Object.freeze(sortedPerTool),
      }),
      modelIdentities: Object.freeze({
        request: Object.freeze(dedupe(requestIdentities)),
        responseModels: Object.freeze([...new Set(responseModels)].sort()),
      }),
    }),
  })
}

function addUsage(target, usage) {
  target.inputTokens += numberOrZero(usage.inputTokens)
  target.outputTokens += numberOrZero(usage.outputTokens)
  target.totalTokens += numberOrZero(usage.totalTokens)
  target.cachedInputTokens += numberOrZero(usage.cacheReadTokens)
  target.cacheWriteTokens += numberOrZero(usage.cacheWriteTokens)
  target.reasoningTokens += numberOrZero(usage.reasoningTokens)
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function dedupe(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = `${item.provider}\u0000${item.model}\u0000${item.reasoningEffort}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/**
 * Fails closed when a real observation did not run exactly the frozen model
 * identity in both arms. A mid-run model snapshot change invalidates the
 * comparison, so the run must STOP instead of mixing snapshots.
 */
export function assertModelIdentityMatches({ frozen, observed }) {
  const requests = observed?.request ?? []
  const responseModels = observed?.responseModels ?? []
  const matchesFrozen = request =>
    request.provider === frozen.provider
    && request.model === frozen.model
    && (request.reasoningEffort === null || request.reasoningEffort === frozen.reasoningEffort)
  if (requests.length === 0 || responseModels.length === 0 || !requests.every(matchesFrozen)
    || responseModels.some(model => model !== frozen.model)) {
    throw new Error(`model identity drift: observed ${JSON.stringify(observed)} does not match frozen ${JSON.stringify(frozen)}`)
  }
  return true
}

/**
 * Builds the sanitized observation receipt. Only whitelisted operational
 * metadata is retained; prompts, model prose, chain-of-thought, raw tool
 * arguments/results, workspace contents, and credentials never enter.
 */
export function buildObservationReceipt({
  runId, taskId, stratum, arm, attempt, terminalReason, budgetExhausted, success,
  grader, metrics, wallTimeMs, stopReason, usageUpdates, workspaceDigestBefore, workspaceDigestAfter, acpToolCalls,
  identityDrift = false, telemetry = null,
}) {
  const requestIdentity = metrics.modelIdentities.request[0] ?? { provider: null, model: null, reasoningEffort: null }
  return Object.freeze({
    schema: H2_RECEIPT_SCHEMA,
    runId, taskId, stratum, arm, attempt,
    terminalReason, budgetExhausted, success,
    identityDrift,
    // Whether the authoritative telemetry plane was actually read. This is kept
    // separate from the identity verdict on purpose: an unreadable session log
    // used to be reported as a model-identity drift, which blames the model for
    // a harness failure and still yields a "resolved" observation.
    telemetry: Object.freeze({
      resolved: telemetry?.resolved === true,
      error: telemetry?.error ?? null,
    }),
    grader: Object.freeze({
      status: grader.status,
      checks: Object.freeze((grader.checks ?? []).map(check => Object.freeze({ name: check.name, status: check.status }))),
    }),
    identity: Object.freeze({
      provider: requestIdentity.provider,
      requestModel: requestIdentity.model,
      responseModel: metrics.modelIdentities.responseModels[0] ?? null,
      reasoningEffort: requestIdentity.reasoningEffort,
      systemFingerprint: null,
      revision: null,
    }),
    usage: Object.freeze({
      inputTokens: metrics.usage.inputTokens,
      outputTokens: metrics.usage.outputTokens,
      totalTokens: metrics.usage.totalTokens,
      cachedInputTokens: metrics.usage.cachedInputTokens,
      cacheWriteTokens: metrics.usage.cacheWriteTokens,
      reasoningTokens: metrics.usage.reasoningTokens,
      providerCompletions: metrics.usage.providerCompletions,
    }),
    timing: Object.freeze({ wallTimeMs, agentSteps: metrics.providerCompletions, turns: metrics.turns }),
    tools: Object.freeze({
      totalToolCalls: metrics.tools.totalToolCalls,
      ordinaryToolCalls: metrics.tools.ordinaryToolCalls,
      toolchainToolCalls: metrics.tools.toolchainToolCalls,
      perTool: metrics.tools.perTool,
      acpObservedToolCalls: acpToolCalls ?? null,
    }),
    workspace: Object.freeze({ digestBefore: workspaceDigestBefore, digestAfter: workspaceDigestAfter }),
    acp: Object.freeze({ stopReason, usageUpdates }),
  })
}

/** Structural + value scan proving a receipt carries no hidden or secret data. */
export function assertReceiptSanitized(receipt) {
  visit(receipt, [])
  return true

  function visit(value, path) {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      if (value.length > MAX_RECEIPT_STRING_LENGTH) throw new Error(`receipt string exceeds maximum length at ${path.join('.')}`)
      if (SECRET_VALUE_PATTERN.test(value)) throw new Error(`receipt contains a secret-shaped value at ${path.join('.')}`)
      return
    }
    if (typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]))
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_RECEIPT_KEYS.has(key)) throw new Error(`receipt contains forbidden field "${key}" at ${path.join('.')}`)
      visit(child, [...path, key])
    }
  }
}