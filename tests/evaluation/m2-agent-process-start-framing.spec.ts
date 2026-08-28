import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { executeProcessModelAttempt } from './m2-agent-process-executor.js'
import type { ModelEnvelope } from './m2-agent-execution-evidence.js'

const ECHO_START_EXECUTOR = fileURLToPath(new URL(
  './fixtures/process-executor/echo-start.mjs',
  import.meta.url,
))

describe('M2.3 process start framing', () => {
  it('writes the model-visible start envelope as canonical NDJSON bytes', async () => {
    const envelope: ModelEnvelope = {
      schema: 'dsh-toolchain-m2-model-envelope-v1',
      systemPrompt: 'Use only visible evidence.',
      task: { id: 'p0-canonical-start', prompt: 'Identify the exact API.' },
      staticContext: [{ z: 1, a: 2 }],
      tools: [],
    }
    const result = await executeProcessModelAttempt({
      command: process.execPath,
      args: [ECHO_START_EXECUTOR],
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH ?? '' },
      envelope,
      timeoutMs: 2000,
      maxStdoutBytes: 16 * 1024,
      maxStderrBytes: 16 * 1024,
      dispatchToolCall: async request => {
        throw new Error(`unexpected tool request: ${request.name}`)
      },
    })

    expect(result.kind).toBe('model-outcome')
    if (result.kind !== 'model-outcome') throw new Error(`unexpected outcome: ${result.reason}`)
    expect(result.finalAnswer).toBe(canonicalizeEvaluationJson({ type: 'start', envelope }))
  })
})
