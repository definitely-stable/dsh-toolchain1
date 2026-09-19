import { describe, expect, it } from 'vitest'

import { assertPublishableReport } from '../../scripts/eval/h2/h2-cli.mjs'
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

/**
 * The canonical run's outcome shape, as published in
 * `docs/evaluation/h2/h2-terminal-outcome-2026-09-18.md`: which pairs each arm won,
 * which losing observations were lost to the completion ceiling rather than to the
 * grader, and which observations the independent grader failed. `success` and
 * `budgetExhausted` drive the preregistered primary decision, so these sets are what
 * make the diagnostic projection checkable against a real decomposition instead of an
 * invented one.
 */
function canonicalShape() {
  const taskId = (stratum: string, index: number) => `h2-${stratum}-${String(index).padStart(2, '0')}`
  const ids = (entries: Array<[string, number[]]>) => entries.flatMap(([stratum, numbers]) => numbers.map(index => taskId(stratum, index)))
  const strata = ['agent-tool', 'cordis-service', 'plugin-composition', 'compatibility-debug', 'runtime-verification', 'exact-target-api']
  const tasks = ids(strata.map(stratum => [stratum, [1, 2, 3]] as [string, number[]]))
  const outcomes: Record<'B' | 'C', { wins: string[], exhausted: string[], graderFailed: string[] }> = {
    B: {
      wins: ids([['agent-tool', [1, 2, 3]], ['compatibility-debug', [2, 3]], ['cordis-service', [3]], ['plugin-composition', [2]], ['runtime-verification', [1, 2]]]),
      exhausted: ids([['compatibility-debug', [1]], ['cordis-service', [1, 2]], ['exact-target-api', [1, 2, 3]], ['plugin-composition', [1, 3]], ['runtime-verification', [3]]]),
      graderFailed: ids([['compatibility-debug', [1]], ['cordis-service', [2]], ['exact-target-api', [1, 2, 3]], ['runtime-verification', [3]]]),
    },
    C: {
      wins: ids([['agent-tool', [2]], ['compatibility-debug', [2]]]),
      exhausted: ids([['agent-tool', [1, 3]], ['compatibility-debug', [3]], ['cordis-service', [1, 2, 3]], ['exact-target-api', [1, 2, 3]], ['plugin-composition', [1, 3]], ['runtime-verification', [1, 2, 3]]]),
      graderFailed: ids([['compatibility-debug', [1]], ['cordis-service', [1]], ['exact-target-api', [1, 3]], ['plugin-composition', [2]]]),
    },
  }
  const receipts = []
  for (const id of tasks) {
    for (const arm of ['B', 'C'] as const) {
      const { wins, exhausted, graderFailed } = outcomes[arm]
      const isExhausted = exhausted.includes(id)
      const grader = graderFailed.includes(id) ? 'fail' : 'pass'
      receipts.push(receipt(id, arm, wins.includes(id), {
        terminalReason: isExhausted ? 'RESOURCE_EXHAUSTED' : 'COMPLETED',
        budgetExhausted: isExhausted,
        grader: { status: grader, checks: [{ name: 'static:x', status: grader }] },
      }))
    }
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

  it('decomposes grader correctness from resource completion per arm', () => {
    const report = buildH2Report({ runId: 'run-diag', receipts: canonicalShape(), generatedAt: '2026-09-16T00:00:00Z' })
    // Product success requires a gradeable workspace, no budget exhaustion and a
    // passing grader. The headline "9 vs 2" is therefore not a correctness
    // comparison, and these fields are what make that visible.
    expect(report.secondary.B.successes).toBe(9)
    expect(report.secondary.C.successes).toBe(2)
    expect(report.secondary.B.budgetExhaustions).toBe(9)
    expect(report.secondary.C.budgetExhaustions).toBe(14)
    expect(report.secondary.B.graderPasses).toBe(12)
    expect(report.secondary.C.graderPasses).toBe(13)
    expect(report.secondary.B.graderFailures).toBe(6)
    expect(report.secondary.C.graderFailures).toBe(5)
    expect(report.secondary.B.graderPassButBudgetExhausted).toBe(3)
    expect(report.secondary.C.graderPassButBudgetExhausted).toBe(11)
    expect(report.secondary.B.terminalReasonCounts).toEqual({ COMPLETED: 9, RESOURCE_EXHAUSTED: 9 })
    expect(report.secondary.C.terminalReasonCounts).toEqual({ COMPLETED: 4, RESOURCE_EXHAUSTED: 14 })
  })

  it('keeps the independent grader purely descriptive for the preregistered decision', () => {
    // The preregistered primary success definition reads `success`, never the
    // grader. Flipping every grader verdict while holding `success` fixed must
    // therefore leave the decision, the contingency and the pair table identical.
    const passes = canonicalShape()
    const failures = passes.map(item => ({ ...item, grader: { ...item.grader, status: 'fail' } }))
    const published = buildH2Report({ runId: 'run-grader-pass', receipts: passes, generatedAt: '2026-09-16T00:00:00Z' })
    const flipped = buildH2Report({ runId: 'run-grader-fail', receipts: failures, generatedAt: '2026-09-16T00:00:00Z' })

    expect(flipped.status).toBe(published.status)
    expect(flipped.decision).toEqual(published.decision)
    expect(flipped.primary).toEqual(published.primary)
    expect(flipped.measurement).toEqual(published.measurement)
    expect(flipped.pairTable).toEqual(published.pairTable)
    // Only the diagnostic projection moves.
    expect(flipped.secondary.C.graderPasses).toBe(0)
    expect(published.secondary.C.graderPasses).toBe(13)
    expect(flipped.secondary.C.graderFailures).toBe(18)
  })
})

