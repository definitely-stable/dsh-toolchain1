import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  assertAgentHoldoutCommitted,
  createBalancedAgentSchedule,
  hashEvaluationDefinition,
  validateAgentAttempts,
  validateAgentResultAgainstDefinition,
  validateBalancedAgentSchedule,
  type AgentAttemptRecord,
} from './m2-agent-eval-integrity.js'

function definitionFixture() {
  return {
    schema: 'dsh-toolchain-m2-agent-eval-definition-v1',
    target: {
      targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
      contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
    },
    dataset: { id: 'H1', commitmentSha256: '3'.repeat(64) },
    model: { provider: 'provider', model: 'model', snapshot: 'snapshot', reasoning: 'fixed' },
    harness: {
      runner: 'runner',
      version: '1.0.0',
      systemPromptSha256: '4'.repeat(64),
      taskPromptSha256: '5'.repeat(64),
      toolSchemaSha256: '6'.repeat(64),
      staticDocsSha256: '7'.repeat(64),
    },
    oracle: { version: 'api-oracle-v1', sha256: '8'.repeat(64) },
    resources: {
      maxTurns: 20,
      maxInputTokens: 24_000,
      maxOutputTokens: 4_000,
      wallTimeMs: 120_000,
      concurrency: 1,
    },
    retries: {
      maxInfrastructureRetries: 2,
      modelOutcomeRetries: 0 as const,
      retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'],
    },
    runOrder: { seed: 'm2-h1-v1', trialsPerTaskArm: 3 },
  } as const
}

function reorderDefinition() {
  const value = definitionFixture()
  return {
    runOrder: value.runOrder,
    retries: value.retries,
    resources: value.resources,
    oracle: value.oracle,
    harness: value.harness,
    model: value.model,
    dataset: value.dataset,
    target: value.target,
    schema: value.schema,
  }
}

