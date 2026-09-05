import { describe, expect, it, vi } from 'vitest'

import { executeStagedCall } from '../../scripts/eval/staged-execution.mjs'

const call = Object.freeze({ ordinal: 1, taskId: 'h1-approval-policy-p01', arm: 'B' as const, repetition: 1 as const })
const task = Object.freeze({
  id: 'h1-approval-policy-p01',
  domain: 'approval-policy',
  prompt: 'Which public API should I use?',
  successRule: Object.freeze({
    kind: 'api-exists-any',
    package: '@deepseek-ai/dsh-user-approval',
    symbols: Object.freeze(['ApprovalPolicy']),
  }),
})
const structuredContent = {
  schema: 'dsh-toolchain-staged-eval-result-v1',
  taskId: 'h1-approval-policy-p01',
  claims: [{ package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'exists' }],
}

describe('staged evaluation execution boundary', () => {
  it('normalizes a valid structured claim through deterministic API adjudication only', async () => {
    const execute = vi.fn(async () => ({
      transportStatus: 'ok' as const,
      structuredContent,
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 120,
      usage: { inputTokens: 100, outputTokens: 20, turns: 2 },
      toolUsage: { calls: 3 },
    }))

    const result = await executeStagedCall(call, task, execute)

    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith(call, task)
    expect(result.measurement).toEqual({
      arm: 'B',
      formatValid: true,
      decisionResolved: true,
      infrastructureFailures: 0,
      attemptCount: 1,
      hasModelOutcome: true,
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
    })
    expect(result.productOutcome).toEqual({ kind: 'completed' })
    expect(result.decision).toEqual({ apiValid: true })
    expect(result.decision).not.toHaveProperty('taskSuccess')
    expect(result.cost).toEqual({
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 120,
      usage: { inputTokens: 100, outputTokens: 20, turns: 2 },
      toolUsage: { calls: 3 },
    })
  })

  it('classifies an unrelated but schema-valid claim as unresolved adjudication after completed exploration', async () => {
    const result = await executeStagedCall(call, task, async () => ({
      transportStatus: 'ok',
      structuredContent: {
        ...structuredContent,
        claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
      },
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 40,
    }))

    expect(result.measurement).toMatchObject({
      formatValid: true,
      decisionResolved: false,
      hasModelOutcome: true,
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
    })
    expect(result.productOutcome).toEqual({ kind: 'completed' })
    expect(result.failure).toMatchObject({ code: 'TASK_ADJUDICATION_UNRESOLVED' })
    expect(result).not.toHaveProperty('decision')
  })

  it('classifies unsupported structured transport as measurement failure after measurement was attempted', async () => {
    const result = await executeStagedCall(call, task, async () => ({
      transportStatus: 'unsupported',
      terminalTransportReason: 'structured_transport_unsupported',
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 50,
    }))

    expect(result.measurement).toMatchObject({
      formatValid: false,
      decisionResolved: false,
      hasModelOutcome: true,
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
      terminalTransportReason: 'structured_transport_unsupported',
    })
    expect(result.failure).toMatchObject({ code: 'STRUCTURED_TRANSPORT_UNSUPPORTED' })
    expect(result).not.toHaveProperty('decision')
  })

  it('classifies product tool-budget exhaustion as a bounded product outcome without pretending measurement was attempted', async () => {
    const result = await executeStagedCall(call, task, async () => ({
      transportStatus: 'product-terminal',
      productTerminalReason: 'tool_budget_exhausted',
      terminalTransportReason: 'tool_call_limit',
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 500,
      usage: { inputTokens: 5000, outputTokens: 300, turns: 32, providerCompletions: 32 },
      toolUsage: { calls: 31, ordinaryCalls: 31, toolchainCalls: 0 },
    }))

    expect(result.measurement).toMatchObject({
      formatValid: false,
      decisionResolved: false,
      hasModelOutcome: true,
      measurementAttempted: false,
      unrecoveredInfrastructure: false,
      terminalTransportReason: 'tool_call_limit',
    })
    expect(result.productOutcome).toEqual({ kind: 'budget-exhausted', reason: 'tool_budget_exhausted' })
    expect(result.failure).toMatchObject({ code: 'PRODUCT_BUDGET_EXHAUSTED' })
    expect(result.failure?.code).not.toBe('STRUCTURED_TRANSPORT_UNSUPPORTED')
    expect(result).not.toHaveProperty('decision')
  })

  it('classifies malformed or task-mismatched structured content as invalid measurement', async () => {
    const malformed = await executeStagedCall(call, task, async () => ({
      transportStatus: 'ok',
      structuredContent: { text: 'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=ApprovalPolicy assertion=exists' },
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 60,
    }))
    expect(malformed.failure).toMatchObject({ code: 'STRUCTURED_RESULT_INVALID' })
    expect(malformed.measurement).toMatchObject({ formatValid: false, decisionResolved: false, hasModelOutcome: true, measurementAttempted: true })

    const mismatched = await executeStagedCall(call, task, async () => ({
      transportStatus: 'ok',
      structuredContent: { ...structuredContent, taskId: 'different-task' },
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 60,
    }))
    expect(mismatched.failure).toMatchObject({ code: 'STRUCTURED_RESULT_TASK_MISMATCH' })
    expect(mismatched.measurement).toMatchObject({ decisionResolved: false, measurementAttempted: true })
  })

  it('reports a recovered infrastructure retry as cost without unrecovered missingness', async () => {
    const result = await executeStagedCall(call, task, async () => ({
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
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
      formatValid: true,
      decisionResolved: true,
    })
  })

  it('reports unrecovered infrastructure without inventing a model outcome or decision', async () => {
    const result = await executeStagedCall(call, task, async () => ({
      transportStatus: 'infrastructure-failure',
      attempts: 2,
      infrastructureFailures: 2,
      wallTimeMs: 300,
    }))

    expect(result.measurement).toMatchObject({
      infrastructureFailures: 2,
      attemptCount: 2,
      hasModelOutcome: false,
      measurementAttempted: false,
      unrecoveredInfrastructure: true,
      formatValid: false,
      decisionResolved: false,
    })
    expect(result.failure).toMatchObject({ code: 'UNRECOVERED_INFRASTRUCTURE' })
    expect(result).not.toHaveProperty('decision')
  })
})