describe('H2 report publication gate', () => {
  it('publishes a fully resolved run whatever its verdict', () => {
    // The gate is the measurement, not the verdict: `INCONCLUSIVE` is a
    // preregistered terminal outcome and section 13 requires it to be reported
    // rather than hidden. An earlier gate compared the status against
    // `'COMPLETE'`, which no report carries, so it refused a resolved run and
    // nothing caught it until a real run tried to publish.
    const confirmed = buildH2Report({ runId: 'run-7', receipts: corpusPairs(5), generatedAt: '2026-09-16T00:00:00Z' })
    const inconclusive = buildH2Report({ runId: 'run-8', receipts: corpusPairs(4), generatedAt: '2026-09-16T00:00:00Z' })
    expect(confirmed.status).toBe('CONFIRMED_BENEFIT')
    expect(inconclusive.status).toBe('INCONCLUSIVE')
    expect(() => assertPublishableReport(confirmed)).not.toThrow()
    expect(() => assertPublishableReport(inconclusive)).not.toThrow()
  })

  it('rejects a run that did not reach its terminal measurement', () => {
    const receipts = corpusPairs(5)
    const withoutOnePair = receipts.filter(item => !(item.taskId === 'h2-task-18' && item.arm === 'C'))
    const unresolved = buildH2Report({ runId: 'run-9', receipts: withoutOnePair, generatedAt: '2026-09-16T00:00:00Z' })
    expect(unresolved.status).toBe('STOPPED_INVALID')
    expect(() => assertPublishableReport(unresolved)).toThrow(/non-terminal/)

    const drifted = corpusPairs(5)
    drifted[1] = receipt('h2-task-01', 'C', false, { identityDrift: true, terminalReason: 'COMPLETED' })
    expect(() => assertPublishableReport(buildH2Report({ runId: 'run-10', receipts: drifted, generatedAt: '2026-09-16T00:00:00Z' }))).toThrow(/identity drifted/)

    const failed = corpusPairs(5)
    failed[0] = receipt('h2-task-01', 'B', false, { terminalReason: 'INFRASTRUCTURE_FAILURE' })
    expect(() => assertPublishableReport(buildH2Report({ runId: 'run-11', receipts: failed, generatedAt: '2026-09-16T00:00:00Z' }))).toThrow(/infrastructure/)

    // A short run that nevertheless resolved its present pairs is refused too:
    // the comparison has to cover the preregistered scoring schedule.
    const resolved = buildH2Report({ runId: 'run-12', receipts: corpusPairs(5), generatedAt: '2026-09-16T00:00:00Z' })
    const shortRun = { ...resolved, measurement: { ...resolved.measurement, executedObservations: resolved.measurement.expectedObservations - 2 } }
    expect(() => assertPublishableReport(shortRun)).toThrow(/executed/)
  })
})