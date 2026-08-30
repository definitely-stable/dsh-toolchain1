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
import { executeProcessAttemptWithEvidence, type ProcessAttemptEvidenceInput } from './m2-agent-process-runner.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'
import {
  executeH1DurableAttemptV2,
  persistH1TerminalAttemptEvidenceV2,
  recoverH1DurableAttemptV2,
} from './m2-h1-attempt-coordinator-v2.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'
import {
  beginH1RunStoreAttemptV2,
  closeH1RunStoreV2,
  createH1RunStoreV2,
  inspectH1RunStoreV2,
  openH1RunStoreV2,
  type H1RunStoreV2,
} from './m2-h1-run-store-v2.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

const H1_SUCCESS = fileURLToPath(new URL(
  './fixtures/process-executor/h1-terminal-success.mjs',
  import.meta.url,
))
const INFRA_FAILURE = fileURLToPath(new URL(
  './fixtures/process-executor/infrastructure-error.mjs',
  import.meta.url,
))
const WEAK_METADATA = fileURLToPath(new URL(
  './fixtures/process-executor/provider-metadata.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()
const taskIds = Object.freeze(Array.from(
  { length: 96 },
  (_, index) => `h1-coordinator-${String(index + 1).padStart(3, '0')}`,
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
  expectedBackendFingerprint: 'fp_h1_coordinator_fixture',
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
const roots: string[] = []

beforeAll(async () => {
  schedule = await createBalancedAgentSchedule(taskIds, 'm2-h1-coordinator-fixture-v2', sha256)
})

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true })
  }
})

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-h1-coordinator-'))
  roots.push(root)
  return root
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
  entry: AgentScheduleEntry,
  attempt: number,
  executorPath = H1_SUCCESS,
): ProcessAttemptEvidenceInput {
  const manifest = capabilityManifest(entry.arm)
  const modelEnvelope = createModelEnvelope({
    systemPrompt: 'Synthetic H1 coordinator fixture. No external evidence is required.',
    task: { id: entry.taskId, prompt: `Synthetic prompt for ${entry.taskId}` },
    staticContext: [],
    capabilityManifest: manifest,
  })
  let clock = Date.parse('2026-08-30T15:00:00.000Z')
  return {
    identity: {
      evaluationId: 'm2-agent-h1-v2-coordinator-fixture',
      phase: 'H1',
      taskId: entry.taskId,
      arm: entry.arm,
      trial: entry.trial,
      attempt,
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
      snapshot: binding.expectedBackendFingerprint,
    },
    modelEnvelope,
    isolation: {
      sessionIdSha256: '7'.repeat(64),
      workspaceMode: 'read-only-reset',
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

async function createStore(root: string): Promise<H1RunStoreV2> {
  return (await createH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)).store
}

describe('M2.3 H1 durable single-attempt coordinator v2', () => {
  it('persists terminal model evidence before committing the exact ledger outcome', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!

    const committed = await executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-model-1',
      attemptInput: attemptInput(first, 1),
      sha256,
    })

    expect(committed.status).toBe('COMMITTED')
    expect(committed.state).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: 1, attempt: 1 } })
    const evidence = JSON.parse(await readFile(committed.evidencePath, 'utf8')) as {
      pendingIntentSha256: string
      evidenceSha256: string
      result: { attempt: { outcome: string } }
    }
    expect(evidence.pendingIntentSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(evidence.evidenceSha256).toBe(committed.evidenceSha256)
    expect(evidence.result.attempt.outcome).toBe('model-outcome')

    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as {
      entries: Array<{ evidenceSha256: string; responseModel?: string; systemFingerprint?: string }>
    }
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toMatchObject({
      evidenceSha256: committed.evidenceSha256,
      responseModel: binding.expectedResponseModel,
      systemFingerprint: binding.expectedBackendFingerprint,
    })
    await closeH1RunStoreV2(store)
  })

  it('persists a retryable infrastructure terminal and keeps the exact run at attempt two', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!

    const committed = await executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-infra-1',
      attemptInput: attemptInput(first, 1, INFRA_FAILURE),
      sha256,
    })

    expect(committed.state).toEqual({
      status: 'NEXT',
      resume: { status: 'NEXT', scheduleIndex: 0, ...first, attempt: 2, inconclusive: false },
      orphanedTempFiles: [],
      recoveredCommittedIntent: false,
    })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as {
      entries: Array<{ outcome: string; reason?: string; evidenceSha256: string }>
    }
    expect(ledger.entries[0]).toMatchObject({
      outcome: 'infrastructure-failure',
      reason: 'provider-transport',
      evidenceSha256: committed.evidenceSha256,
    })
    await closeH1RunStoreV2(store)
  })

  it('rejects a wrong H1 tuple before creating durable intent or invoking the process', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!
    const baseWrong = attemptInput(first, 1)
    const wrong: ProcessAttemptEvidenceInput = {
      ...baseWrong,
      identity: { ...baseWrong.identity, taskId: 'wrong-task-id' },
    }

    await expect(executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-wrong-1',
      attemptInput: wrong,
      sha256,
    })).rejects.toThrow(/next|task|identity|tuple/iu)

    expect(await inspectH1RunStoreV2(store)).toMatchObject({ status: 'NEXT', resume: { scheduleIndex: 0 } })
    await expect(readFile(join(root, 'pending-attempt.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await closeH1RunStoreV2(store)
  })

  it('leaves RECOVERY_REQUIRED when execution throws after durable begin instead of manufacturing a retry', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!
    const baseInput = attemptInput(first, 1)
    const input: ProcessAttemptEvidenceInput = {
      ...baseInput,
      createToolRuntime: async () => {
        throw new Error('fixture crash after begin')
      },
    }

    await expect(executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-crash-1',
      attemptInput: input,
      sha256,
    })).rejects.toThrow(/fixture crash/iu)

    expect(await inspectH1RunStoreV2(store)).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      pending: { scheduleIndex: 0, ...first, attempt: 1 },
    })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as { entries: unknown[] }
    expect(ledger.entries).toEqual([])
    await closeH1RunStoreV2(store)
  })

  it('recovers exact durable terminal evidence after a crash before ledger commit without executing again', async () => {
    const root = await newRoot()
    let store = await createStore(root)
    const first = schedule[0]!
    const pending = await beginH1RunStoreAttemptV2(store, 'fixture-invocation-recovery-1')
    const terminal = await executeProcessAttemptWithEvidence(attemptInput(first, 1))
    const persisted = await persistH1TerminalAttemptEvidenceV2(store, binding, pending, terminal, sha256)
    await closeH1RunStoreV2(store)

    store = (await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)).store
    expect(await inspectH1RunStoreV2(store)).toMatchObject({ status: 'RECOVERY_REQUIRED' })

    const recovered = await recoverH1DurableAttemptV2(store, binding, sha256)
    expect(recovered).toMatchObject({
      status: 'RECOVERED',
      evidenceSha256: persisted.evidenceSha256,
      state: { status: 'NEXT', resume: { scheduleIndex: 1, attempt: 1 } },
    })
    await closeH1RunStoreV2(store)
  })

  it('fails closed on durable evidence tamper instead of promoting it into the ledger', async () => {
    const root = await newRoot()
    let store = await createStore(root)
    const first = schedule[0]!
    const pending = await beginH1RunStoreAttemptV2(store, 'fixture-invocation-tamper-1')
    const terminal = await executeProcessAttemptWithEvidence(attemptInput(first, 1))
    const persisted = await persistH1TerminalAttemptEvidenceV2(store, binding, pending, terminal, sha256)
    await closeH1RunStoreV2(store)

    const wrapper = JSON.parse(await readFile(persisted.evidencePath, 'utf8')) as Record<string, unknown>
    wrapper.evidenceSha256 = 'f'.repeat(64)
    await writeFile(persisted.evidencePath, canonicalizeEvaluationJson(wrapper), 'utf8')

    store = (await openH1RunStoreV2(root, binding, schedule, taskIds, retryPolicy, sha256)).store
    await expect(recoverH1DurableAttemptV2(store, binding, sha256)).rejects.toThrow(/evidence|hash|tamper/iu)
    expect(await inspectH1RunStoreV2(store)).toMatchObject({ status: 'RECOVERY_REQUIRED' })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as { entries: unknown[] }
    expect(ledger.entries).toEqual([])
    await closeH1RunStoreV2(store)
  })

  it('rejects a model outcome without strong response model and backend fingerprint and never commits it', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!

    await expect(executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-weak-provider-1',
      attemptInput: attemptInput(first, 1, WEAK_METADATA),
      sha256,
    })).rejects.toThrow(/model|fingerprint|provider|metadata/iu)

    expect(await inspectH1RunStoreV2(store)).toMatchObject({ status: 'RECOVERY_REQUIRED' })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as { entries: unknown[] }
    expect(ledger.entries).toEqual([])
    await closeH1RunStoreV2(store)
  })

  it('does not replay an already committed tuple when the caller submits the stale first attempt again', async () => {
    const root = await newRoot()
    const store = await createStore(root)
    const first = schedule[0]!
    const stale = attemptInput(first, 1)

    await executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-once-1',
      attemptInput: stale,
      sha256,
    })

    await expect(executeH1DurableAttemptV2({
      store,
      binding,
      invocationId: 'fixture-invocation-once-2',
      attemptInput: stale,
      sha256,
    })).rejects.toThrow(/next|schedule|task|tuple/iu)

    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as { entries: unknown[] }
    expect(ledger.entries).toHaveLength(1)
    await closeH1RunStoreV2(store)
  })
})
