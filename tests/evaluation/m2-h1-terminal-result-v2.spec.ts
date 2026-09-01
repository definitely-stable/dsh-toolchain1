import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  canonicalizeEvaluationJson,
  createBalancedAgentSchedule,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import { adjudicateH1ModelOutcomeV2 } from './m2-h1-task-adjudication-v2.js'
import {
  createH1RunLedgerV2,
  type H1LedgerBindingV2,
  type H1RunLedgerV2,
} from './m2-h1-run-ledger-v2.js'
import {
  readCompletedH1RunStoreV2,
  reAdjudicateH1ModelAttemptV2,
} from './m2-h1-terminal-result-v2.js'

const rule = Object.freeze({
  kind: 'api-exists-any' as const,
  package: '@example/pkg',
  symbols: Object.freeze(['Service.run']),
})

const truth: ApiTruthUniverseV2 = Object.freeze({
  schema: 'dsh-api-truth-v2',
  targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
  workspaceSnapshotSha256: '2'.repeat(64),
  packages: Object.freeze([Object.freeze({
    name: '@example/pkg',
    version: '1.0.0',
    entrypoints: Object.freeze(['/exact-target/node_modules/@example/pkg/index.d.ts']),
    visitedDeclarations: Object.freeze(['/exact-target/node_modules/@example/pkg/index.d.ts']),
    unresolvedPublicEdges: Object.freeze([]),
    complete: true,
  })]),
  entries: Object.freeze([Object.freeze({
    package: '@example/pkg',
    kind: 'class-member' as const,
    symbol: 'run',
    qualifiedSymbol: 'Service.run',
    owner: 'Service',
    evidence: Object.freeze([Object.freeze({
      path: '/exact-target/node_modules/@example/pkg/index.d.ts',
      sha256: 'a'.repeat(64),
    })]),
  })]),
  fingerprint: `dsh-api-truth-v2:${'3'.repeat(64)}`,
})

const answer = 'API_CLAIM package=@example/pkg symbol=Service.run assertion=exists\nUse Service.run.'
const taskIds = Object.freeze(Array.from({ length: 96 }, (_, index) => `h1-terminal-${String(index + 1).padStart(3, '0')}`))
const binding: H1LedgerBindingV2 = Object.freeze({
  definitionSha256: '1'.repeat(64),
  datasetCommitmentSha256: '2'.repeat(64),
  providerIdentityReceiptSha256: '3'.repeat(64),
  expectedResponseModel: 'deepseek-v4-flash',
})
const retryPolicy: AgentRetryPolicy = Object.freeze({
  maxInfrastructureRetries: 1,
  modelOutcomeRetries: 0,
  retryableReasons: Object.freeze(['provider-transport', 'tool-transport']),
})

async function frozenSchedule() {
  return createBalancedAgentSchedule(taskIds, 'm2-h1-holdout-v2', createNodeSha256Port())
}

async function completeLedgerFixture(): Promise<{
  readonly ledger: H1RunLedgerV2
  readonly schedule: Awaited<ReturnType<typeof frozenSchedule>>
  readonly wrappers: readonly { readonly filename: string; readonly content: string }[]
}> {
  const sha256 = createNodeSha256Port()
  const schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-holdout-v2', sha256)
  const initial = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
  const entries: H1RunLedgerV2['entries'][number][] = []
  const wrappers: { filename: string; content: string }[] = []
  let previousEntrySha256: string | null = null

  for (let scheduleIndex = 0; scheduleIndex < schedule.length; scheduleIndex += 1) {
    const scheduled = schedule[scheduleIndex]!
    const result = Object.freeze({ marker: scheduleIndex })
    const evidenceSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(result))
    const entryMaterial = Object.freeze({
      sequence: scheduleIndex + 1,
      scheduleIndex,
      taskId: scheduled.taskId,
      arm: scheduled.arm,
      trial: scheduled.trial,
      attempt: 1,
      outcome: 'model-outcome' as const,
      evidenceSha256,
      responseModel: binding.expectedResponseModel,
      previousEntrySha256,
    })
    const entrySha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(entryMaterial))
    entries.push(Object.freeze({ ...entryMaterial, entrySha256 }))
    previousEntrySha256 = entrySha256

    const pendingIntentSha256 = await sha256.sha256Utf8(`pending-${scheduleIndex}`)
    wrappers.push(Object.freeze({
      filename: `${pendingIntentSha256}.json`,
      content: canonicalizeEvaluationJson(Object.freeze({
        schema: 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2',
        pendingIntentSha256,
        evidenceSha256,
        result,
      })),
    }))
  }

  return Object.freeze({
    ledger: Object.freeze({ header: initial.header, entries: Object.freeze(entries) }),
    schedule,
    wrappers: Object.freeze(wrappers),
  })
}

