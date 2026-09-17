import { describe, expect, it } from 'vitest'

import { buildH2Report } from '../../scripts/eval/h2/h2-report.mjs'

const hex = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64)

function receipt(taskId: string, arm: 'B' | 'C', success: boolean, overrides: Record<string, unknown> = {}) {
  return {
    schema: 'dsh-toolchain-h2-observation-receipt-v1',
    runId: 'run-1',
    taskId,
    stratum: 'exact-target-api',
    arm,
    attempt: 1,
    terminalReason: 'COMPLETED',
    budgetExhausted: false,
    success,
    identityDrift: false,
    grader: { status: success ? 'pass' : 'fail', checks: [{ name: 'static:x', status: success ? 'pass' : 'fail' }] },
    identity: { provider: 'deepseek-official', requestModel: 'deepseek-flash', responseModel: 'deepseek-flash', reasoningEffort: 'high', systemFingerprint: null, revision: null },
    usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 400, cacheWriteTokens: 0, reasoningTokens: 10, providerCompletions: 2 },
    timing: { wallTimeMs: 30_000, agentSteps: 2, turns: 1 },
    tools: { totalToolCalls: 4, ordinaryToolCalls: 3, toolchainToolCalls: 1, perTool: { read_file: 3, toolchain_contract_search: 1 }, acpObservedToolCalls: 4 },
    workspace: { digestBefore: hex(1), digestAfter: hex(2) },
    acp: { stopReason: 'end_turn', usageUpdates: 2 },
    ...overrides,
  }
}

function corpusPairs(winnerTasks: number) {
  const receipts = []
  for (let index = 0; index < 18; index += 1) {
    const taskId = `h2-task-${String(index + 1).padStart(2, '0')}`
    const cWins = index < winnerTasks
    receipts.push(receipt(taskId, 'B', !cWins))
    receipts.push(receipt(taskId, 'C', true))
  }
  return receipts
}

describe('H2 product report', () => {
  it('computes the paired primary and per-arm secondary evidence', () => {
    const report = buildH2Report({ runId: 'run-1', receipts: corpusPairs(5), generatedAt: '2026-09-16T00:00:00Z' })
    expect(report.status).toBe('CONFIRMED_BENEFIT')
    expect(report.measurement.allResolved).toBe(true)
    expect(report.decision.contingency).toEqual({ bothSuccess: 13, bOnly: 0, cOnly: 5, bothFail: 0, totalPairs: 18 })
    const primary = report.primary
    // The primary block only carries an estimate when the run resolved.
    if (!('delta' in primary)) throw new Error('expected a computed primary estimate')
    expect(primary.delta).toBe(5 / 18)
    expect(primary.pValue).toBeCloseTo(0.03125, 12)
    expect(report.secondary.B.observations).toBe(18)
    expect(report.secondary.C.successes).toBe(18)
    expect(report.secondary.B.successes).toBe(13)
    expect(report.secondary.C.totalTokens).toBe(18 * 1100)
    expect(report.secondary.C.observationsUsingToolchain).toBe(18)
    expect(report.secondary.B.observationsUsingToolchain).toBe(18)
    expect(report.secondary.C.perTool.toolchain_contract_search).toBe(18)
    expect(report.strata).toHaveLength(6)
  })

  it('reports a completed run with a moderate effect as INCONCLUSIVE, never as equivalence', () => {
    const report = buildH2Report({ runId: 'run-2', receipts: corpusPairs(4), generatedAt: '2026-09-16T00:00:00Z' })
    expect(report.status).toBe('INCONCLUSIVE')
    expect(report.decision.reason).toBe('MCNEMAR_ABOVE_ALPHA')
    const primary = report.primary
    if (!('pValue' in primary)) throw new Error('expected a computed primary estimate')
    expect(primary.pValue).toBeCloseTo(0.0625, 12)
  })

  it('stops invalid and publishes no confirmatory estimate when observations are unresolved', () => {
    const receipts = corpusPairs(5)
    const withoutOnePair = receipts.filter(item => !(item.taskId === 'h2-task-18' && item.arm === 'C'))
    const report = buildH2Report({ runId: 'run-3', receipts: withoutOnePair, generatedAt: '2026-09-16T00:00:00Z' })
    expect(report.status).toBe('STOPPED_INVALID')
    expect(report.measurement.allResolved).toBe(false)
    expect(report.primary).not.toHaveProperty('pValue')
    expect(report.primary.computed).toBe(false)
  })

  it('counts infrastructure failure and model identity drift, and refuses to analyse them', () => {
    const receipts = corpusPairs(5)
    receipts[0] = receipt('h2-task-01', 'B', false, { terminalReason: 'INFRASTRUCTURE_FAILURE' })
    receipts[1] = receipt('h2-task-01', 'C', false, { identityDrift: true, terminalReason: 'COMPLETED' })
    const report = buildH2Report({ runId: 'run-4', receipts, generatedAt: '2026-09-16T00:00:00Z' })
    expect(report.measurement.infrastructureFailures).toBe(1)
    expect(report.measurement.modelIdentityDrift).toBe(1)
    expect(report.status).toBe('STOPPED_INVALID')
  })

  it('treats a budget-exhausted observation as a product failure, not a measurement failure', () => {
    const receipts = corpusPairs(5)
    const index = receipts.findIndex(item => item.taskId === 'h2-task-01' && item.arm === 'B')
    receipts[index] = receipt('h2-task-01', 'B', false, { terminalReason: 'RESOURCE_EXHAUSTED', budgetExhausted: true })
    const report = buildH2Report({ runId: 'run-5', receipts, generatedAt: '2026-09-16T00:00:00Z' })
    expect(report.measurement.allResolved).toBe(true)
    expect(report.secondary.B.budgetExhaustions).toBe(1)
    expect(report.measurement.infrastructureFailures).toBe(0)
    expect(report.status).toBe('CONFIRMED_BENEFIT')
  })

  it('rejects a report that would carry hidden or secret data', () => {
    const receipts = corpusPairs(5)
    // The sanitizer must reject a receipt carrying a field that a real run
    // never stores, so this deliberately builds an out-of-contract object.
    receipts[0] = { ...receipts[0]!, prompt: 'hidden prompt text' } as (typeof receipts)[number]
    expect(() => buildH2Report({ runId: 'run-6', receipts, generatedAt: '2026-09-16T00:00:00Z' })).toThrow(/forbidden/)
  })
})