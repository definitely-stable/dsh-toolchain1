import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { auditH1ProspectiveDesignExactV2 } from './m2-h1-design-exact-audit-v2.js'
import {
  analyzeH1ProspectiveDesignV2,
  validateH1ProspectiveDesignV2,
} from './m2-h1-design-sensitivity-v2.js'
import {
  evaluateH1ReadinessV2,
  type H1CommitmentV2,
} from './m2-h1-readiness-v2.js'

const sha256 = createNodeSha256Port()
const commitmentUrl = new URL('../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json', import.meta.url)
const designUrl = new URL('../../docs/evaluation/m2/h1-prospective-design-v2.json', import.meta.url)
const reportUrl = new URL('../../docs/evaluation/m2/h1-prospective-sensitivity-report-v2.json', import.meta.url)
const REPORT_SHA256 = '83f49897deb4f7733cd4df7ddee7220d586bf22e9e53282850129eea1c738d2a'
const DESIGN_SOURCE_COMMIT = 'ceec1cb79ec77a6875bda678622ad2a7cdac4fad'
const SELECTED_TASK_COUNT = 96

let commitment: H1CommitmentV2
let design: unknown
let report: Record<string, unknown>

beforeAll(async () => {
  commitment = JSON.parse(await readFile(commitmentUrl, 'utf8')) as H1CommitmentV2
  design = JSON.parse(await readFile(designUrl, 'utf8'))
  report = JSON.parse(await readFile(reportUrl, 'utf8')) as Record<string, unknown>
})

function provider() {
  return {
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requestModel: 'deepseek-v4-flash',
    responseModel: 'deepseek-v4-flash',
    adapterVersion: 'opencode-go-deepseek-chat-v1',
    thinking: 'enabled' as const,
    reasoningEffort: 'high' as const,
    backendIdentityStrength: 'system-fingerprint' as const,
    backendFingerprint: 'immutable-provider-fingerprint-example',
    identityReceiptSha256: '7'.repeat(64),
  }
}

function otherwiseReady(taskCount = SELECTED_TASK_COUNT): H1CommitmentV2 {
  return {
    ...commitment,
    status: 'COMMITTED',
    hiddenDataset: {
      sha256: '8'.repeat(64),
      taskCount,
    },
    provider: provider(),
  }
}

describe('M2.3 frozen H1 prospective design result binding v2', () => {
  it('recomputes the frozen derived result from the merged design engine and exact audit', async () => {
    const validated = validateH1ProspectiveDesignV2(design)
    const approximate = analyzeH1ProspectiveDesignV2(validated)
    const exact = auditH1ProspectiveDesignExactV2(validated)
    const selection = report.selection as Record<string, unknown>
    const source = report.source as Record<string, unknown>
    const prospectiveDesign = source.prospectiveDesign as Record<string, unknown>

    expect(approximate.outcome).toBe('ADEQUATE')
    expect(approximate.selectedTaskCount).toBe(SELECTED_TASK_COUNT)
    expect(exact.selectionAgrees).toBe(true)
    expect(exact.exactSelectedTaskCount).toBe(SELECTED_TASK_COUNT)
    expect(selection).toEqual({
      approximateSelectedTaskCount: SELECTED_TASK_COUNT,
      exactSelectedTaskCount: SELECTED_TASK_COUNT,
      selectionAgrees: true,
      selectedTaskCount: SELECTED_TASK_COUNT,
      outcome: 'ADEQUATE',
    })
    expect(prospectiveDesign.sourceCommit).toBe(DESIGN_SOURCE_COMMIT)
    expect(report.execution).toEqual({ h1Executed: false, providerCalls: 0 })

    const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(report))
    expect(digest).toBe(REPORT_SHA256)
  })

  it('keeps the public commitment blocked only on finalization, private task set and provider identity', () => {
    expect(evaluateH1ReadinessV2(commitment)).toEqual({
      status: 'BLOCKED',
      blockers: [
        'COMMITMENT_NOT_FINALIZED',
        'TASK_SET_NOT_COMMITTED',
        'PROVIDER_IDENTITY_NOT_FROZEN',
      ],
      runAllowed: false,
    })
  })

  it('fails closed if the frozen design/report identity is substituted', () => {
    const drifted = {
      ...otherwiseReady(),
      design: {
        ...(commitment as H1CommitmentV2 & { design: Record<string, unknown> }).design,
        prospectiveDesign: {
          ...((commitment as H1CommitmentV2 & { design: { prospectiveDesign: Record<string, unknown> } }).design.prospectiveDesign),
          sourceCommit: 'a'.repeat(40),
        },
      },
    }

    expect(evaluateH1ReadinessV2(drifted)).toEqual({
      status: 'BLOCKED',
      blockers: ['DESIGN_IDENTITY_INVALID'],
      runAllowed: false,
    })
  })

  it('requires the eventually committed hidden dataset to contain exactly the selected 96 tasks', () => {
    expect(evaluateH1ReadinessV2(otherwiseReady())).toEqual({
      status: 'READY',
      blockers: [],
      runAllowed: true,
    })

    expect(evaluateH1ReadinessV2(otherwiseReady(95))).toEqual({
      status: 'BLOCKED',
      blockers: ['TASK_SET_NOT_COMMITTED'],
      runAllowed: false,
    })
    expect(evaluateH1ReadinessV2(otherwiseReady(97))).toEqual({
      status: 'BLOCKED',
      blockers: ['TASK_SET_NOT_COMMITTED'],
      runAllowed: false,
    })
  })
})
