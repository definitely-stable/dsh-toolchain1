import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { buildApiTruthUniverseV2, type ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import { readjudicateRetainedP0V2 } from './m2-retained-p0-readjudication-v2.js'

const sha256 = createNodeSha256Port()
const retainedRoot = new URL('./fixtures/m2/p0-live-33264398212/', import.meta.url)
const ordinaryWorkspaceUrl = new URL('./fixtures/m2/rc2-web-v1/ordinary-workspace.json', import.meta.url)

interface RetainedManifest {
  readonly source: {
    readonly headSha: string
    readonly definitionSha256: string
    readonly historicalStatus: string
    readonly scheduledRuns: number
    readonly modelOutcomes: number
  }
  readonly files: {
    readonly result: { readonly sha256: string; readonly byteLength: number }
  }
}

let manifest: RetainedManifest
let retainedResult: unknown
let truth: ApiTruthUniverseV2

beforeAll(async () => {
  const [manifestText, resultText, workspaceText] = await Promise.all([
    readFile(new URL('manifest.json', retainedRoot), 'utf8'),
    readFile(new URL('result.json', retainedRoot), 'utf8'),
    readFile(ordinaryWorkspaceUrl, 'utf8'),
  ])
  manifest = JSON.parse(manifestText) as RetainedManifest
  retainedResult = JSON.parse(resultText) as unknown
  truth = await buildApiTruthUniverseV2(JSON.parse(workspaceText) as OrdinaryWorkspace, sha256)
})

async function report() {
  return readjudicateRetainedP0V2({
    source: {
      runId: 33264398212,
      headSha: manifest.source.headSha,
      definitionSha256: manifest.source.definitionSha256,
      resultSha256: manifest.files.result.sha256,
      historicalStatus: manifest.source.historicalStatus,
      scheduledRuns: manifest.source.scheduledRuns,
      modelOutcomes: manifest.source.modelOutcomes,
    },
    retainedResult,
  }, truth, sha256)
}

describe('retained M2.3 P0 re-adjudication v2', () => {
  it('derives a compact content-addressed analysis without rewriting historical status', async () => {
    const derived = await report()

    expect(derived).toMatchObject({
      schema: 'dsh-toolchain-m2-p0-readjudication-v2',
      derived: true,
      source: {
        runId: 33264398212,
        headSha: 'fee95e4613ffa32210f0800b7e5a9cbd929f0f6d',
        definitionSha256: '240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6',
        resultSha256: manifest.files.result.sha256,
        historicalStatus: 'INCONCLUSIVE',
        scheduledRuns: 72,
        modelOutcomes: 69,
      },
      adjudicator: 'dsh-toolchain-m2-p0-adjudication-v2',
      truthFingerprint: truth.fingerprint,
    })
    expect(derived.runs).toHaveLength(69)
    expect(derived.runs.filter(run => run.arm === 'B' || run.arm === 'C')).toHaveLength(48)
    expect(Object.values(derived.byArm).reduce((total, arm) => total + arm.modelOutcomes, 0)).toBe(69)
    expect(derived.reportSha256).toMatch(/^[0-9a-f]{64}$/u)

    const serialized = JSON.stringify(derived)
    expect(serialized).not.toContain('"rawAnswer"')
    expect(serialized).not.toContain('"providerMetadata"')
    expect(serialized).not.toContain('"executionEvidence"')
    expect(serialized).not.toContain('"environment"')
  })

  it('replays the known evaluator defects from retained raw answers under v2 semantics', async () => {
    const derived = await report()
    const allClaims = derived.runs.flatMap(run => run.apiClaims)

    expect(derived.runs.some(run => (
      run.taskId === 'p0-07'
      && run.apiClaims.some(claim => claim.symbol === 'profile.patchReload')
    ))).toBe(true)

    const approvalMembers = allClaims.filter(claim => (
      claim.symbol === 'ApprovalService.setPolicy'
      || claim.symbol === 'ApprovalService.overrideOf'
      || claim.symbol === 'setPolicy'
      || claim.symbol === 'overrideOf'
    ))
    expect(approvalMembers.length).toBeGreaterThan(0)
    expect(approvalMembers.every(claim => claim.classification !== 'INVALID')).toBe(true)

    expect(derived.runs.some(run => (
      run.taskId === 'p0-05'
      && run.apiClaims.some(claim => (
        claim.symbol === 'resolveChildDepth'
        && claim.classification === 'VALID'
      ))
    ))).toBe(true)
  })

  it('keeps literal target-wide uncertainty separate from task-scoped proof', async () => {
    const derived = await report()

    expect(derived.runs.some(run => (
      run.taskId === 'p0-08'
      && run.taskSuccess === 'SUCCESS'
      && run.apiClaims.some(claim => (
        claim.symbol === 'ToolAutopilot'
        && claim.assertion === 'absent'
        && claim.classification === 'UNKNOWN'
        && claim.resolution === 'incomplete-universe'
      ))
    ))).toBe(true)

    expect(derived.runs.some(run => (
      run.taskId === 'p0-07'
      && run.taskSuccess === 'UNKNOWN'
      && run.apiClaims.some(claim => (
        claim.symbol === 'profile.patchReload'
        && claim.classification === 'UNKNOWN'
      ))
    ))).toBe(true)
  })
})
