import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  canonicalizeEvaluationJson,
  createBalancedAgentSchedule,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  createModelEnvelope,
  type CapabilityManifest,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import {
  executeProcessAttemptWithEvidence,
  type ProcessAttemptEvidenceInput,
} from './m2-agent-process-runner.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'
import {
  createH1DurableInvocationIdV2,
  runH1DurableScheduleV2,
  type H1NextResumeV2,
} from './m2-h1-durable-schedule-runner-v2.js'
import {
  appendH1RunLedgerAttemptV2,
  createH1RunLedgerV2,
  type H1LedgerBindingV2,
  type H1RunLedgerV2,
} from './m2-h1-run-ledger-v2.js'
import {
  beginH1RunStoreAttemptV2,
  closeH1RunStoreV2,
  createH1RunStoreV2,
  inspectH1RunStoreV2,
  openH1RunStoreV2,
  type H1RunStoreV2,
} from './m2-h1-run-store-v2.js'
import { persistH1TerminalAttemptEvidenceV2 } from './m2-h1-attempt-coordinator-v2.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

const H1_SUCCESS = fileURLToPath(new URL(
  './fixtures/process-executor/h1-terminal-success.mjs',
  import.meta.url,
))
const INFRA_FAILURE = fileURLToPath(new URL(
  './fixtures/process-executor/infrastructure-error.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()
const taskIds = Object.freeze(Array.from(
  { length: 96 },
  (_, index) => `h1-schedule-runner-${String(index + 1).padStart(3, '0')}`,
))
const retryPolicy = Object.freeze<AgentRetryPolicy>({
  maxInfrastructureRetries: 1,
  modelOutcomeRetries: 0,
  retryableReasons: Object.freeze(['provider-transport', 'tool-transport', 'runner-infrastructure']),
})
const binding = Object.freeze<H1LedgerBindingV2>({
  definitionSha256: '1'.repeat(64),
  datasetCommitmentSha256: '2'.repeat(64),
  providerIdentityReceiptSha256: '3'.repeat(64),
  expectedResponseModel: 'deepseek-v4-flash',
})
const resourcePolicy = Object.freeze<ResourcePolicy>({
  maxWallTimeMs: 300000,
  maxTurns: 12,
  maxAttempts: 2,
  concurrency: 1,
  maxInputTokens: 30000,
  maxOutputTokens: 6000,
  tokenMeasurementRequired: true,
})

let schedule: readonly AgentScheduleEntry[]
let completeLedger: H1RunLedgerV2
const roots: string[] = []
const stores: H1RunStoreV2[] = []

function evidenceSha(index: number): string {
  return (index + 1).toString(16).padStart(64, '0')
}

beforeAll(async () => {
  schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-durable-schedule-runner-fixture-v2', sha256)
  let ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
  for (let scheduleIndex = 0; scheduleIndex < schedule.length; scheduleIndex += 1) {
    const entry = schedule[scheduleIndex]!
    ledger = await appendH1RunLedgerAttemptV2(
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
        attempt: 1,
        outcome: 'model-outcome',
        evidenceSha256: evidenceSha(scheduleIndex),
        responseModel: binding.expectedResponseModel,
      },
      sha256,
    )
  }
  completeLedger = ledger
})

afterEach(async () => {
  while (stores.length > 0) {
    await closeH1RunStoreV2(stores.pop()!).catch(() => undefined)
  }
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true })
  }
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-h1-schedule-runner-'))
  roots.push(root)
  return root
}

async function createStore(root: string): Promise<H1RunStoreV2> {
  const opened = await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
  stores.push(opened.store)
  return opened.store
}

async function openStore(root: string): Promise<H1RunStoreV2> {
  const opened = await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)
  stores.push(opened.store)
  return opened.store
}

function resumeFor(scheduleIndex: number, attempt = 1, inconclusive = false): H1NextResumeV2 {
  const entry = schedule[scheduleIndex]!
  return {
    status: 'NEXT',
    scheduleIndex,
    taskId: entry.taskId,
    arm: entry.arm,
    trial: entry.trial,
    attempt,
    inconclusive,
  }
}

function capabilityManifest(arm: 'A' | 'B' | 'C'): CapabilityManifest {
  return {
    schema: 'dsh-toolchain-m2-capability-manifest-v1',
    arm,
    ordinaryEvidence: arm === 'A'
      ? null
      : {
          workspaceSnapshotSha256: 'a'.repeat(64),
          roots: ['/workspace/target'],
          readOnly: true,
          staticDocsSha256: 'b'.repeat(64),
          networkPolicy: 'provider-only',
          search: { backend: 'fixture-search', version: '1', maxResults: 20 },
        },
    tools: [],
  }
}

