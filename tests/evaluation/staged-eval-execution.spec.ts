import { describe, expect, it, vi } from 'vitest'

import { executeStagedCall } from '../../scripts/eval/staged-execution.mjs'

const call = Object.freeze({ ordinal: 1, taskId: 'tool-basic-001', arm: 'B' as const, repetition: 1 as const })
const structuredContent = {
  schema: 'dsh-toolchain-staged-eval-result-v1',
  taskId: 'tool-basic-001',
  apiValid: true,
  taskSuccess: true,
  claims: [{ kind: 'tool', name: 'tools.register' }],
}

describe('staged evaluation execution boundary', () => {
  it('normalizes a valid structured model outcome into resolved measurement and cost evidence', async () => {
    const execute = vi.fn(async () => ({
      transportStatus: 'ok' as const,
      structuredContent,
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 120,
      usage: { inputTokens: 100, outputTokens: 20, turns: 2 },
      toolUsage: { calls: 3 },
    }))

    const result = await executeStagedCall(call, execute)

    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(call)
    expect(result.measurement).toEqual({
      arm: 'B',
      formatValid: true,
      decisionResolved: true,
      infrastructureFailures: 0,
      attemptCount: 1,
      hasModelOutcome: true,
      unrecoveredInfrastructure: false,
    })
    expect(result.decision).toMatchObject({ apiValid: true, taskSuccess: true })
    expect(result.cost).toEqual({
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 120,
      usage: { inputTokens: 100, outputTokens: 20, turns: 2 },
      toolUsage: { calls: 3 },
    })
  })

  it('classifies unsupported structured transport as unresolved model evidence without prose fallback', async () => {
    const result = await executeStagedCall(call, async () => ({
      transportStatus: 'unsupported',
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 50,
    }))

    expect(result.measurement).toMatchObject({
      formatValid: false,
      decisionResolved: false,
      hasModelOutcome: true,
      unrecoveredInfrastructure: false,
    })
    expect(result.failure).toMatchObject({ code: 'STRUCTURED_TRANSPORT_UNSUPPORTED' })
    expect(result).not.toHaveProperty('decision')
  })

  it('classifies malformed or task-mismatched structured content as invalid measurement', async () => {
    const malformed = await executeStagedCall(call, async () => ({
      transportStatus: 'ok',
      structuredContent: { text: 'API_CLAIM tools.register' },
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 60,
    }))
    expect(malformed.failure).toMatchObject({ code: 'STRUCTURED_RESULT_INVALID' })
    expect(malformed.measurement).toMatchObject({ formatValid: false, decisionResolved: false, hasModelOutcome: true })

    const mismatched = await executeStagedCall(call, async () => ({
      transportStatus: 'ok',
      structuredContent: { ...structuredContent, taskId: 'different-task' },
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 60,
    }))
    expect(mismatched.failure).toMatchObject({ code: 'STRUCTURED_RESULT_TASK_MISMATCH' })
    expect(mismatched.measurement.decisionResolved).toBe(false)
  })

  it('reports a recovered infrastructure retry as cost without unrecovered missingness', async () => {
    const result = await executeStagedCall(call, async () => ({
      transportStatus: 'ok',
      structuredContent,
      attempts: 2,
      infrastructureFailures: 1,
      wallTimeMs: 210,
    }))

    expect(result.measurement).toMatchObject({
      infrastructureFailures: 1,
      attemptCount: 2,
      hasModelOutcome: true,
      unrecoveredInfrastructure: false,
      formatValid: true,
      decisionResolved: true,
    })
  })

  it('reports unrecovered infrastructure without inventing a model outcome or decision', async () => {
    const result = await executeStagedCall(call, async () => ({
      transportStatus: 'infrastructure-failure',
      attempts: 2,
      infrastructureFailures: 2,
      wallTimeMs: 300,
    }))

    expect(result.measurement).toMatchObject({
      infrastructureFailures: 2,
      attemptCount: 2,
      hasModelOutcome: false,
      unrecoveredInfrastructure: true,
      formatValid: false,
      decisionResolved: false,
    })
    expect(result.failure).toMatchObject({ code: 'UNRECOVERED_INFRASTRUCTURE' })
    expect(result).not.toHaveProperty('decision')
  })
})
