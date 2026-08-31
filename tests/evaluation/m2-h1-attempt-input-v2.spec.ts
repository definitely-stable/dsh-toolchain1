import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { FROZEN_H1_SYSTEM_PROMPT, createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import { createFrozenH1AttemptInputFactoryV2 } from './m2-h1-attempt-input-v2.js'
import { runH1DurableScheduleV2, type H1NextResumeV2 } from './m2-h1-durable-schedule-runner-v2.js'
import { closeH1RunStoreV2, createH1RunStoreV2, type H1RunStoreV2 } from './m2-h1-run-store-v2.js'
import { createSyntheticH1Finalization, readSyntheticH1Workspace } from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()
const H1_SUCCESS = fileURLToPath(new URL(
  './fixtures/process-executor/h1-terminal-success.mjs',
  import.meta.url,
))
const temporaryRoots: string[] = []
const stores: H1RunStoreV2[] = []

function processConfiguration(overrides: Readonly<Record<string, string>> = {}) {
  return {
    command: process.execPath,
    args: [H1_SUCCESS],
    cwd: process.cwd(),
    environment: {
      PATH: process.env.PATH ?? '',
      OPENCODE_API_KEY: 'sk-synthetic-h1-runtime-only',
      OPENCODE_GO_BASE_URL: 'https://opencode.ai/zen/go/v1',
      OPENCODE_GO_REQUEST_MODEL: 'deepseek-v4-flash',
      OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-flash',
      OPENCODE_GO_THINKING: 'enabled',
      OPENCODE_GO_REASONING_EFFORT: 'high',
      OPENCODE_GO_MAX_OUTPUT_TOKENS: '12000',
      ...overrides,
    },
  }
}

async function frozenFixture() {
  const [finalization, workspace] = await Promise.all([
    createSyntheticH1Finalization(),
    readSyntheticH1Workspace(),
  ])
  const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  return { frozen, workspace }
}

function resumeAt(
  frozen: Awaited<ReturnType<typeof frozenFixture>>['frozen'],
  scheduleIndex: number,
  attempt = 1,
): H1NextResumeV2 {
  const entry = frozen.schedule[scheduleIndex]!
  return {
    status: 'NEXT',
    scheduleIndex,
    taskId: entry.taskId,
    arm: entry.arm,
    trial: entry.trial,
    attempt,
    inconclusive: false,
  }
}

function indexForArm(
  frozen: Awaited<ReturnType<typeof frozenFixture>>['frozen'],
  arm: 'A' | 'B' | 'C',
): number {
  const index = frozen.schedule.findIndex(entry => entry.arm === arm)
  if (index < 0) throw new Error(`fixture schedule has no arm ${arm}`)
  return index
}

afterEach(async () => {
  while (stores.length > 0) await closeH1RunStoreV2(stores.pop()!).catch(() => undefined)
  while (temporaryRoots.length > 0) await rm(temporaryRoots.pop()!, { recursive: true, force: true })
})

describe('M2.3 frozen H1 process-attempt input v2', () => {
  it('derives A/B/C identity, task, capability, policy and isolation only from the frozen definition', async () => {
    const { frozen, workspace } = await frozenFixture()
    const factory = await createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      processConfiguration(),
      sha256,
    )

    for (const arm of ['A', 'B', 'C'] as const) {
      const resume = resumeAt(frozen, indexForArm(frozen, arm))
      const built = await factory.buildAttemptInput(resume)
      const task = frozen.modelTasks.find(item => item.id === resume.taskId)!

      expect(built.identity).toEqual({
        evaluationId: 'm2-agent-h1-v2',
        phase: 'H1',
        taskId: resume.taskId,
        arm,
        trial: resume.trial,
        attempt: 1,
        targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
        contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
        datasetCommitmentSha256: frozen.ledgerBinding.datasetCommitmentSha256,
      })
      expect(canonicalizeEvaluationJson(built.capabilityManifest))
        .toBe(canonicalizeEvaluationJson(frozen.capabilityManifests[arm]))
      expect(built.resourcePolicy).toEqual(frozen.resourcePolicy)
      expect(built.retryPolicy).toEqual(frozen.retryPolicy)
      expect(built.modelEnvelope).toEqual({
        schema: 'dsh-toolchain-m2-model-envelope-v1',
        systemPrompt: FROZEN_H1_SYSTEM_PROMPT,
        task,
        staticContext: [],
        tools: frozen.capabilityManifests[arm].tools,
      })
      expect(built.process).toMatchObject({
        command: process.execPath,
        args: [H1_SUCCESS],
        cwd: process.cwd(),
        timeoutMs: frozen.resourcePolicy.maxWallTimeMs,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      })
      expect(built.process.environment).not.toHaveProperty('OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT')
      expect(built.isolation.workspaceMode).toBe(arm === 'A' ? 'fresh' : 'read-only-reset')
      if (arm === 'A') {
        expect(built.isolation.workspaceSnapshotSha256).not.toBe(workspace.workspaceSnapshotSha256)
        expect(built.isolation.ordinaryEvidenceSha256).not.toBe(workspace.documentationSha256)
      } else {
        expect(built.isolation.workspaceSnapshotSha256).toBe(workspace.workspaceSnapshotSha256)
        expect(built.isolation.ordinaryEvidenceSha256).toBe(workspace.documentationSha256)
      }
    }
  })

  it('is deterministic for one tuple but creates fresh deterministic isolation identities for retry attempt two', async () => {
    const { frozen, workspace } = await frozenFixture()
    const configuration = processConfiguration()
    const factory = await createFrozenH1AttemptInputFactoryV2(frozen, workspace, configuration, sha256)
    const resume = resumeAt(frozen, 0)

    const left = await factory.buildAttemptInput(resume)
    const right = await factory.buildAttemptInput(resume)
    const retry = await factory.buildAttemptInput({ ...resume, attempt: 2 })

    expect(left.identity).toEqual(right.identity)
    expect(left.modelEnvelope).toEqual(right.modelEnvelope)
    expect(left.isolation).toEqual(right.isolation)
    expect(left.process).toEqual(right.process)
    expect(retry.isolation.sessionIdSha256).not.toBe(left.isolation.sessionIdSha256)
    expect(retry.isolation.mutableEnvironmentIdSha256).not.toBe(left.isolation.mutableEnvironmentIdSha256)
    expect(retry.isolation.workspaceSnapshotSha256).toBe(left.isolation.workspaceSnapshotSha256)
  })

  it('rejects schedule tuple drift and attempts outside the frozen retry envelope before child execution', async () => {
    const { frozen, workspace } = await frozenFixture()
    const factory = await createFrozenH1AttemptInputFactoryV2(frozen, workspace, processConfiguration(), sha256)
    const resume = resumeAt(frozen, 0)

    await expect(factory.buildAttemptInput({ ...resume, taskId: 'h1-synthetic-999' }))
      .rejects.toThrow(/schedule|task|tuple|drift/iu)
    await expect(factory.buildAttemptInput({ ...resume, arm: resume.arm === 'A' ? 'B' : 'A' }))
      .rejects.toThrow(/schedule|arm|tuple|drift/iu)
    await expect(factory.buildAttemptInput({ ...resume, trial: resume.trial === 1 ? 2 : 1 }))
      .rejects.toThrow(/schedule|trial|tuple|drift/iu)
    await expect(factory.buildAttemptInput({ ...resume, attempt: 3 }))
      .rejects.toThrow(/attempt|retry|envelope/iu)
  })

  it('fails closed on frozen model-task, capability, executor ContentRef or workspace drift', async () => {
    const { frozen, workspace } = await frozenFixture()

    const taskDrift = structuredClone(frozen)
    ;(taskDrift.modelTasks as Array<{ id: string; prompt: string }>)[0]!.prompt += ' drift'
    await expect(createFrozenH1AttemptInputFactoryV2(taskDrift, workspace, processConfiguration(), sha256))
      .rejects.toThrow(/task|projection|hash|definition/iu)

    const capabilityDrift = structuredClone(frozen)
    capabilityDrift.capabilityManifests.B.tools.pop()
    await expect(createFrozenH1AttemptInputFactoryV2(capabilityDrift, workspace, processConfiguration(), sha256))
      .rejects.toThrow(/capability|manifest|hash|definition/iu)

    const executorDrift = structuredClone(frozen)
    const execution = executorDrift.definition.execution as Record<string, unknown>
    const executorRef = execution.executorIdentity as { inline: string }
    executorRef.inline = '{"tampered":true}'
    await expect(createFrozenH1AttemptInputFactoryV2(executorDrift, workspace, processConfiguration(), sha256))
      .rejects.toThrow(/executor|content|hash|definition/iu)

    const workspaceDrift = structuredClone(workspace)
    workspaceDrift.documentationSha256 = '0'.repeat(64)
    await expect(createFrozenH1AttemptInputFactoryV2(frozen, workspaceDrift, processConfiguration(), sha256))
      .rejects.toThrow(/workspace|documentation|hash|identity/iu)
  })

  it('requires an explicit allowlisted child environment bound to the frozen managed-gateway identity', async () => {
    const { frozen, workspace } = await frozenFixture()

    await expect(createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      processConfiguration({ HOME: '/should-not-be-inherited' }),
      sha256,
    )).rejects.toThrow(/environment|allowlist|HOME/iu)

    const missingCredential = processConfiguration()
    delete (missingCredential.environment as Record<string, string>).OPENCODE_API_KEY
    await expect(createFrozenH1AttemptInputFactoryV2(frozen, workspace, missingCredential, sha256))
      .rejects.toThrow(/OPENCODE_API_KEY|credential|environment/iu)

    await expect(createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      processConfiguration({ OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT: 'fp_must_not_be_required' }),
      sha256,
    )).rejects.toThrow(/environment|allowlist|fingerprint/iu)

    await expect(createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      processConfiguration({ OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'other-model' }),
      sha256,
    )).rejects.toThrow(/response|model|provider|environment/iu)

    await expect(createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      processConfiguration({ OPENCODE_GO_MAX_OUTPUT_TOKENS: '6000' }),
      sha256,
    )).rejects.toThrow(/output|token|resource|environment/iu)
  })

  it('executes and durably commits exactly one local synthetic attempt through the existing schedule driver', async () => {
    const { frozen, workspace } = await frozenFixture()
    const factory = await createFrozenH1AttemptInputFactoryV2(frozen, workspace, processConfiguration(), sha256)
    const root = await mkdtemp(join(tmpdir(), 'dsh-h1-attempt-input-'))
    temporaryRoots.push(root)
    const taskIds = frozen.modelTasks.map(task => task.id)
    const opened = await createH1RunStoreV2(
      root,
      frozen.ledgerBinding,
      frozen.schedule,
      taskIds,
      frozen.retryPolicy,
      sha256,
    )
    stores.push(opened.store)

    const result = await runH1DurableScheduleV2({
      store: opened.store,
      binding: frozen.ledgerBinding,
      sha256,
      maxCommittedAttempts: 1,
      buildAttemptInput: factory.buildAttemptInput,
    })

    expect(result).toMatchObject({
      status: 'PAUSED',
      committedAttempts: 1,
      state: { status: 'NEXT', resume: { scheduleIndex: 1, attempt: 1 } },
    })
    const ledger = JSON.parse(await readFile(join(root, 'ledger.json'), 'utf8')) as {
      entries: Array<{ scheduleIndex: number; outcome: string; responseModel?: string }>
    }
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]).toEqual(expect.objectContaining({
      scheduleIndex: 0,
      outcome: 'model-outcome',
      responseModel: 'deepseek-v4-flash',
    }))
    expect(JSON.stringify(ledger.entries[0])).not.toContain('systemFingerprint')
  })
})