describe('M2.3 agent evaluation integrity', () => {
  it('content-addresses semantic JSON independent of object key order and changes on every protected identity', async () => {
    const sha256 = createNodeSha256Port()
    const base = definitionFixture()
    const baseHash = await hashEvaluationDefinition(base, sha256)

    expect(baseHash).toMatch(/^[0-9a-f]{64}$/)
    await expect(hashEvaluationDefinition(reorderDefinition(), sha256)).resolves.toBe(baseHash)

    const mutations = [
      { ...base, target: { ...base.target, targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}` } },
      { ...base, target: { ...base.target, contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}` } },
      { ...base, dataset: { ...base.dataset, commitmentSha256: 'c'.repeat(64) } },
      { ...base, harness: { ...base.harness, systemPromptSha256: 'd'.repeat(64) } },
      { ...base, harness: { ...base.harness, toolSchemaSha256: 'e'.repeat(64) } },
      { ...base, harness: { ...base.harness, staticDocsSha256: 'f'.repeat(64) } },
      { ...base, oracle: { ...base.oracle, sha256: '0'.repeat(64) } },
      { ...base, resources: { ...base.resources, maxTurns: base.resources.maxTurns + 1 } },
      { ...base, retries: { ...base.retries, maxInfrastructureRetries: 1 } },
      { ...base, runOrder: { ...base.runOrder, seed: 'changed-seed' } },
    ]

    for (const mutation of mutations) {
      await expect(hashEvaluationDefinition(mutation, sha256)).resolves.not.toBe(baseHash)
    }
  })

  it('creates a deterministic balanced schedule with exactly three trials for every task and arm', async () => {
    const sha256 = createNodeSha256Port()
    const taskIds = ['h1-01', 'h1-02', 'h1-03']
    const schedule = await createBalancedAgentSchedule(taskIds, 'seed-v1', sha256)
    const repeated = await createBalancedAgentSchedule(taskIds, 'seed-v1', sha256)
    const changedSeed = await createBalancedAgentSchedule(taskIds, 'seed-v2', sha256)

    expect(schedule).toEqual(repeated)
    expect(changedSeed).not.toEqual(schedule)
    expect(schedule).toHaveLength(taskIds.length * 3 * 3)
    expect(() => validateBalancedAgentSchedule(schedule, taskIds)).not.toThrow()

    for (const taskId of taskIds) {
      for (const arm of ['A', 'B', 'C'] as const) {
        expect(schedule.filter(item => item.taskId === taskId && item.arm === arm)).toHaveLength(3)
        expect(
          schedule
            .filter(item => item.taskId === taskId && item.arm === arm)
            .map(item => item.trial)
            .toSorted(),
        ).toEqual([1, 2, 3])
      }
    }

    expect(() => validateBalancedAgentSchedule(schedule.slice(1), taskIds)).toThrow(/schedule/i)
  })

  it('records bounded infrastructure retries without ever retrying a model outcome', () => {
    const policy = {
      maxInfrastructureRetries: 2,
      modelOutcomeRetries: 0 as const,
      retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'] as const,
    }
    const valid: AgentAttemptRecord[] = [
      {
        taskId: 'h1-01', arm: 'C', trial: 1, attempt: 1,
        kind: 'infrastructure-failure', reason: 'provider-transport',
      },
      {
        taskId: 'h1-01', arm: 'C', trial: 1, attempt: 2,
        kind: 'infrastructure-failure', reason: 'tool-transport',
      },
      { taskId: 'h1-01', arm: 'C', trial: 1, attempt: 3, kind: 'model-outcome' },
    ]

    expect(() => validateAgentAttempts(valid, policy)).not.toThrow()

    expect(() => validateAgentAttempts([
      { taskId: 'h1-01', arm: 'B', trial: 2, attempt: 1, kind: 'model-outcome' },
      { taskId: 'h1-01', arm: 'B', trial: 2, attempt: 2, kind: 'model-outcome' },
    ], policy)).toThrow(/model outcome/i)

    expect(() => validateAgentAttempts([
      {
        taskId: 'h1-02', arm: 'A', trial: 1, attempt: 1,
        kind: 'infrastructure-failure', reason: 'provider-transport',
      },
      {
        taskId: 'h1-02', arm: 'A', trial: 1, attempt: 3,
        kind: 'model-outcome',
      },
    ], policy)).toThrow(/contiguous/i)

    expect(() => validateAgentAttempts([
      {
        taskId: 'h1-03', arm: 'C', trial: 3, attempt: 1,
        kind: 'infrastructure-failure', reason: 'rate-limit',
      },
    ], policy)).toThrow(/retryable/i)

    expect(() => validateAgentAttempts([
      {
        taskId: 'h1-03', arm: 'C', trial: 3, attempt: 1,
        kind: 'infrastructure-failure', reason: 'provider-transport',
      },
      {
        taskId: 'h1-03', arm: 'C', trial: 3, attempt: 2,
        kind: 'infrastructure-failure', reason: 'provider-transport',
      },
      {
        taskId: 'h1-03', arm: 'C', trial: 3, attempt: 3,
        kind: 'infrastructure-failure', reason: 'provider-transport',
      },
    ], policy)).toThrow(/infrastructure retr/i)
  })

  it('fails closed until the H1 task set and every preregistration prerequisite are committed', () => {
    const notCommitted = {
      status: 'NOT_COMMITTED',
      runAllowed: false,
      commitmentSha256: null,
      taskCount: null,
      prerequisites: {
        p0Completed: false,
        mcidFrozen: false,
        noninferiorityMarginFrozen: false,
        taskSetHashCommitted: false,
      },
    } as const

    expect(() => assertAgentHoldoutCommitted(notCommitted)).toThrow(/not committed/i)

    const committed = {
      status: 'COMMITTED',
      runAllowed: true,
      commitmentSha256: 'a'.repeat(64),
      taskCount: 24,
      prerequisites: {
        p0Completed: true,
        mcidFrozen: true,
        noninferiorityMarginFrozen: true,
        taskSetHashCommitted: true,
      },
    } as const

    expect(() => assertAgentHoldoutCommitted(committed)).not.toThrow()
    expect(() => assertAgentHoldoutCommitted({ ...committed, runAllowed: false })).toThrow(/runAllowed/i)
    expect(() => assertAgentHoldoutCommitted({ ...committed, commitmentSha256: 'not-a-hash' })).toThrow(/commitment/i)
    expect(() => assertAgentHoldoutCommitted({ ...committed, taskCount: 0 })).toThrow(/taskCount/i)
    expect(() => assertAgentHoldoutCommitted({
      ...committed,
      prerequisites: { ...committed.prerequisites, mcidFrozen: false },
    })).toThrow(/prerequisite/i)
  })

  it('binds a recorded result to the exact preregistered definition and frozen schedule', async () => {
    const sha256 = createNodeSha256Port()
    const taskIds = ['h1-01', 'h1-02']
    const schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-binding-v1', sha256)
    const base = definitionFixture()
    const definition = {
      ...base,
      recordType: 'definition',
      status: 'PREREGISTERED',
      dataset: { ...base.dataset, taskCount: taskIds.length },
      runOrder: {
        seed: 'm2-h1-binding-v1',
        trialsPerTaskArm: 3,
        schedule,
      },
    }
    const definitionSha256 = await hashEvaluationDefinition(definition, sha256)
    const runs = schedule.map(entry => ({
      ...entry,
      attempts: [{
        attempt: 1,
        outcome: 'model-outcome',
        startedAt: '2026-08-28T05:00:00.000Z',
        completedAt: '2026-08-28T05:00:10.000Z',
      }],
    }))
    const result = {
      ...definition,
      recordType: 'result',
      status: 'PASS',
      definitionSha256,
      executedAt: '2026-08-28T05:01:00.000Z',
      runs,
    }

    await expect(validateAgentResultAgainstDefinition(definition, result, sha256)).resolves.toBeUndefined()
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...result, definitionSha256: '0'.repeat(64) },
      sha256,
    )).rejects.toThrow(/definition hash/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...result, model: { ...result.model, snapshot: 'changed-after-unblinding' } },
      sha256,
    )).rejects.toThrow(/preregistration/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...result, runs: result.runs.slice(1) },
      sha256,
    )).rejects.toThrow(/schedule/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...result, runs: [result.runs[0]!, ...result.runs] },
      sha256,
    )).rejects.toThrow(/schedule/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...result, runs: result.runs.toReversed() },
      sha256,
    )).rejects.toThrow(/schedule/i)

    const retriedModelOutcome = structuredClone(result)
    retriedModelOutcome.runs[0]!.attempts = [
      ...retriedModelOutcome.runs[0]!.attempts,
      {
        attempt: 2,
        outcome: 'model-outcome',
        startedAt: '2026-08-28T05:00:11.000Z',
        completedAt: '2026-08-28T05:00:20.000Z',
      },
    ]
    await expect(validateAgentResultAgainstDefinition(
      definition,
      retriedModelOutcome,
      sha256,
    )).rejects.toThrow(/model outcome/i)
  })

  it('forces incomplete or unresolved B/C decision evidence to remain INCONCLUSIVE', async () => {
    const sha256 = createNodeSha256Port()
    const taskIds = ['h1-01']
    const schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-decision-v1', sha256)
    const base = definitionFixture()
    const definition = {
      ...base,
      recordType: 'definition',
      status: 'PREREGISTERED',
      dataset: { ...base.dataset, taskCount: taskIds.length },
      runOrder: {
        seed: 'm2-h1-decision-v1',
        trialsPerTaskArm: 3,
        schedule,
      },
    }
    const definitionSha256 = await hashEvaluationDefinition(definition, sha256)
    const runs = schedule.map(entry => ({
      ...entry,
      attempts: [{
        attempt: 1,
        outcome: 'model-outcome',
        startedAt: '2026-08-28T05:00:00.000Z',
        completedAt: '2026-08-28T05:00:10.000Z',
        parsedApiClaims: [] as { classification: 'VALID' | 'INVALID' | 'UNKNOWN' }[],
        taskSuccess: 'SUCCESS' as 'SUCCESS' | 'FAILURE' | 'UNKNOWN',
      }],
    }))
    const result = {
      ...definition,
      recordType: 'result',
      status: 'PASS',
      definitionSha256,
      executedAt: '2026-08-28T05:01:00.000Z',
      runs,
    }

    const incomplete = structuredClone(result)
    incomplete.runs[0]!.attempts = [{
      attempt: 1,
      outcome: 'infrastructure-failure',
      startedAt: '2026-08-28T05:00:00.000Z',
      completedAt: '2026-08-28T05:00:01.000Z',
      reason: 'provider-transport',
      parsedApiClaims: [],
      taskSuccess: 'SUCCESS',
    }]
    await expect(validateAgentResultAgainstDefinition(definition, incomplete, sha256))
      .rejects.toThrow(/inconclusive|model outcome/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...incomplete, status: 'INCONCLUSIVE' },
      sha256,
    )).resolves.toBeUndefined()

    const bcIndex = result.runs.findIndex(run => run.arm === 'B' || run.arm === 'C')
    expect(bcIndex).toBeGreaterThanOrEqual(0)

    const unknownSuccess = structuredClone(result)
    unknownSuccess.runs[bcIndex]!.attempts[0]!.taskSuccess = 'UNKNOWN'
    await expect(validateAgentResultAgainstDefinition(definition, unknownSuccess, sha256))
      .rejects.toThrow(/inconclusive|task success/i)

    const unknownClaim = structuredClone(result)
    unknownClaim.runs[bcIndex]!.attempts[0]!.parsedApiClaims = [{ classification: 'UNKNOWN' }]
    await expect(validateAgentResultAgainstDefinition(definition, unknownClaim, sha256))
      .rejects.toThrow(/inconclusive|api claim/i)
    await expect(validateAgentResultAgainstDefinition(
      definition,
      { ...unknownClaim, status: 'INCONCLUSIVE' },
      sha256,
    )).resolves.toBeUndefined()
  })
})