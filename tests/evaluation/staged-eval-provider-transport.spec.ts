import { describe, expect, it } from 'vitest'

import {
  createStagedResultToolDefinition,
  decodeStagedFinalAnswer,
  encodeStagedToolResult,
  STAGED_RESULT_TOOL_NAME,
} from '../../scripts/eval/staged-provider-transport.mjs'

describe('staged provider result transport', () => {
  it('defines one strict final-result function with the canonical claim schema', () => {
    expect(STAGED_RESULT_TOOL_NAME).toBe('submit_staged_result')
    expect(createStagedResultToolDefinition()).toEqual({
      type: 'function',
      function: {
        name: 'submit_staged_result',
        description: expect.stringMatching(/final structured measurement result/i),
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['schema', 'taskId', 'claims'],
          properties: {
            schema: { type: 'string', const: 'dsh-toolchain-staged-eval-result-v1' },
            taskId: { type: 'string', minLength: 1 },
            claims: {
              type: 'array',
              minItems: 1,
              maxItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['package', 'symbol', 'assertion'],
                properties: {
                  package: { type: 'string', minLength: 1 },
                  symbol: { type: 'string', minLength: 1 },
                  assertion: { type: 'string', enum: ['exists', 'absent'] },
                },
              },
            },
          },
        },
      },
    })
  })

  it('round-trips an explicit tool result into transportStatus ok', () => {
    const payload = {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: 'task-01',
      claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
    }

    expect(decodeStagedFinalAnswer(encodeStagedToolResult(payload))).toEqual({
      transportStatus: 'ok',
      structuredContent: payload,
    })
  })

  it('treats free prose as unsupported instead of attempting recovery', () => {
    expect(decodeStagedFinalAnswer('API_CLAIM package=@deepseek-ai/dsh-scope symbol=Scope assertion=exists')).toEqual({
      transportStatus: 'unsupported',
    })
    expect(decodeStagedFinalAnswer('{"schema":"dsh-toolchain-staged-eval-result-v1"}')).toEqual({
      transportStatus: 'unsupported',
    })
  })

  it('preserves malformed structured-tool payloads for downstream format adjudication', () => {
    expect(decodeStagedFinalAnswer(encodeStagedToolResult({ unexpected: true }))).toEqual({
      transportStatus: 'ok',
      structuredContent: { unexpected: true },
    })
  })
})
