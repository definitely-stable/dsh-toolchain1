import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createBalancedAgentSchedule,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'
import {
  beginH1RunStoreAttemptV2,
  closeH1RunStoreV2,
  commitH1RunStoreAttemptV2,
  createH1RunStoreV2,
  inspectH1RunStoreV2,
  openH1RunStoreV2,
  type H1RunStoreV2,
} from './m2-h1-run-store-v2.js'

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
  expectedBackendFingerprint: 'fp_h1_store_fixture',
})

let schedule: readonly AgentScheduleEntry[]
const roots: string[] = []
const openStores = new Set<H1RunStoreV2>()

beforeAll(async () => {
  schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-store-fixture-v2', sha256)
})

afterEach(async () => {
  for (const store of [...openStores]) {
    await closeH1RunStoreV2(store).catch(() => undefined)
    openStores.delete(store)
  }
  await Promise.all(roots.splice(0).map(async root => rm(root, { recursive: true, force: true })))
})

async function rootDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-h1-store-'))
  roots.push(root)
  return root
}

function track(result: { store: H1RunStoreV2 }): H1RunStoreV2 {
  openStores.add(result.store)
  return result.store
}

async function closeTracked(store: H1RunStoreV2): Promise<void> {
  await closeH1RunStoreV2(store)
  openStores.delete(store)
}

function evidenceSha(value: number): string {
  return value.toString(16).padStart(64, '0')
}

async function commitNextModelOutcome(store: H1RunStoreV2, invocationId: string, evidence: number) {
  const pending = await beginH1RunStoreAttemptV2(store, invocationId)
  return commitH1RunStoreAttemptV2(store, invocationId, {
    scheduleIndex: pending.scheduleIndex,
    taskId: pending.taskId,
    arm: pending.arm,
    trial: pending.trial,
    attempt: pending.attempt,
    outcome: 'model-outcome',
    evidenceSha256: evidenceSha(evidence),
    responseModel: binding.expectedResponseModel,
    systemFingerprint: binding.expectedBackendFingerprint,
  })
}