function attemptInput(
  resume: H1NextResumeV2,
  executorPath = H1_SUCCESS,
): ProcessAttemptEvidenceInput {
  const manifest = capabilityManifest(resume.arm)
  const modelEnvelope = createModelEnvelope({
    systemPrompt: 'Synthetic durable H1 schedule-runner fixture.',
    task: { id: resume.taskId, prompt: `Synthetic prompt for ${resume.taskId}` },
    staticContext: [],
    capabilityManifest: manifest,
  })
  let clock = Date.parse('2026-08-30T16:00:00.000Z')
  return {
    identity: {
      evaluationId: 'm2-agent-h1-v2-schedule-runner-fixture',
      phase: 'H1',
      taskId: resume.taskId,
      arm: resume.arm,
      trial: resume.trial,
      attempt: resume.attempt,
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      datasetCommitmentSha256: binding.datasetCommitmentSha256,
    },
    capabilityManifest: manifest,
    resourcePolicy,
    retryPolicy,
    executorIdentity: {
      provider: 'fixture-provider',
      model: binding.expectedResponseModel,
      snapshot: `provider-identity-receipt:${binding.providerIdentityReceiptSha256}`,
    },
    modelEnvelope,
    isolation: {
      sessionIdSha256: '7'.repeat(64),
      workspaceMode: resume.arm === 'A' ? 'fresh' : 'read-only-reset',
      workspaceSnapshotSha256: 'a'.repeat(64),
      ordinaryEvidenceSha256: 'b'.repeat(64),
      mutableEnvironmentIdSha256: '8'.repeat(64),
    },
    process: {
      command: process.execPath,
      args: [executorPath],
      cwd: process.cwd(),
      environment: { PATH: process.env.PATH ?? '' },
      timeoutMs: 5000,
      maxStdoutBytes: 64 * 1024,
      maxStderrBytes: 16 * 1024,
    },
    createToolRuntime: async runControlSha256 => {
      const broker = await createFrozenToolchainBroker(runControlSha256)
      return {
        dispatchToolCall: async request => {
          throw new Error(`unexpected fixture tool request: ${request.name}`)
        },
        traceReceipt: broker.traceReceipt,
      }
    },
    sha256,
    now: () => {
      const current = clock
      clock += 1000
      return current
    },
  }
}

