import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { executeProcessModelAttempt } from './m2-agent-process-executor.js'
import type { ModelEnvelope, ModelVisibleTool } from './m2-agent-execution-evidence.js'

const SUCCESS_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/success.mjs', import.meta.url))
const TOOL_CALL_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/tool-call.mjs', import.meta.url))
const MALFORMED_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/malformed.mjs', import.meta.url))
const FORBIDDEN_EVIDENCE_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/forbidden-evidence.mjs', import.meta.url))
const TIMEOUT_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/timeout.mjs', import.meta.url))
const NONZERO_EXIT_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/nonzero-exit.mjs', import.meta.url))

function modelEnvelope(tools: readonly ModelVisibleTool[] = []): ModelEnvelope {
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: 'Answer as a DSH plugin developer.',
    task: {
      id: 'p0-process-success',
      prompt: 'How do I request a required service?',
    },
    staticContext: [],
    tools,
  }
}

function processInput(executor: string, envelope: ModelEnvelope) {
  return {
    command: process.execPath,
    args: [executor],
    cwd: process.cwd(),
    environment: {
      PATH: process.env.PATH ?? '',
    },
    envelope,
    timeoutMs: 2_000,
    maxStdoutBytes: 16 * 1024,
    maxStderrBytes: 16 * 1024,
  }
}

describe('M2.3 process model executor', () => {
  it('runs one isolated child attempt and returns only validated model outcome data', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(SUCCESS_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('success fixture must not request tools')
      },
    })

    expect(result).toEqual({
      kind: 'model-outcome',
      finalAnswer: 'Use ctx.inject() for required services.',
      providerMetadata: {
        completionId: 'fixture-completion-1',
        finishReason: 'stop',
        inputTokens: 11,
        outputTokens: 7,
      },
    })
  })

  it('round-trips an allowed tool request through the runner-owned dispatcher', async () => {
    const tool: ModelVisibleTool = {
      family: 'ordinary',
      name: 'fixture_lookup',
      description: 'Look up one frozen fixture value.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    }
    let dispatched: unknown

    const result = await executeProcessModelAttempt({
      ...processInput(TOOL_CALL_EXECUTOR, modelEnvelope([tool])),
      dispatchToolCall: async request => {
        dispatched = request
        return { matches: ['contract:ctx.inject'] }
      },
    })

    expect(dispatched).toEqual({
      id: 'call-1',
      name: 'fixture_lookup',
      input: { query: 'ctx.inject' },
    })
    expect(result).toEqual({
      kind: 'model-outcome',
      finalAnswer: 'tool result: contract:ctx.inject',
      providerMetadata: {
        completionId: 'fixture-completion-tool-1',
        finishReason: 'stop',
      },
    })
  })

  it('classifies malformed child protocol as infrastructure failure and retains partial output', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(MALFORMED_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('malformed fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'protocol',
      partialOutput: '{not-json}\n',
    })
  })

  it('rejects executor attempts to smuggle runner-owned evidence through final', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(FORBIDDEN_EVIDENCE_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('forbidden-evidence fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'protocol',
    })
  })

  it('terminates a late child by the runner-owned timeout before accepting its answer', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(TIMEOUT_EXECUTOR, modelEnvelope()),
      timeoutMs: 25,
      dispatchToolCall: async () => {
        throw new Error('timeout fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'timeout',
    })
  })

  it('classifies nonzero child exit as infrastructure failure and retains stderr evidence', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(NONZERO_EXIT_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('nonzero-exit fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'exit',
      detail: expect.stringMatching(/code 7/i),
      stderr: 'provider adapter crashed\n',
    })
  })
})
