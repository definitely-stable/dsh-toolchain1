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
const OUTPUT_OVERFLOW_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/output-overflow.mjs', import.meta.url))
const ENVIRONMENT_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/environment.mjs', import.meta.url))
const DUPLICATE_FINAL_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/duplicate-final.mjs', import.meta.url))
const PROVIDER_METADATA_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/provider-metadata.mjs', import.meta.url))
const INFRASTRUCTURE_ERROR_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/infrastructure-error.mjs', import.meta.url))
const MISSING_FINAL_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/missing-final.mjs', import.meta.url))

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

  it('accepts provider-native completion metadata as a separate closed protocol observation before final', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(PROVIDER_METADATA_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('provider-metadata fixture must not request tools')
      },
    })

    expect(result).toEqual({
      kind: 'model-outcome',
      finalAnswer: 'metadata arrived before final',
      providerMetadata: {
        completionId: 'fixture-provider-metadata-1',
        finishReason: 'stop',
        inputTokens: 21,
        outputTokens: 9,
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

  it('classifies a runner-owned tool dispatcher failure as tool transport rather than protocol failure', async () => {
    const tool: ModelVisibleTool = {
      family: 'ordinary',
      name: 'fixture_lookup',
      description: 'Look up one frozen fixture value.',
      inputSchema: { type: 'object' },
    }
    const result = await executeProcessModelAttempt({
      ...processInput(TOOL_CALL_EXECUTOR, modelEnvelope([tool])),
      dispatchToolCall: async () => {
        throw new Error('fixture tool transport unavailable')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'tool-transport',
      detail: expect.stringMatching(/tool transport unavailable/i),
    })
  })

  it('classifies child-observed provider transport failure without inferring anything from answer quality', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(INFRASTRUCTURE_ERROR_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('provider transport fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'provider-transport',
      detail: 'fixture provider transport unavailable',
      providerMetadata: {
        completionId: 'fixture-provider-transport-1',
        finishReason: 'transport-error',
        inputTokens: 13,
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

  it('classifies zero exit without a terminal final as deterministic protocol infrastructure failure', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(MISSING_FINAL_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('missing-final fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'protocol',
      detail: expect.stringMatching(/terminal|final/i),
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

  it('classifies process spawn errors as infrastructure failure instead of rejecting the runner', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(SUCCESS_EXECUTOR, modelEnvelope()),
      command: 'dsh-toolchain-intentionally-missing-executor-command',
      args: [],
      environment: {},
      dispatchToolCall: async () => {
        throw new Error('missing executable cannot request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'spawn',
      detail: expect.stringMatching(/ENOENT|not found/i),
    })
  })

  it('enforces maxStdoutBytes and retains no more stdout evidence than the configured cap', async () => {
    const maxStdoutBytes = 64
    const result = await executeProcessModelAttempt({
      ...processInput(OUTPUT_OVERFLOW_EXECUTOR, modelEnvelope()),
      maxStdoutBytes,
      dispatchToolCall: async () => {
        throw new Error('stdout-overflow fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'output-limit',
      detail: expect.stringMatching(/stdout/i),
    })
    if (result.kind === 'infrastructure-failure' && result.partialOutput !== undefined) {
      expect(Buffer.byteLength(result.partialOutput, 'utf8')).toBeLessThanOrEqual(maxStdoutBytes)
    }
  })

  it('enforces maxStderrBytes and retains no more stderr evidence than the configured cap', async () => {
    const maxStderrBytes = 48
    const result = await executeProcessModelAttempt({
      ...processInput(OUTPUT_OVERFLOW_EXECUTOR, modelEnvelope()),
      environment: {
        PATH: process.env.PATH ?? '',
        DSH_OVERFLOW_CHANNEL: 'stderr',
      },
      maxStderrBytes,
      dispatchToolCall: async () => {
        throw new Error('stderr-overflow fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'output-limit',
      detail: expect.stringMatching(/stderr/i),
    })
    if (result.kind === 'infrastructure-failure' && result.stderr !== undefined) {
      expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(maxStderrBytes)
    }
  })

  it('passes only the runner allowlist environment and does not inherit parent secrets', async () => {
    const previous = process.env.DSH_PARENT_SECRET
    process.env.DSH_PARENT_SECRET = 'must-not-leak'
    try {
      const result = await executeProcessModelAttempt({
        ...processInput(ENVIRONMENT_EXECUTOR, modelEnvelope()),
        environment: {
          PATH: process.env.PATH ?? '',
          DSH_VISIBLE: 'runner-visible',
        },
        dispatchToolCall: async () => {
          throw new Error('environment fixture must not request tools')
        },
      })

      expect(result).toMatchObject({
        kind: 'model-outcome',
        finalAnswer: 'runner-visible|absent',
      })
    } finally {
      if (previous === undefined) delete process.env.DSH_PARENT_SECRET
      else process.env.DSH_PARENT_SECRET = previous
    }
  })

  it('rejects a second terminal final instead of accepting the first answer', async () => {
    const result = await executeProcessModelAttempt({
      ...processInput(DUPLICATE_FINAL_EXECUTOR, modelEnvelope()),
      dispatchToolCall: async () => {
        throw new Error('duplicate-final fixture must not request tools')
      },
    })

    expect(result).toMatchObject({
      kind: 'infrastructure-failure',
      reason: 'protocol',
      detail: expect.stringMatching(/after terminal final/i),
    })
  })
})
