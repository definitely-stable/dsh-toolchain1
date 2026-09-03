export const STAGED_RESULT_TOOL_NAME = 'submit_staged_result'
const RESULT_SCHEMA = 'dsh-toolchain-staged-eval-result-v1'
const TRANSPORT_SCHEMA = 'dsh-toolchain-staged-provider-transport-v1'

export function createStagedResultToolDefinition() {
  return Object.freeze({
    type: 'function',
    function: Object.freeze({
      name: STAGED_RESULT_TOOL_NAME,
      description: 'Submit the final structured measurement result for this evaluation task. Do not answer in prose after calling this function.',
      strict: true,
      parameters: Object.freeze({
        type: 'object',
        additionalProperties: false,
        required: Object.freeze(['schema', 'taskId', 'claims']),
        properties: Object.freeze({
          schema: Object.freeze({ type: 'string', const: RESULT_SCHEMA }),
          taskId: Object.freeze({ type: 'string', minLength: 1 }),
          claims: Object.freeze({
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: Object.freeze({
              type: 'object',
              additionalProperties: false,
              required: Object.freeze(['package', 'symbol', 'assertion']),
              properties: Object.freeze({
                package: Object.freeze({ type: 'string', minLength: 1 }),
                symbol: Object.freeze({ type: 'string', minLength: 1 }),
                assertion: Object.freeze({ type: 'string', enum: Object.freeze(['exists', 'absent']) }),
              }),
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

export function appendStagedResultTool(productTools) {
  if (!Array.isArray(productTools)) throw new Error('staged product tools must be an array')
  if (productTools.some(tool => providerToolName(tool) === STAGED_RESULT_TOOL_NAME)) {
    throw new Error(`product capability manifest uses reserved measurement tool ${STAGED_RESULT_TOOL_NAME}`)
  }
  return Object.freeze([...productTools, createStagedResultToolDefinition()])
}

export function encodeStagedToolResult(value) {
  return JSON.stringify({
    schema: TRANSPORT_SCHEMA,
    kind: 'structured-tool',
    payload: value,
  })
}

export function routeStagedProviderToolCalls(calls) {
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

  return Object.freeze({
    kind: 'final',
    finalAnswer: encodeStagedToolResult(measurement.input),
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
  ) {
    return Object.freeze({ transportStatus: 'unsupported' })
  }

  return Object.freeze({
    transportStatus: 'ok',
    structuredContent: decoded.payload,
  })
}