describe('M2.3 H1 durable schedule runner v2', () => {
  it('pauses only at a clean boundary and resumes from the exact next tuple without replay', async () => {
    const root = await newRoot()
    let store = await createStore(root)
    const firstCalls: Array<[number, number]> = []

    const first = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      maxCommittedAttempts: 3,
      buildAttemptInput: async resume => {
        firstCalls.push([resume.scheduleIndex, resume.attempt])
        return attemptInput(resume)
      },
    })

    expect(first).toMatchObject({
      status: 'PAUSED',
      committedAttempts: 3,
      state: { status: 'NEXT', resume: { scheduleIndex: 3, attempt: 1 } },
    })
    expect(firstCalls).toEqual([[0, 1], [1, 1], [2, 1]])
    await closeH1RunStoreV2(store)

    store = await openStore(root)
    const resumedCalls: Array<[number, number]> = []
    const resumed = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      maxCommittedAttempts: 2,
      buildAttemptInput: async resume => {
        resumedCalls.push([resume.scheduleIndex, resume.attempt])
        return attemptInput(resume)
      },
    })

    expect(resumed).toMatchObject({
      status: 'PAUSED',
      committedAttempts: 2,
      state: { status: 'NEXT', resume: { scheduleIndex: 5, attempt: 1 } },
    })
    expect(resumedCalls).toEqual([[3, 1], [4, 1]])
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as { entries: unknown[] }
    expect(ledger.entries).toHaveLength(5)
  })

  it('follows the ledger retry cursor from infrastructure attempt one to model attempt two', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const calls: Array<[number, number]> = []

    const result = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      maxCommittedAttempts: 2,
      buildAttemptInput: async resume => {
        calls.push([resume.scheduleIndex, resume.attempt])
        return attemptInput(resume, resume.attempt === 1 ? INFRA_FAILURE : H1_SUCCESS)
      },
    })

    expect(calls).toEqual([[0, 1], [0, 2]])
    expect(result).toMatchObject({
      status: 'PAUSED',
      committedAttempts: 2,
      state: { status: 'NEXT', resume: { scheduleIndex: 1, attempt: 1 } },
    })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as {
      entries: Array<{ outcome: string; attempt: number; scheduleIndex: number; reason?: string }>
    }
    expect(ledger.entries.map(entry => ({
      outcome: entry.outcome,
      attempt: entry.attempt,
      scheduleIndex: entry.scheduleIndex,
      reason: entry.reason,
    }))).toEqual([
      { outcome: 'infrastructure-failure', attempt: 1, scheduleIndex: 0, reason: 'provider-transport' },
      { outcome: 'model-outcome', attempt: 2, scheduleIndex: 0, reason: undefined },
    ])
  })

  it('commits already-persisted terminal evidence on reopen and never rebuilds that recovered attempt', async () => {
    const root = await newRoot()
    let store = await createStore(root)
    const pending = await beginH1RunStoreAttemptV2(store, 'fixture-manual-recovery')
    const terminal = await executeProcessAttemptWithEvidence(attemptInput(resumeFor(0)))
    await persistH1TerminalAttemptEvidenceV2(store, binding, pending, terminal, sha256)
    await closeH1RunStoreV2(store)

    store = await openStore(root)
    const calls: Array<[number, number]> = []
    const result = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      maxCommittedAttempts: 2,
      buildAttemptInput: async resume => {
        calls.push([resume.scheduleIndex, resume.attempt])
        return attemptInput(resume)
      },
    })

    expect(result).toMatchObject({
      status: 'PAUSED',
      committedAttempts: 2,
      state: { status: 'NEXT', resume: { scheduleIndex: 2, attempt: 1 } },
    })
    expect(calls).toEqual([[1, 1]])
  })

  it('returns RECOVERY_REQUIRED without rebuilding or replaying a pending attempt that has no durable terminal evidence', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    await beginH1RunStoreAttemptV2(store, 'fixture-unresolved-pending')
    let factoryCalls = 0

    const result = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      buildAttemptInput: async resume => {
        factoryCalls += 1
        return attemptInput(resume)
      },
    })

    expect(result).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      committedAttempts: 0,
      state: { status: 'RECOVERY_REQUIRED', pending: { scheduleIndex: 0, attempt: 1 } },
    })
    expect(factoryCalls).toBe(0)
  })

  it('leaves the store at the same NEXT tuple when the attempt factory fails before durable begin', async () => {
    const root = await newRoot()
    const store = await createStore(root)

    await expect(runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      buildAttemptInput: async () => {
        throw new Error('fixture factory failed before begin')
      },
    })).rejects.toThrow(/factory failed before begin/iu)

    expect(await inspectH1RunStoreV2(store)).toMatchObject({
      status: 'NEXT',
      resume: { scheduleIndex: 0, attempt: 1 },
    })
    await expect(readFile(join(root, 'pending-attempt.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('propagates a post-begin execution failure and leaves deterministic pending state for recovery', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const firstResume = resumeFor(0)
    const expectedInvocationId = await createH1DurableInvocationIdV2(binding, firstResume, sha256)

    await expect(runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      buildAttemptInput: async resume => {
        const base = attemptInput(resume)
        return {
          ...base,
          createToolRuntime: async () => {
            throw new Error('fixture execution failed after begin')
          },
        }
      },
    })).rejects.toThrow(/execution failed after begin/iu)

    expect(await inspectH1RunStoreV2(store)).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      pending: {
        invocationId: expectedInvocationId,
        scheduleIndex: 0,
        attempt: 1,
      },
    })
  })

  it('derives stable invocation ids only from the frozen binding and exact resume tuple', async () => {
    const first = resumeFor(0)
    const same = { ...first }
    const retry = { ...first, attempt: 2 }

    const firstId = await createH1DurableInvocationIdV2(binding, first, sha256)
    expect(firstId).toMatch(/^dsh-toolchain-m2-h1-invocation-v2:[0-9a-f]{64}$/u)
    await expect(createH1DurableInvocationIdV2(binding, same, sha256)).resolves.toBe(firstId)
    await expect(createH1DurableInvocationIdV2(binding, retry, sha256)).resolves.not.toBe(firstId)
    await expect(createH1DurableInvocationIdV2(
      { ...binding, definitionSha256: 'f'.repeat(64) },
      first,
      sha256,
    )).resolves.not.toBe(firstId)
  })

  it('returns COMPLETE without invoking the factory when the canonical ledger is already complete', async () => {
    const root = await newRoot()
    let store = await createStore(root)
    await closeH1RunStoreV2(store)
    await writeFile(join(root, 'ledger.json'), canonicalizeEvaluationJson(completeLedger), 'utf8')
    store = await openStore(root)
    let factoryCalls = 0

    const result = await runH1DurableScheduleV2({
      store,
      binding,
      sha256,
      buildAttemptInput: async resume => {
        factoryCalls += 1
        return attemptInput(resume)
      },
    })

    expect(result).toEqual({
      status: 'COMPLETE',
      committedAttempts: 0,
      state: {
        status: 'COMPLETE',
        resume: { status: 'COMPLETE', inconclusive: false },
        orphanedTempFiles: [],
        recoveredCommittedIntent: false,
      },
    })
    expect(factoryCalls).toBe(0)
  })
})