describe('M2.3 H1 crash-safe filesystem run store v2', () => {
  it('creates canonical progress and reopens at the exact next run', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)

    expect(created.state).toMatchObject({
      status: 'NEXT',
      recoveredCommittedIntent: false,
      orphanedTempFiles: [],
      resume: { scheduleIndex: 0, attempt: 1 },
    })
    expect(JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8'))).toMatchObject({
      header: { schema: 'dsh-toolchain-m2-h1-run-ledger-v2', scheduleLength: 864 },
      entries: [],
    })

    await commitNextModelOutcome(store, 'invocation-001', 1)
    await closeTracked(store)

    const reopened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    track(reopened)
    expect(reopened.state).toMatchObject({
      status: 'NEXT',
      recoveredCommittedIntent: false,
      resume: { scheduleIndex: 1, attempt: 1 },
    })
  })

  it('never permits automatic replay when a durable pending intent has no committed terminal entry', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    const pending = await beginH1RunStoreAttemptV2(store, 'invocation-ambiguous')

    expect(pending).toMatchObject({
      schema: 'dsh-toolchain-m2-h1-pending-attempt-v2',
      scheduleIndex: 0,
      attempt: 1,
      preEntryCount: 0,
      preTailEntrySha256: null,
    })
    expect(pending.intentSha256).toMatch(/^[0-9a-f]{64}$/u)
    await closeTracked(store)

    const reopened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    track(reopened)
    expect(reopened.state).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      recoveredCommittedIntent: false,
      pending: { invocationId: 'invocation-ambiguous', scheduleIndex: 0, attempt: 1 },
    })
    await expect(beginH1RunStoreAttemptV2(reopened.store, 'must-not-replay')).rejects.toThrow(/recovery|pending|replay/iu)
  })

  it('commits only the matching pending attempt and persists infra retry state', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    const pending = await beginH1RunStoreAttemptV2(store, 'invocation-retry-1')

    await expect(commitH1RunStoreAttemptV2(store, 'wrong-invocation', {
      scheduleIndex: pending.scheduleIndex,
      taskId: pending.taskId,
      arm: pending.arm,
      trial: pending.trial,
      attempt: pending.attempt,
      outcome: 'infrastructure-failure',
      reason: 'provider-transport',
      evidenceSha256: evidenceSha(20),
    })).rejects.toThrow(/pending|invocation|match/iu)

    const state = await commitH1RunStoreAttemptV2(store, 'invocation-retry-1', {
      scheduleIndex: pending.scheduleIndex,
      taskId: pending.taskId,
      arm: pending.arm,
      trial: pending.trial,
      attempt: pending.attempt,
      outcome: 'infrastructure-failure',
      reason: 'provider-transport',
      evidenceSha256: evidenceSha(21),
    })
    expect(state).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: 0, attempt: 2 } })
    await expect(readFile(join(root, 'pending-attempt.json'), 'utf8')).rejects.toThrow()
  })

  it('recovers a crash after ledger commit but before redundant pending-intent cleanup without replay', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    await beginH1RunStoreAttemptV2(store, 'invocation-commit-crash')
    const pendingBytes = await readFile(join(root, 'pending-attempt.json'), 'utf8')
    await commitH1RunStoreAttemptV2(store, 'invocation-commit-crash', {
      scheduleIndex: 0,
      taskId: schedule[0]!.taskId,
      arm: schedule[0]!.arm,
      trial: schedule[0]!.trial,
      attempt: 1,
      outcome: 'model-outcome',
      evidenceSha256: evidenceSha(30),
      responseModel: binding.expectedResponseModel,
      systemFingerprint: binding.expectedBackendFingerprint,
    })
    await writeFile(join(root, 'pending-attempt.json'), pendingBytes, 'utf8')
    await closeTracked(store)

    const reopened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    track(reopened)
    expect(reopened.state).toMatchObject({
      status: 'NEXT',
      recoveredCommittedIntent: true,
      resume: { scheduleIndex: 1, attempt: 1 },
    })
    await expect(readFile(join(root, 'pending-attempt.json'), 'utf8')).rejects.toThrow()
  })

  it('blocks concurrent active writers and conservatively recovers a dead local lock', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    await expect(openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)).rejects.toThrow(/lock|writer|active/iu)
    await closeTracked(store)

    await writeFile(join(root, 'writer.lock'), JSON.stringify({
      schema: 'dsh-toolchain-m2-h1-writer-lock-v2',
      pid: 2_147_483_647,
      ownerNonce: 'dead-owner-fixture',
    }), 'utf8')
    const reopened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    track(reopened)
    expect(reopened.state.status).toBe('NEXT')
  })

  it('never promotes orphan temp files and surfaces them for audit', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    await writeFile(join(root, '.ledger.json.tmp-orphan-fixture'), '{"fake":"progress"}', 'utf8')

    const state = await inspectH1RunStoreV2(store)
    expect(state.orphanedTempFiles).toContain('.ledger.json.tmp-orphan-fixture')
    expect(state).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: 0, attempt: 1 } })
  })

  it('fails closed on truncated or tampered canonical ledger and does not leave a stolen lock', async () => {
    const root = await rootDir()
    const created = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    const store = track(created)
    await closeTracked(store)

    await writeFile(join(root, 'ledger.json'), '{"header":', 'utf8')
    await expect(openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)).rejects.toThrow(/json|ledger|parse|unexpected/iu)

    const recreated = await createH1RunStoreV2(await rootDir(), binding, schedule, taskIds, retryPolicy, sha256)
    track(recreated)
    const ledgerPath = join(recreated.store.rootDir, 'ledger.json')
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8')) as { header: { definitionSha256: string } }
    ledger.header.definitionSha256 = 'f'.repeat(64)
    await writeFile(ledgerPath, JSON.stringify(ledger), 'utf8')
    await closeTracked(recreated.store)
    await expect(openH1RunStoreV2(recreated.store.rootDir, binding, schedule, taskIds, retryPolicy, sha256))
      .rejects.toThrow(/definition|binding|ledger/iu)
  })

  it('preserves committed progress across repeated close/reopen cycles without rerunning completed model outcomes', async () => {
    const root = await rootDir()
    let opened = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
    let store = track(opened)

    for (let index = 0; index < 12; index += 1) {
      const state = await commitNextModelOutcome(store, `invocation-cycle-${index}`, 100 + index)
      expect(state).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: index + 1, attempt: 1 } })
      await closeTracked(store)
      opened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
      store = track(opened)
      expect(opened.state).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: index + 1, attempt: 1 } })
    }
  })
})
