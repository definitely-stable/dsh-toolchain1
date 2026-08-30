import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { finalizeH1CommitmentV2 } from './m2-h1-finalization-v2.js'

const sha256 = createNodeSha256Port()
const commitmentUrl = new URL('../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json', import.meta.url)

const target = Object.freeze({
  package: '@deepseek-ai/dsh',
  version: '0.1.1-rc.2',
  profile: 'web',
  targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
  contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
})

let publicCommitment: unknown

beforeAll(async () => {
  publicCommitment = JSON.parse(await readFile(commitmentUrl, 'utf8'))
})

function hiddenDataset(taskCount = 96) {
  return {
    schema: 'dsh-toolchain-m2-agent-dataset-v2',
    datasetId: 'H1',
    target,
    taskCount,
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `h1-synthetic-${String(index + 1).padStart(3, '0')}`,
      domain: 'synthetic',
      prompt: `Synthetic private-contract task ${index + 1}.`,
      successRule: {
        kind: 'api-exists-any',
        package: '@deepseek-ai/dsh-tools',
        symbols: ['defineTool'],
      },
    })),
  }
}

function providerReceipt() {
  return {
    schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requestModel: 'deepseek-v4-flash',
    responseModel: 'deepseek-v4-flash',
    systemFingerprint: 'fp_opencode_h1_finalization_fixture',
    thinking: 'enabled',
    reasoningEffort: 'high',
    functionToolCall: 'verified',
    reasoningContinuation: 'verified',
    tokenMeasurement: 'verified',
    backendIdentityStrength: 'system-fingerprint',
    inputTokens: 64,
    outputTokens: 17,
  }
}

describe('M2.3 H1 finalization boundary v2', () => {
  it('finalizes only validated private inputs into one READY commitment', async () => {
    const result = await finalizeH1CommitmentV2(
      publicCommitment,
      hiddenDataset(),
      providerReceipt(),
      sha256,
    )

    expect(result.readiness).toEqual({ status: 'READY', blockers: [], runAllowed: true })
    expect(result.commitment.status).toBe('COMMITTED')
    expect(result.commitment.hiddenDataset.taskCount).toBe(96)
    expect(result.commitment.hiddenDataset.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(result.commitment.provider).toMatchObject({
      provider: 'opencode-go',
      backendIdentityStrength: 'system-fingerprint',
      backendFingerprint: 'fp_opencode_h1_finalization_fixture',
    })
    expect(result.modelTasks).toHaveLength(96)
    expect(Object.keys(result.modelTasks[0]!)).toEqual(['id', 'prompt'])
  })

  it('requires the pristine public BLOCKED commitment as the only source state', async () => {
    const source = structuredClone(publicCommitment) as Record<string, unknown>
    const prepopulated = {
      ...source,
      hiddenDataset: { sha256: 'a'.repeat(64), taskCount: 96 },
    }
    await expect(finalizeH1CommitmentV2(prepopulated, hiddenDataset(), providerReceipt(), sha256))
      .rejects.toThrow(/pristine|source|pre-populated/iu)

    const targetDrift = structuredClone(publicCommitment) as Record<string, unknown>
    targetDrift.target = { ...(targetDrift.target as Record<string, unknown>), profile: 'headless' }
    await expect(finalizeH1CommitmentV2(targetDrift, hiddenDataset(), providerReceipt(), sha256))
      .rejects.toThrow(/source|target|readiness/iu)
  })

  it('rejects unknown nested source metadata even when readiness would otherwise ignore it', async () => {
    const measurementDrift = structuredClone(publicCommitment) as Record<string, unknown>
    measurementDrift.measurement = {
      ...(measurementDrift.measurement as Record<string, unknown>),
      notes: 'must not be accepted as pristine',
    }
    await expect(finalizeH1CommitmentV2(measurementDrift, hiddenDataset(), providerReceipt(), sha256))
      .rejects.toThrow(/measurement|unknown|pristine|source/iu)

    const thresholdDrift = structuredClone(publicCommitment) as Record<string, unknown>
    thresholdDrift.thresholds = {
      ...(thresholdDrift.thresholds as Record<string, unknown>),
      notes: 'must not be accepted as pristine',
    }
    await expect(finalizeH1CommitmentV2(thresholdDrift, hiddenDataset(), providerReceipt(), sha256))
      .rejects.toThrow(/threshold|unknown|pristine|source/iu)
  })

  it('fails closed on wrong task count, malformed dataset and weak provider identity', async () => {
    await expect(finalizeH1CommitmentV2(publicCommitment, hiddenDataset(95), providerReceipt(), sha256))
      .rejects.toThrow(/96|task|TASK_SET_NOT_COMMITTED/iu)

    const malformedDataset = { ...hiddenDataset(), notes: 'unknown private metadata' }
    await expect(finalizeH1CommitmentV2(publicCommitment, malformedDataset, providerReceipt(), sha256))
      .rejects.toThrow(/notes|unknown/iu)

    const weakReceipt = { ...providerReceipt(), backendIdentityStrength: 'response-model-only' }
    await expect(finalizeH1CommitmentV2(publicCommitment, hiddenDataset(), weakReceipt, sha256))
      .rejects.toThrow(/backend|identity|system/iu)
  })

  it('does not mutate the public source commitment or expose evaluator rules in model tasks', async () => {
    const sourceText = JSON.stringify(publicCommitment)
    const result = await finalizeH1CommitmentV2(publicCommitment, hiddenDataset(), providerReceipt(), sha256)

    expect(JSON.stringify(publicCommitment)).toBe(sourceText)
    expect(JSON.stringify(result.modelTasks)).not.toContain('successRule')
    expect(JSON.stringify(result.modelTasks)).not.toContain('domain')
  })
})
