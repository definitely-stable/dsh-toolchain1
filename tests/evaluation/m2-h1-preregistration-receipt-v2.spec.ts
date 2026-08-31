import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  createH1PreregistrationReceiptV2,
  validateH1PreregistrationReceiptV2,
} from './m2-h1-preregistration-receipt-v2.js'
import {
  createSyntheticH1Finalization,
  readSyntheticH1Workspace,
} from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()
const blockedCommitmentUrl = new URL(
  '../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json',
  import.meta.url,
)

async function fixture(inputTokens = 64) {
  const [finalization, workspace] = await Promise.all([
    createSyntheticH1Finalization(inputTokens),
    readSyntheticH1Workspace(),
  ])
  const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  return { finalization, frozen }
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, keys))
    return keys
  }
  if (value === null || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key)
    collectKeys(child, keys)
  }
  return keys
}

describe('M2.3 H1 public preregistration receipt v2', () => {
  it('constructs one deterministic public-safe receipt from READY finalization plus the exact frozen definition', async () => {
    const { finalization, frozen } = await fixture()
    const left = await createH1PreregistrationReceiptV2(finalization, frozen, sha256)
    const right = await createH1PreregistrationReceiptV2(finalization, frozen, sha256)

    expect(left).toEqual(right)
    expect(left).toMatchObject({
      schema: 'dsh-toolchain-m2-h1-preregistration-receipt-v2',
      version: 'h1-preregistration-receipt-v2',
      status: 'PREREGISTERED',
      evaluationId: 'm2-agent-h1-v2',
      target: {
        package: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
        profile: 'web',
        targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
        contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
        ordinaryWorkspaceSha256: 'ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413',
      },
      hiddenDataset: {
        sha256: finalization.commitment.hiddenDataset.sha256,
        taskCount: 96,
        modelTaskProjectionSha256: finalization.commitment.hiddenDataset.modelTaskProjectionSha256,
      },
      provider: {
        provider: 'opencode-go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        requestModel: 'deepseek-v4-flash',
        responseModel: 'deepseek-v4-flash',
        adapterVersion: 'opencode-go-deepseek-chat-v1',
        thinking: 'enabled',
        reasoningEffort: 'high',
        identityMode: 'managed-gateway',
        identityReceiptSha256: finalization.commitment.provider?.identityReceiptSha256,
      },
      execution: {
        definitionSha256: frozen.definitionSha256,
        scheduleCount: 864,
        scheduleSeed: 'm2-h1-holdout-v2',
        trialsPerTaskArm: 3,
        concurrency: 1,
        ledgerBinding: frozen.ledgerBinding,
      },
      disclosure: {
        hiddenTaskBytes: 'withheld-until-terminal-h1',
        credentials: 'never-recorded',
        outcomeMaterial: 'absent-pre-run',
      },
    })
    expect(JSON.stringify(left.provider)).not.toContain('Fingerprint')
    expect(left.receiptSha256).toMatch(/^[0-9a-f]{64}$/u)
    await expect(validateH1PreregistrationReceiptV2(left, sha256)).resolves.toEqual(left)
  })

  it('publishes identities only and cannot leak hidden prompts, success rules, credentials or outcome material', async () => {
    const { finalization, frozen } = await fixture()
    const receipt = await createH1PreregistrationReceiptV2(finalization, frozen, sha256)
    const serialized = canonicalizeEvaluationJson(receipt)
    const keys = collectKeys(receipt)
    const firstPrompt = finalization.modelTasks[0]!.prompt

    expect(serialized).not.toContain(firstPrompt)
    expect(serialized).not.toContain('sk-synthetic')
    expect(serialized).not.toMatch(/Bearer\s+/iu)
    for (const forbidden of [
      'tasks',
      'prompt',
      'domain',
      'successRule',
      'answers',
      'rawAnswer',
      'apiKey',
      'authorization',
      'outcomes',
      'backendFingerprint',
      'expectedBackendFingerprint',
    ]) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })

  it('fails closed when finalization readiness or the model-visible task projection drifts', async () => {
    const { finalization, frozen } = await fixture()

    const readinessDrift = structuredClone(finalization)
    ;(readinessDrift as unknown as { readiness: unknown }).readiness = {
      status: 'BLOCKED',
      runAllowed: false,
      blockers: ['TASK_SET_NOT_COMMITTED'],
    }
    await expect(createH1PreregistrationReceiptV2(readinessDrift, frozen, sha256))
      .rejects.toThrow(/READY|readiness|finalization/iu)

    const taskDrift = structuredClone(finalization)
    ;(taskDrift.modelTasks as Array<{ id: string; prompt: string }>)[0]!.prompt += ' drift'
    await expect(createH1PreregistrationReceiptV2(taskDrift, frozen, sha256))
      .rejects.toThrow(/task|projection|commitment|hash/iu)
  })

  it('fails closed on definition, schedule, ContentRef or provider-receipt ledger-binding drift before a receipt is emitted', async () => {
    const { finalization, frozen } = await fixture()

    const hashDrift = structuredClone(frozen)
    ;(hashDrift as unknown as { definitionSha256: string }).definitionSha256 = '0'.repeat(64)
    await expect(createH1PreregistrationReceiptV2(finalization, hashDrift, sha256))
      .rejects.toThrow(/definition|hash/iu)

    const scheduleDrift = structuredClone(frozen)
    ;(scheduleDrift.schedule as Array<unknown>).pop()
    await expect(createH1PreregistrationReceiptV2(finalization, scheduleDrift, sha256))
      .rejects.toThrow(/schedule|864|definition/iu)

    const contentDrift = structuredClone(frozen)
    const execution = contentDrift.definition.execution as Record<string, unknown>
    const runnerRef = execution.runnerIdentity as { inline: string }
    runnerRef.inline = '{"tampered":true}'
    await expect(createH1PreregistrationReceiptV2(finalization, contentDrift, sha256))
      .rejects.toThrow(/ContentRef|runner|hash|definition/iu)

    const ledgerDrift = structuredClone(frozen)
    ;(ledgerDrift.ledgerBinding as { providerIdentityReceiptSha256: string }).providerIdentityReceiptSha256 = '0'.repeat(64)
    await expect(createH1PreregistrationReceiptV2(finalization, ledgerDrift, sha256))
      .rejects.toThrow(/ledger|provider|receipt|binding/iu)
  })

  it('independently validates exact receipt shape, privacy invariants and the external receipt hash', async () => {
    const { finalization, frozen } = await fixture()
    const receipt = await createH1PreregistrationReceiptV2(finalization, frozen, sha256)

    const unknown = structuredClone(receipt) as unknown as Record<string, unknown>
    unknown.syntheticExtra = true
    await expect(validateH1PreregistrationReceiptV2(unknown, sha256))
      .rejects.toThrow(/unknown|key|shape/iu)

    const badHash = { ...structuredClone(receipt), receiptSha256: '0'.repeat(64) }
    await expect(validateH1PreregistrationReceiptV2(badHash, sha256))
      .rejects.toThrow(/receipt|hash|SHA/iu)

    const privateMaterial = structuredClone(receipt) as unknown as Record<string, unknown>
    ;(privateMaterial.hiddenDataset as Record<string, unknown>).prompt = 'must never be public'
    await expect(validateH1PreregistrationReceiptV2(privateMaterial, sha256))
      .rejects.toThrow(/prompt|private|hidden|unknown/iu)
  })

  it('changes receipt identity when committed provider probe evidence changes without changing the Flash model boundary', async () => {
    const leftFixture = await fixture(64)
    const rightFixture = await fixture(65)
    const left = await createH1PreregistrationReceiptV2(leftFixture.finalization, leftFixture.frozen, sha256)
    const right = await createH1PreregistrationReceiptV2(rightFixture.finalization, rightFixture.frozen, sha256)

    expect(left.provider.identityReceiptSha256).not.toBe(right.provider.identityReceiptSha256)
    expect(left.provider.responseModel).toBe('deepseek-v4-flash')
    expect(right.provider.responseModel).toBe('deepseek-v4-flash')
    expect(left.execution.definitionSha256).not.toBe(right.execution.definitionSha256)
    expect(left.receiptSha256).not.toBe(right.receiptSha256)
  })

  it('keeps the committed public source template pristine and BLOCKED until real private publication', async () => {
    const source = JSON.parse(await readFile(blockedCommitmentUrl, 'utf8')) as {
      status: string
      hiddenDataset: { sha256: string | null; taskCount: number | null }
      provider: unknown
    }
    expect(source).toMatchObject({
      status: 'BLOCKED',
      hiddenDataset: { sha256: null, taskCount: null },
      provider: null,
    })
  })
})
