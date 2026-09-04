import {
  createCanonicalStagedResult,
  PACKAGE_CLAIM_PATTERN_SOURCE,
  SYMBOL_PATTERN_SOURCE,
} from './staged-result-contract.mjs'

export const STAGED_RESULT_TOOL_NAME = 'submit_staged_result'
const TRANSPORT_SCHEMA = 'dsh-toolchain-staged-provider-transport-v1'
const TRANSPORT_KEYS = new Set(['schema', 'kind', 'payload', 'metrics'])
const TRANSPORT_METRIC_KEYS = new Set(['providerCompletions', 'measurementToolCalls'])

export function createStagedResultToolDefinition() {
  return Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: STAGED_RESULT_TOOL_NAME,
      description: 'Submit exactly one final structured measurement claim for this evaluation task. Experiment identity is attached by the evaluator transport.',
      strict: true,
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['claim']),
        properties: Object.freeze({
          claim: Object.freeze({
            type: 'object',
            additionalProperties: false,
            required: Object.freeze(['package', 'symbol', 'assertion']),
            properties: Object.freeze({
              package: Object.freeze({ type: 'string', pattern: PACKAGE_CLAIM_PATTERN_SOURCE }),
              symbol: Object.freeze({ type: 'string', pattern: SYMBOL_PATTERN_SOURCE }),
              assertion: Object.freeze({ type: 'string', enum: Object.freeze(['exists', 'absent']) }),
            }),
          }),
        }),
      }),
    }),
  })
}

function providerToolName(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const fn = value.function
  if (fn === null || typeof fn !== 'object' || Array.isArray(fn)) return undefined
  return typeof fn.name === 'string' ? fn.name : undefined
}

export function assertNoStagedResultToolCollision(productTools) {
  if (!Array.isArray(productTools)) throw new Error('staged product tools must be an array')
  if (productTools.some(tool => providerToolName(tool) === STAGED_RESULT_TOOL_NAME)) {
    throw new Error(`product capability manifest uses reserved measurement tool ${STAGED_RESULT_TOOL_NAME}`)
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return value
}

function transportMetrics(value) {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('staged transport metrics must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!TRANSPORT_METRIC_KEYS.has(key)) throw new Error(`staged transport metrics contain unknown key: ${key}`)
  }
  return Object.freeze({
    providerCompletions: nonNegativeInteger(value.providerCompletions, 'providerCompletions'),
    measurementToolCalls: nonNegativeInteger(value.measurementToolCalls, 'measurementToolCalls'),
  })
}

export function encodeStagedToolResult(value, metrics) {
  const normalizedMetrics = transportMetrics(metrics)
  return JSON.stringify({
    schema: TRANSPORT_SCHEMA,
    kind: 'structured-tool',
    payload: value,
    ...(normalizedMetrics === undefined ? {} : { metrics: normalizedMetrics }),
  })
}

export function routeStagedProviderToolCalls(calls, taskId, metrics) {
  if (!Array.isArray(calls) || calls.length === 0) throw new Error('staged provider tool calls must be a non-empty array')
  const measurementCalls = calls.filter(call => (
    call !== null
    && typeof call === 'object'
    && !Array.isArray(call)
    && call.name === STAGED_RESULT_TOOL_NAME
  ))

  if (measurementCalls.length === 0) {
    return Object.freeze({ kind: 'product', calls })
  }
  if (calls.length !== 1 || measurementCalls.length !== 1) {
    return Object.freeze({
      kind: 'unsupported',
      reason: 'measurement call must be the only tool call in its provider turn',
    })
  }

  const measurement = measurementCalls[0]
  if (measurement.kind === 'invalid-arguments') {
    return Object.freeze({
      kind: 'unsupported',
      reason: 'measurement call arguments were not valid JSON',
    })
  }
  if (measurement.kind !== 'call' || !Object.hasOwn(measurement, 'input')) {
    return Object.freeze({
      kind: 'unsupported',
      reason: 'measurement call did not use the expected function-call shape',
    })
  }

  let canonical
  try {
    canonical = createCanonicalStagedResult(taskId, measurement.input)
  } catch {
    return Object.freeze({
      kind: 'unsupported',
      reason: 'measurement call did not satisfy the canonical claim contract',
    })
  }

  return Object.freeze({
    kind: 'final',
    finalAnswer: encodeStagedToolResult(canonical, metrics),
  })
}

export function decodeStagedFinalAnswer(value) {
  if (typeof value !== 'string' || value.length === 0) return Object.freeze({ transportStatus: 'unsupported' })

  let decoded
  try {
    decoded = JSON.parse(value)
  } catch {
    return Object.freeze({ transportStatus: 'unsupported' })
  }
  if (
    decoded === null
    || typeof decoded !== 'object'
    || Array.isArray(decoded)
    || decoded.schema !== TRANSPORT_SCHEMA
    || decoded.kind !== 'structured-tool'
    || !Object.hasOwn(decoded, 'payload')
    || Object.keys(decoded).some(key => !TRANSPORT_KEYS.has(key))
  ) {
    return Object.freeze({ transportStatus: 'unsupported' })
  }

  let metrics
  try {
    metrics = transportMetrics(decoded.metrics)
  } catch {
    return Object.freeze({ transportStatus: 'unsupported' })
  }

  return Object.freeze({
    transportStatus: 'ok',
    structuredContent: decoded.payload,
    ...(metrics === undefined ? {} : { transportMetrics: metrics }),
  })
}