async function writeLedger(rootDir: string, ledger: H1RunLedgerV2): Promise<void> {
  await writeFile(join(rootDir, 'ledger.json'), canonicalizeEvaluationJson(ledger), 'utf8')
}

async function withTempRoot<T>(operation: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), 'm2-h1-terminal-result-'))
  try {
    return await operation(rootDir)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
}

async function readCompleted(rootDir: string, fixture: Awaited<ReturnType<typeof completeLedgerFixture>>) {
  return readCompletedH1RunStoreV2({
    rootDir,
    binding,
    schedule: fixture.schedule,
    taskIds,
    retryPolicy,
    sha256: createNodeSha256Port(),
  })
}

describe('M2 H1 terminal result v2', () => {
  it('re-adjudicates retained raw answer bytes when execution-time derived fields are pristine placeholders', () => {
    const fresh = adjudicateH1ModelOutcomeV2(rule, answer, truth)
    expect(reAdjudicateH1ModelAttemptV2(
      rule,
      answer,
      [],
      'UNKNOWN',
      truth,
    )).toEqual(fresh)
  })

  it('fails closed if execution-time derived fields are not pristine placeholders before terminal adjudication', () => {
    const stored = adjudicateH1ModelOutcomeV2(rule, answer, truth)
    expect(() => reAdjudicateH1ModelAttemptV2(
      rule,
      answer,
      stored.parsedApiClaims,
      stored.taskSuccess,
      truth,
    )).toThrow(/placeholder|pristine|adjudicat/u)
  })

  it('refuses a valid but partial NEXT ledger before reading durable evidence', async () => {
    await withTempRoot(async rootDir => {
      const schedule = await frozenSchedule()
      const ledger = await createH1RunLedgerV2(binding, schedule, taskIds, createNodeSha256Port())
      await writeLedger(rootDir, ledger)

      await expect(readCompletedH1RunStoreV2({
        rootDir,
        binding,
        schedule,
        taskIds,
        retryPolicy,
        sha256: createNodeSha256Port(),
      })).rejects.toThrow(/COMPLETE|NEXT/u)
    })
  })

  it('accepts an exact COMPLETE 864-entry ledger with one matching durable evidence object per entry', async () => {
    const fixture = await completeLedgerFixture()
    await withTempRoot(async rootDir => {
      await writeLedger(rootDir, fixture.ledger)
      const attemptsDir = join(rootDir, 'attempts')
      await mkdir(attemptsDir)
      await Promise.all(fixture.wrappers.map(wrapper => writeFile(
        join(attemptsDir, wrapper.filename),
        wrapper.content,
        'utf8',
      )))

      const snapshot = await readCompleted(rootDir, fixture)
      expect(snapshot.resume).toEqual({ status: 'COMPLETE', inconclusive: false })
      expect(snapshot.ledger.entries).toHaveLength(864)
      expect(snapshot.evidenceBySha256.size).toBe(864)
    })
  })

  it('fails closed when a COMPLETE ledger is missing durable attempt evidence', async () => {
    const fixture = await completeLedgerFixture()
    await withTempRoot(async rootDir => {
      await writeLedger(rootDir, fixture.ledger)
      await expect(readCompleted(rootDir, fixture)).rejects.toThrow(/evidence|missing/u)
    })
  })

  it('fails closed on durable evidence hash tamper before cardinality checks can hide it', async () => {
    const fixture = await completeLedgerFixture()
    await withTempRoot(async rootDir => {
      await writeLedger(rootDir, fixture.ledger)
      const attemptsDir = join(rootDir, 'attempts')
      await mkdir(attemptsDir)
      const first = fixture.wrappers[0]!
      const wrapper = JSON.parse(first.content) as Record<string, unknown>
      wrapper.evidenceSha256 = 'f'.repeat(64)
      await writeFile(join(attemptsDir, first.filename), canonicalizeEvaluationJson(wrapper), 'utf8')

      await expect(readCompleted(rootDir, fixture)).rejects.toThrow(/hash|drift|tamper/u)
    })
  })
})
