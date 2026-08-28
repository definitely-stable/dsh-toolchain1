import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { executeProcessModelAttempt } from './m2-agent-process-executor.js'
import type { ModelEnvelope } from './m2-agent-execution-evidence.js'

const SUCCESS_EXECUTOR = fileURLToPath(new URL('./fixtures/process-executor/success.mjs', import.meta.url))

function modelEnvelope(): ModelEnvelope {
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: 'Answer as a DSH plugin developer.',
    task: {
      id: 'p0-process-success',
      prompt: 'How do I request a required service?',
    },
    staticContext: [],
    tools: [],
  }
}

describe('M2.3 process model executor', () => {
  it('runs one isolated child attempt and returns only validated model outcome data', async () => {
    const result = await executeProcessModelAttempt({
      command: process.execPath,
      args: [SUCCESS_EXECUTOR],
      cwd: process.cwd(),
      environment: {
        PATH: process.env.PATH ?? '',
      },
      envelope: modelEnvelope(),
      timeoutMs: 2_000,
      maxStdoutBytes: 16 * 1024,
      maxStderrBytes: 16 * 1024,
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
})
