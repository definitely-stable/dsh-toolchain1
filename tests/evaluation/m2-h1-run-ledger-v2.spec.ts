import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createBalancedAgentSchedule,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  appendH1RunLedgerAttemptV2,
  createH1RunLedgerV2,
  validateH1RunLedgerV2,
  type H1LedgerBindingV2,
  type H1RunLedgerV2,
} from './m2-h1-run-ledger-v2.js'

const sha256 = createNodeSha256Port()
const taskIds = Object.freeze(Array.from({ length: 96 }, (_, index) => `h1-synthetic-${String(index + 1).padStart(3, '0')}`))
const retryPolicy = Object.freeze<AgentRetryPolicy>({
  maxInfrastructureRetries: 1,
  modelOutcomeRetries: 0,
  retryableReasons: Object.freeze(['provider-transport', 'tool-transport']),
})
const binding = Object.freeze<H1LedgerBindingV2>({
  definitionSha256: '1'.repeat(64),
  datasetCommitmentSha256: '2'.repeat(64),
  providerIdentityReceiptSha256: '3'.repeat(64),
  expectedResponseModel: 'deepseek-v4-flash',
  expectedBackendFingerprint: 'fp_h1_ledger_fixture',
})

let schedule: readonly AgentScheduleEntry[]

beforeAll(async () => {
  schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-ledger-fixture-v2', sha256)
})

function evidenceSha(index: number): string {
  return index.toString(16).padStart(64, '0')
}

async function appendModelOutcome(
  ledger: H1RunLedgerV2,
  scheduleIndex: number,
  attempt = 1,
): Promise<H1RunLedgerV2> {
  const entry = schedule[scheduleIndex]!
  return appendH1RunLedgerAttemptV2(
    ledger,
    binding,
    schedule,
    taskIds,
    retryPolicy,
    {
      scheduleIndex,
      taskId: entry.taskId,
      arm: entry.arm,
      trial: entry.trial,
      attempt,
      outcome: 'model-outcome',
      evidenceSha256: evidenceSha(scheduleIndex + attempt + 1),
      responseModel: binding.expectedResponseModel,
      systemFingerprint: binding.expectedBackendFingerprint,
    },
    sha256,
  )
}

describe('M2.3 H1 append-only run ledger v2', () => {
  it('starts at the first of the exact 864 balanced runs', async () => {
    const ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    const resume = await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)

    expect(ledger.header.scheduleLength).toBe(864)
    expect(ledger.entries).toEqual([])
    expect(resume).toEqual({
      status: 'NEXT',
      scheduleIndex: 0,
      ...schedule[0],
      attempt: 1,
      inconclusive: false,
    })
  })

  it('resumes after completed model outcomes without repeating any completed run', async () => {
    let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    for (let index = 0; index < 200; index += 1) {
      ledger = await appendModelOutcome(ledger, index)
    }

    const resumed = await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)
    expect(resumed).toEqual({
      status: 'NEXT',
      scheduleIndex: 200,
      ...schedule[200],
      attempt: 1,
      inconclusive: false,
    })

    await expect(appendModelOutcome(ledger, 199, 2)).rejects.toThrow(/next|schedule|completed|terminal/iu)
  })

  it('retries only retryable infrastructure failure within the same scheduled run', async () => {
    let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    const first = schedule[0]!
    ledger = await appendH1RunLedgerAttemptV2(
      ledger,
      binding,
      schedule,
      taskIds,
      retryPolicy,
      {
        scheduleIndex: 0,
        taskId: first.taskId,
        arm: first.arm,
        trial: first.trial,
        attempt: 1,
        outcome: 'infrastructure-failure',
        reason: 'provider-transport',
        evidenceSha256: evidenceSha(900),
      },
      sha256,
    )

    expect(await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)).toEqual({
      status: 'NEXT',
      scheduleIndex: 0,
      ...first,
      attempt: 2,
      inconclusive: false,
    })

    ledger = await appendModelOutcome(ledger, 0, 2)
    expect((await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256))).toMatchObject({
      status: 'NEXT',
      scheduleIndex: 1,
      attempt: 1,
      inconclusive: false,
    })
  })

  it('advances after exhausted infrastructure retries and preserves an inconclusive decision path', async () => {
    let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    const first = schedule[0]!

    for (const attempt of [1, 2] as const) {
      ledger = await appendH1RunLedgerAttemptV2(
        ledger,
        binding,
        schedule,
        taskIds,
        retryPolicy,
        {
          scheduleIndex: 0,
          taskId: first.taskId,
          arm: first.arm,
          trial: first.trial,
          attempt,
          outcome: 'infrastructure-failure',
          reason: 'provider-transport',
          evidenceSha256: evidenceSha(910 + attempt),
        },
        sha256,
      )
    }

    expect(await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)).toEqual({
      status: 'NEXT',
      scheduleIndex: 1,
      ...schedule[1],
      attempt: 1,
      inconclusive: true,
    })
  })

  it('fails closed on provider identity drift before appending a model outcome', async () => {
    const ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    const first = schedule[0]!

    await expect(appendH1RunLedgerAttemptV2(
      ledger,
      binding,
      schedule,
      taskIds,
      retryPolicy,
      {
        scheduleIndex: 0,
        taskId: first.taskId,
        arm: first.arm,
        trial: first.trial,
        attempt: 1,
        outcome: 'model-outcome',
        evidenceSha256: evidenceSha(920),
        responseModel: binding.expectedResponseModel,
        systemFingerprint: 'fp_drifted_backend',
      },
      sha256,
    )).rejects.toThrow(/provider|backend|fingerprint/iu)
  })

  it('fails closed when reopened against drifted definition or schedule binding', async () => {
    const ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    await expect(validateH1RunLedgerV2(
      ledger,
      { ...binding, definitionSha256: 'f'.repeat(64) },
      schedule,
      taskIds,
      retryPolicy,
      sha256,
    )).rejects.toThrow(/binding|definition/iu)

    const driftedSchedule = [...schedule]
    ;[driftedSchedule[0], driftedSchedule[1]] = [driftedSchedule[1]!, driftedSchedule[0]!]
    await expect(validateH1RunLedgerV2(
      ledger,
      binding,
      driftedSchedule,
      taskIds,
      retryPolicy,
      sha256,
    )).rejects.toThrow(/schedule|binding|hash/iu)
  })

  it('detects hash-chain tampering in retained attempt evidence', async () => {
    let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    ledger = await appendModelOutcome(ledger, 0)
    const tampered = structuredClone(ledger) as unknown as {
      entries: Array<{ evidenceSha256: string }>
    }
    tampered.entries[0]!.evidenceSha256 = evidenceSha(999)

    await expect(validateH1RunLedgerV2(
      tampered,
      binding,
      schedule,
      taskIds,
      retryPolicy,
      sha256,
    )).rejects.toThrow(/hash|chain|tamper/iu)
  })

  it('reaches COMPLETE exactly after all 864 scheduled model outcomes', async () => {
    let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    for (let index = 0; index < schedule.length; index += 1) {
      ledger = await appendModelOutcome(ledger, index)
    }

    expect(await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)).toEqual({
      status: 'COMPLETE',
      inconclusive: false,
    })
    expect(ledger.entries).toHaveLength(864)
  }, 30_000)
})
