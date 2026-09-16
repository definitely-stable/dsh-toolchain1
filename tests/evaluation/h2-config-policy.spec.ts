import { describe, expect, it } from 'vitest'

import { H2_POLICY, H2_STRATA, assertH2PolicyIntegrity } from '../../scripts/eval/h2/h2-config.mjs'

describe('H2 frozen policy', () => {
  it('freezes the approved observation budget: 18 tasks, 2 arms, 36 scoring, 2 technical, max 38', () => {
    expect(H2_POLICY.taskCount).toBe(18)
    expect(H2_POLICY.arms).toEqual(['B', 'C'])
    expect(H2_POLICY.scoringObservations).toBe(36)
    expect(H2_POLICY.technicalObservations).toBe(2)
    expect(H2_POLICY.maxObservations).toBe(38)
    expect(H2_POLICY.taskCount * H2_POLICY.arms.length).toBe(H2_POLICY.scoringObservations)
    expect(H2_POLICY.scoringObservations + H2_POLICY.technicalObservations).toBe(H2_POLICY.maxObservations)
  })

  it('freezes the six-stratum split at exactly three tasks per stratum', () => {
    expect(H2_STRATA).toEqual([
      'exact-target-api',
      'cordis-service',
      'agent-tool',
      'plugin-composition',
      'compatibility-debug',
      'runtime-verification',
    ])
    expect(H2_STRATA.length * H2_POLICY.tasksPerStratum).toBe(H2_POLICY.taskCount)
  })

  it('freezes the DeepSeek V4.1 Flash model identity for both arms', () => {
    expect(H2_POLICY.model).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      modelDisplayName: 'DeepSeek-V41-Flash',
      reasoningEffort: 'high',
    })
  })

  it('freezes the resource policy: one attempt, zero retries, bounded completions and wall time', () => {
    expect(H2_POLICY.resource.attemptsPerObservation).toBe(1)
    expect(H2_POLICY.resource.qualityRetries).toBe(0)
    expect(H2_POLICY.resource.infrastructureRetries).toBe(0)
    expect(H2_POLICY.resource.providerCompletionsLimit).toBeGreaterThanOrEqual(6)
    expect(H2_POLICY.resource.providerCompletionsLimit).toBeLessThanOrEqual(8)
    expect(H2_POLICY.resource.wallTimeLimitMs).toBe(180_000)
  })

  it('freezes the confirmatory decision rule: exact paired McNemar, one-sided alpha 0.05, MCID 2/18', () => {
    expect(H2_POLICY.statistics.test).toBe('exact-paired-mcnemar-one-sided')
    expect(H2_POLICY.statistics.alpha).toBe(0.05)
    expect(H2_POLICY.statistics.minimumDiscordantWins).toBe(2)
    expect(H2_POLICY.statistics.minimumDelta).toBe(2 / 18)
  })

  it('freezes the arm boundary: C = B + Toolchain, nothing else', () => {
    expect(H2_POLICY.toolchainPatch.rowId).toBe('dsh-toolchain')
    expect(H2_POLICY.toolchainPatch.rowName).toBe('dsh-toolchain/dsh')
    expect(H2_POLICY.toolchainToolPrefix).toBe('toolchain_')
    expect(H2_POLICY.armsDifferOnlyBy).toEqual({ extraBundle: 'dsh-toolchain' })
  })

  it('freezes the schedule seed so task order can never be re-rolled after outcomes', () => {
    expect(H2_POLICY.schedule.seed).toBe('h2-product-benchmark-v1-schedule')
    expect(H2_POLICY.schedule.balancedArmOrderTasks).toBe(9)
    expect(H2_POLICY.schedule.balancedArmOrderTasks * 2).toBe(H2_POLICY.taskCount)
  })

  it('keeps every numeric budget a non-negative safe integer and the policy deeply frozen', () => {
    assertH2PolicyIntegrity()
    expect(Object.isFrozen(H2_POLICY)).toBe(true)
    expect(Object.isFrozen(H2_POLICY.resource)).toBe(true)
    expect(Object.isFrozen(H2_POLICY.statistics)).toBe(true)
    expect(Object.isFrozen(H2_POLICY.model)).toBe(true)
    expect(Object.isFrozen(H2_STRATA)).toBe(true)
  })
})
