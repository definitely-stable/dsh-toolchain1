import { decodeStagedFinalAnswer } from './staged-provider-transport.mjs'

const MAX_ATTEMPTS = 2
const RETRYABLE_INFRASTRUCTURE = Object.freeze(new Set(['provider-transport', 'tool-transport']))

export const STAGED_DEVELOPMENT_SYSTEM_PROMPT = `You are evaluating public APIs on one exact installed DeepSeek Harness target. Use only evidence and tools available in this run; do not rely on newer-version knowledge. Answer the task by making exactly one concrete public-API existence or absence claim. When you have enough evidence, call submit_staged_result exactly once with the task id and claim. The structured result function is the only accepted final answer; do not finish with prose.`

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`)
  return value
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function providerUsage(metadata) {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return { inputTokens: 0, outputTokens: 0 }
  return {
    inputTokens: nonNegativeInteger(metadata.inputTokens),
    outputTokens: nonNegativeInteger(metadata.outputTokens),
  }
}

function exactManifest(frozen, arm) {
  if (arm !== 'B' && arm !== 'C') throw new Error('staged development executor is B/C only')
  const manifests = requireRecord(frozen.capabilityManifests, 'staged frozen capability manifests')
  const manifest = manifests[arm]
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`staged frozen capability manifest ${arm} is missing`)
  }
  if (manifest.arm !== arm) throw new Error(`staged frozen capability manifest ${arm} arm drifted`)
  return manifest
}

function assertTask(call, task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task) || task.id !== call.taskId) {
    throw new Error(`staged provider executor task invariant failed for ${call.taskId}`)
  }
  if (typeof task.prompt !== 'string' || task.prompt.trim().length === 0) {
    throw new Error(`staged provider executor task ${call.taskId} requires a prompt`)
  }
}

function retryable(result, attempt) {
  return attempt < MAX_ATTEMPTS
    && result.kind === 'infrastructure-failure'
    && RETRYABLE_INFRASTRUCTURE.has(result.reason)
}

/**
 * Adapts the existing isolated process executor + exact P0 B/C tool runtime to
 * the one-dispatch development runner. It does not touch the historical H1 run
 * store or ledger; every call/retry receives a fresh runtime identity.
 *
 * @param {{
 *   frozen: Record<string, any>;
 *   runtime: {
 *     createModelEnvelope: Function;
 *     createFrozenP0ToolRuntime: Function;
 *     executeProcessModelAttempt: Function;
 *   };
 *   processConfiguration: Record<string, any>;
 *   sha256Utf8: (value:string) => Promise<string>;
 *   now?: () => number;
 * }} input
 */
export function createStagedProviderExecutor(input) {
  const frozen = requireRecord(input?.frozen, 'staged frozen runtime')
  const runtime = requireRecord(input?.runtime, 'staged provider runtime')
  const createModelEnvelope = requireFunction(runtime.createModelEnvelope, 'runtime.createModelEnvelope')
  const createFrozenP0ToolRuntime = requireFunction(runtime.createFrozenP0ToolRuntime, 'runtime.createFrozenP0ToolRuntime')
  const executeProcessModelAttempt = requireFunction(runtime.executeProcessModelAttempt, 'runtime.executeProcessModelAttempt')
  const sha256Utf8 = requireFunction(input?.sha256Utf8, 'staged sha256Utf8')
  const processConfiguration = requireRecord(input?.processConfiguration, 'staged process configuration')
  const workspace = requireRecord(frozen.workspace, 'staged exact workspace')
  const now = typeof input.now === 'function' ? input.now : Date.now

  return async function execute(call, task) {
    if (call === null || typeof call !== 'object' || Array.isArray(call)) throw new Error('staged provider call must be an object')
    assertTask(call, task)
    const manifest = exactManifest(frozen, call.arm)
    const envelope = createModelEnvelope({
      systemPrompt: STAGED_DEVELOPMENT_SYSTEM_PROMPT,
      task: { id: task.id, prompt: task.prompt },
      staticContext: [],
      capabilityManifest: manifest,
    })

    let attempts = 0
    let infrastructureFailures = 0
    let wallTimeMs = 0
    let inputTokens = 0
    let outputTokens = 0
    let modelToolCalls = 0

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1
      const runtimeIdentity = await sha256Utf8([
        'dsh-toolchain-staged-development-attempt-v1',
        String(call.ordinal),
        call.taskId,
        call.arm,
        String(call.repetition),
        String(attempts),
      ].join('\u0000'))
      const toolRuntime = await createFrozenP0ToolRuntime(runtimeIdentity, workspace)
      if (
        toolRuntime === null
        || typeof toolRuntime !== 'object'
        || typeof toolRuntime.dispatchToolCall !== 'function'
        || typeof toolRuntime.traceReceipt !== 'function'
      ) {
        throw new Error('staged exact tool runtime is incomplete')
      }

      const startedAt = now()
      const result = await executeProcessModelAttempt({
        ...processConfiguration,
        envelope,
        dispatchToolCall: request => toolRuntime.dispatchToolCall(request),
      })
      wallTimeMs += Math.max(0, now() - startedAt)

      const trace = await toolRuntime.traceReceipt()
      if (trace !== null && typeof trace === 'object' && Array.isArray(trace.entries)) {
        modelToolCalls += trace.entries.length
      }

      if (result.kind === 'model-outcome') {
        const usage = providerUsage(result.providerMetadata)
        inputTokens += usage.inputTokens
        outputTokens += usage.outputTokens
        const decoded = decodeStagedFinalAnswer(result.finalAnswer)
        return Object.freeze({
          ...decoded,
          attempts,
          infrastructureFailures,
          wallTimeMs,
          usage: Object.freeze({
            inputTokens,
            outputTokens,
            turns: modelToolCalls + 1,
          }),
          toolUsage: Object.freeze({
            calls: modelToolCalls,
            structuredTransportCalls: decoded.transportStatus === 'ok' ? 1 : 0,
          }),
        })
      }

      infrastructureFailures += 1
      if (!retryable(result, attempts)) {
        return Object.freeze({
          transportStatus: 'infrastructure-failure',
          attempts,
          infrastructureFailures,
          wallTimeMs,
          usage: Object.freeze({ inputTokens, outputTokens, turns: modelToolCalls }),
          toolUsage: Object.freeze({ calls: modelToolCalls, structuredTransportCalls: 0 }),
        })
      }
    }

    throw new Error('staged provider executor exhausted an unreachable retry state')
  }
}
