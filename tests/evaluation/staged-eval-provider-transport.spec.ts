import { describe, expect, it } from 'vitest'

import {
  appendStagedResultTool,
  createStagedResultToolDefinition,
  decodeStagedFinalAnswer,
  encodeStagedToolResult,
  routeStagedProviderToolCalls,
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

  it('adds the same measurement function after product tools without changing them', () => {
    const productTools = [{
      type: 'function',
      function: { name: 'ordinary_read', description: 'read', parameters: { type: 'object' } },
    }]

    expect(appendStagedResultTool(productTools)).toEqual([
      productTools[0],
      createStagedResultToolDefinition(),
    ])
    expect(productTools).toHaveLength(1)
    expect(() => appendStagedResultTool([createStagedResultToolDefinition()])).toThrow(/reserved measurement tool/i)
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

  it('routes a sole measurement call to a terminal wrapper without dispatching it as a product tool', () => {
    const payload = {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: 'task-01',
      claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
    }
    const routed = routeStagedProviderToolCalls([{
      kind: 'call',
      id: 'measurement-1',
      name: STAGED_RESULT_TOOL_NAME,
      input: payload,
    }])

    expect(routed.kind).toBe('final')
    if (routed.kind !== 'final') throw new Error('expected terminal measurement route')
    expect(decodeStagedFinalAnswer(routed.finalAnswer)).toEqual({
      transportStatus: 'ok',
      structuredContent: payload,
    })
  })

  it('leaves ordinary B/C product tool calls untouched', () => {
    const calls = [{ kind: 'call' as const, id: 'tool-1', name: 'ordinary_read', input: { path: 'README.md' } }]
    expect(routeStagedProviderToolCalls(calls)).toEqual({ kind: 'product', calls })
  })

  it('fails measurement routing closed when final-result and product calls are mixed or malformed', () => {
    const measurement = {
      kind: 'call' as const,
      id: 'measurement-1',
      name: STAGED_RESULT_TOOL_NAME,
      input: { schema: 'dsh-toolchain-staged-eval-result-v1', taskId: 'task-01', claims: [] },
    }
    const product = { kind: 'call' as const, id: 'tool-1', name: 'ordinary_read', input: {} }

    expect(routeStagedProviderToolCalls([product, measurement])).toEqual({
      kind: 'unsupported',
      reason: 'measurement call must be the only tool call in its provider turn',
    })
    expect(routeStagedProviderToolCalls([{
      kind: 'invalid-arguments',
      id: 'measurement-2',
      name: STAGED_RESULT_TOOL_NAME,
    }])).toEqual({
      kind: 'unsupported',
      reason: 'measurement call arguments were not valid JSON',
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
