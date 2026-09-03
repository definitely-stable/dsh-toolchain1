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

export function encodeStagedToolResult(value) {
  return JSON.stringify({
    schema: TRANSPORT_SCHEMA,
    kind: 'structured-tool',
    payload: value,
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
