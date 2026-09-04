import { describe, expect, it } from 'vitest'

import {
  assertNoStagedResultToolCollision,
  createStagedResultToolDefinition,
  decodeStagedFinalAnswer,
  encodeStagedToolResult,
  routeStagedProviderToolCalls,
  STAGED_RESULT_TOOL_NAME,
} from '../../scripts/eval/staged-provider-transport.mjs'

describe('staged provider result transport', () => {
  it('defines one strict measurement-only function whose provider input contains only the semantic claim', () => {
    expect(STAGED_RESULT_TOOL_NAME).toBe('submit_staged_result')
    expect(createStagedResultToolDefinition()).toEqual({
      type: 'function',
      function: {
        name: 'submit_staged_result',
        description: expect.stringMatching(/measurement claim/i),
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['claim'],
          properties: {
            claim: {
              type: 'object',
              additionalProperties: false,
              required: ['package', 'symbol', 'assertion'],
              properties: {
                package: {
                  type: 'string',
                  pattern: '^(?:\\*|@?[A-Za-z0-9][A-Za-z0-9._-]*(?:/[A-Za-z0-9][A-Za-z0-9._-]*)?)$',
                },
                symbol: {
                  type: 'string',
                  pattern: '^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*$',
                },
                assertion: { type: 'string', enum: ['exists', 'absent'] },
              },
            },
          },
        },
      },
    })
  })

  it('keeps experiment identity outside model-controlled arguments and attaches it at the transport boundary', () => {
    const routed = routeStagedProviderToolCalls([{
      kind: 'call',
      id: 'measurement-1',
      name: STAGED_RESULT_TOOL_NAME,
      input: {
        claim: { package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' },
      },
    }], 'task-01')

    expect(routed.kind).toBe('final')
    if (routed.kind !== 'final') throw new Error('expected terminal measurement route')
    expect(decodeStagedFinalAnswer(routed.finalAnswer)).toEqual({
      transportStatus: 'ok',
      structuredContent: {
        schema: 'dsh-toolchain-staged-eval-result-v1',
        taskId: 'task-01',
        claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
      },
    })
  })

  it('rejects invalid measurement claims before they become canonical staged results', () => {
    const invalid = routeStagedProviderToolCalls([{
      kind: 'call',
      id: 'measurement-1',
      name: STAGED_RESULT_TOOL_NAME,
      input: {
        claim: { package: 'not a package name', symbol: 'Scope', assertion: 'exists' },
      },
    }], 'task-01')

    expect(invalid).toEqual({
      kind: 'unsupported',
      reason: 'measurement call did not satisfy the canonical claim contract',
    })
  })

  it('keeps ordinary B/C product tool calls untouched and reserves the measurement name', () => {
    const product = { kind: 'call' as const, id: 'tool-1', name: 'ordinary_read', input: { path: 'README.md' } }
    expect(routeStagedProviderToolCalls([product], 'task-01')).toEqual({ kind: 'product', calls: [product] })

    const productTools = [{
      type: 'function',
      function: { name: 'ordinary_read', description: 'read', parameters: { type: 'object' } },
    }]
    expect(() => assertNoStagedResultToolCollision(productTools)).not.toThrow()
    expect(() => assertNoStagedResultToolCollision([createStagedResultToolDefinition()])).toThrow(/reserved measurement tool/i)
  })

  it('fails measurement routing closed when final-result and product calls are mixed or malformed', () => {
    const measurement = {
      kind: 'call' as const,
      id: 'measurement-1',
      name: STAGED_RESULT_TOOL_NAME,
      input: { claim: { package: '*', symbol: 'Scope', assertion: 'exists' } },
    }
    const product = { kind: 'call' as const, id: 'tool-1', name: 'ordinary_read', input: {} }

    expect(routeStagedProviderToolCalls([product, measurement], 'task-01')).toEqual({
      kind: 'unsupported',
      reason: 'measurement call must be the only tool call in its provider turn',
    })
    expect(routeStagedProviderToolCalls([{
      kind: 'invalid-arguments',
      id: 'measurement-2',
      name: STAGED_RESULT_TOOL_NAME,
    }], 'task-01')).toEqual({
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

  it('round-trips only canonical transport-owned results through the terminal wrapper', () => {
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
})
