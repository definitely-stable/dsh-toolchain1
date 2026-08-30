import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  commitHiddenH1DatasetV2,
  evaluateH1ReadinessV2,
  type H1CommitmentV2,
} from './m2-h1-readiness-v2.js'

const sha256 = createNodeSha256Port()
const commitmentUrl = new URL('../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json', import.meta.url)
const TARGET_FINGERPRINT = 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe'
const CONTRACT_INDEX_FINGERPRINT = 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2'
const API_CLAIMS_SOURCE_COMMIT = '0bd4387e7da31344d92912670fac2de096cc0c7c'

let committed: H1CommitmentV2
let committedText: string

beforeAll(async () => {
  committedText = await readFile(commitmentUrl, 'utf8')
  committed = JSON.parse(committedText) as H1CommitmentV2
})

function readyProjection(): H1CommitmentV2 {
  return {
    ...committed,
    status: 'COMMITTED',
    measurement: {
      ...committed.measurement,
      apiClaimClassifier: {
        id: 'dsh-toolchain-m2-api-claims-v2',
        sourceCommit: API_CLAIMS_SOURCE_COMMIT,
      },
      taskAdjudicator: {
        id: 'dsh-toolchain-m2-h1-task-adjudicator-v2',
        sourceCommit: '9'.repeat(40),
      },
    },
    thresholds: {
      mcidAbsoluteReduction: 0.1,
      taskSuccessNoninferiorityMargin: 0.05,
    },
    hiddenDataset: {
      sha256: '8'.repeat(64),
      taskCount: 12,
    },
    provider: {
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      requestModel: 'deepseek-v4-flash',
      responseModel: 'deepseek-v4-flash',
      adapterVersion: 'opencode-go-deepseek-chat-v1',
      thinking: 'enabled',
      reasoningEffort: 'high',
      backendIdentityStrength: 'system-fingerprint',
      backendFingerprint: 'provider-system-fingerprint-immutable-example',
      identityReceiptSha256: '7'.repeat(64),
    },
  }
}

function hiddenDataset(successCriteria = ['uses the exact public API']) {
  return {
    schema: 'dsh-toolchain-m2-agent-dataset-v2',
    datasetId: 'H1',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: CONTRACT_INDEX_FINGERPRINT,
    },
    taskCount: 2,
    tasks: [
      {
        id: 'h1-001',
        domain: 'tools',
        prompt: 'Find the exact API needed for the first hidden task.',
        oracleHints: { package: '@deepseek-ai/dsh-tools', symbols: ['defineTool'] },
        successCriteria,
      },
      {
        id: 'h1-002',
        domain: 'session',
        prompt: 'Find the exact API needed for the second hidden task.',
        oracleHints: { package: '@deepseek-ai/dsh-session-query', symbols: ['compileSessionTextFilter'] },
        successCriteria: ['uses frozen rc.2 evidence'],
      },
    ],
  }
}

describe('M2.3 H1 readiness v2', () => {
  it('keeps the committed public repository state fail-closed with explicit blockers', () => {
    const readiness = evaluateH1ReadinessV2(committed)

    expect(readiness).toEqual({
      status: 'BLOCKED',
      blockers: [
        'COMMITMENT_NOT_FINALIZED',
        'TASK_ADJUDICATOR_NOT_FROZEN',
        'MCID_NOT_FROZEN',
        'NONINFERIORITY_MARGIN_NOT_FROZEN',
        'TASK_SET_NOT_COMMITTED',
        'PROVIDER_IDENTITY_NOT_FROZEN',
      ],
      runAllowed: false,
    })
  })

  it('stores only public commitments and no hidden H1 task material', () => {
    expect(committedText).not.toContain('"tasks"')
    expect(committedText).not.toContain('"prompt"')
    expect(committedText).not.toContain('"oracleHints"')
    expect(committedText).not.toContain('"successCriteria"')
    expect(committedText).not.toContain('"answers"')
  })

  it('derives runAllowed only after every gate is valid and explicitly finalized', () => {
    expect(evaluateH1ReadinessV2(readyProjection())).toEqual({
      status: 'READY',
      blockers: [],
      runAllowed: true,
    })

    expect(evaluateH1ReadinessV2({ ...readyProjection(), status: 'BLOCKED' })).toEqual({
      status: 'BLOCKED',
      blockers: ['COMMITMENT_NOT_FINALIZED'],
      runAllowed: false,
    })
  })

  it('rejects response-model-only provider identity, missing receipt and malformed thresholds', () => {
    const responseOnly = {
      ...readyProjection(),
      provider: {
        ...readyProjection().provider!,
        backendIdentityStrength: 'response-model-only' as const,
        backendFingerprint: null,
      },
    }
    expect(evaluateH1ReadinessV2(responseOnly)).toMatchObject({
      runAllowed: false,
      blockers: ['PROVIDER_IDENTITY_NOT_FROZEN'],
    })

    const missingReceipt = {
      ...readyProjection(),
      provider: {
        ...readyProjection().provider!,
        identityReceiptSha256: null,
      },
    }
    expect(evaluateH1ReadinessV2(missingReceipt)).toMatchObject({
      runAllowed: false,
      blockers: ['PROVIDER_IDENTITY_NOT_FROZEN'],
    })

    const badMcid = {
      ...readyProjection(),
      thresholds: {
        ...readyProjection().thresholds,
        mcidAbsoluteReduction: 0,
      },
    }
    expect(() => evaluateH1ReadinessV2(badMcid)).toThrow(/MCID/u)

    const badMargin = {
      ...readyProjection(),
      thresholds: {
        ...readyProjection().thresholds,
        taskSuccessNoninferiorityMargin: 1.1,
      },
    }
    expect(() => evaluateH1ReadinessV2(badMargin)).toThrow(/non-inferiority/u)
  })

  it('fails closed on target, measurement or statistical-plan drift', () => {
    const targetDrift = {
      ...readyProjection(),
      target: { ...readyProjection().target, profile: 'headless' },
    }
    expect(evaluateH1ReadinessV2(targetDrift)).toMatchObject({
      blockers: ['TARGET_IDENTITY_INVALID'],
      runAllowed: false,
    })

    const measurementDrift = {
      ...readyProjection(),
      measurement: {
        ...readyProjection().measurement,
        apiClaimClassifier: {
          id: 'dsh-toolchain-m2-api-claims-v2',
          sourceCommit: 'a'.repeat(40),
        },
      },
    }
    expect(evaluateH1ReadinessV2(measurementDrift)).toMatchObject({
      blockers: ['MEASUREMENT_IDENTITY_INVALID'],
      runAllowed: false,
    })

    const analysisDrift = {
      ...readyProjection(),
      analysis: {
        ...readyProjection().analysis,
        trialsPerTask: 4,
      },
    }
    expect(evaluateH1ReadinessV2(analysisDrift)).toMatchObject({
      blockers: ['ANALYSIS_PLAN_INVALID'],
      runAllowed: false,
    })
  })
})

describe('external hidden H1 dataset commitment v2', () => {
  it('hashes the complete evaluator dataset while exposing only id and prompt to the model', async () => {
    const first = await commitHiddenH1DatasetV2(hiddenDataset(), sha256)
    const changedEvaluatorOnly = await commitHiddenH1DatasetV2(
      hiddenDataset(['different evaluator-only success rule']),
      sha256,
    )

    expect(first.taskCount).toBe(2)
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.sha256).not.toBe(changedEvaluatorOnly.sha256)
    expect(first.modelTasks).toEqual([
      { id: 'h1-001', prompt: 'Find the exact API needed for the first hidden task.' },
      { id: 'h1-002', prompt: 'Find the exact API needed for the second hidden task.' },
    ])
    expect(JSON.stringify(first.modelTasks)).not.toContain('oracleHints')
    expect(JSON.stringify(first.modelTasks)).not.toContain('successCriteria')
  })

  it('canonicalizes object-key order but commits task order and rejects duplicate ids', async () => {
    const original = hiddenDataset()
    const reordered = {
      tasks: original.tasks.map(task => ({
        successCriteria: task.successCriteria,
        oracleHints: task.oracleHints,
        prompt: task.prompt,
        domain: task.domain,
        id: task.id,
      })),
      taskCount: original.taskCount,
      target: {
        contractIndexFingerprint: original.target.contractIndexFingerprint,
        targetFingerprint: original.target.targetFingerprint,
        profile: original.target.profile,
        version: original.target.version,
        package: original.target.package,
      },
      datasetId: original.datasetId,
      schema: original.schema,
    }

    const [first, second] = await Promise.all([
      commitHiddenH1DatasetV2(original, sha256),
      commitHiddenH1DatasetV2(reordered, sha256),
    ])
    expect(first.sha256).toBe(second.sha256)

    const reversed = { ...original, tasks: [...original.tasks].toReversed() }
    expect((await commitHiddenH1DatasetV2(reversed, sha256)).sha256).not.toBe(first.sha256)

    const firstTask = original.tasks[0]!
    const secondTask = original.tasks[1]!
    const duplicate = {
      ...original,
      tasks: [firstTask, { ...secondTask, id: firstTask.id }],
    }
    await expect(commitHiddenH1DatasetV2(duplicate, sha256)).rejects.toThrow(/unique/u)
  })

  it('rejects mismatched counts and pre-populated outcome material', async () => {
    await expect(commitHiddenH1DatasetV2({ ...hiddenDataset(), taskCount: 3 }, sha256)).rejects.toThrow(/taskCount/u)

    const withOutcome = hiddenDataset() as ReturnType<typeof hiddenDataset> & { runs?: unknown[] }
    withOutcome.runs = [{ answer: 'peeked' }]
    await expect(commitHiddenH1DatasetV2(withOutcome, sha256)).rejects.toThrow(/outcome|result|run/u)
  })
})
