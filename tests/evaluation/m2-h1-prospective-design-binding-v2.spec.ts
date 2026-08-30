import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { evaluateH1ReadinessV2 } from './m2-h1-readiness-v2.js'

const commitmentUrl = new URL('../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json', import.meta.url)

let committed: Record<string, unknown>

beforeAll(async () => {
  committed = JSON.parse(await readFile(commitmentUrl, 'utf8')) as Record<string, unknown>
})

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('M2.3 H1 prospective design commitment binding v2', () => {
  it('binds the exact frozen design, thresholds, selected task count and percentile semantics', () => {
    expect(committed).toMatchObject({
      status: 'BLOCKED',
      prospectiveDesign: {
        id: 'dsh-toolchain-m2-h1-prospective-design-v2',
        sourceCommit: 'ceec1cb79ec77a6875bda678622ad2a7cdac4fad',
        selectedTaskCount: 96,
      },
      thresholds: {
        mcidAbsoluteReduction: 0.1,
        taskSuccessNoninferiorityMargin: 0.05,
      },
      hiddenDataset: {
        sha256: null,
        taskCount: null,
      },
      provider: null,
      analysis: {
        trialsPerTask: 3,
        primary: {
          uncertainty: {
            method: 'paired-task-percentile-bootstrap',
            confidenceLevel: 0.95,
            sidedness: 'two-sided',
            lowerQuantile: 0.025,
            resamples: 10000,
            seed: 'm2-v2-primary',
            decisionRule: 'lower-bound-at-least-mcid',
          },
        },
        guardrail: {
          uncertainty: {
            method: 'paired-task-percentile-bootstrap',
            confidenceLevel: 0.95,
            sidedness: 'two-sided',
            lowerQuantile: 0.025,
            resamples: 10000,
            seed: 'm2-v2-guardrail',
            decisionRule: 'lower-bound-at-least-negative-margin',
          },
        },
      },
    })

    expect(evaluateH1ReadinessV2(committed)).toEqual({
      status: 'BLOCKED',
      blockers: [
        'COMMITMENT_NOT_FINALIZED',
        'TASK_SET_NOT_COMMITTED',
        'PROVIDER_IDENTITY_NOT_FROZEN',
      ],
      runAllowed: false,
    })
  })

  it('fails closed on prospective-design, threshold or percentile drift', () => {
    const designDrift = clone(committed)
    designDrift.prospectiveDesign = {
      id: 'dsh-toolchain-m2-h1-prospective-design-v2',
      sourceCommit: 'f'.repeat(40),
      selectedTaskCount: 96,
    }
    expect(evaluateH1ReadinessV2(designDrift)).toMatchObject({
      blockers: expect.arrayContaining(['PROSPECTIVE_DESIGN_INVALID']),
      runAllowed: false,
    })

    const thresholdDrift = clone(committed)
    thresholdDrift.thresholds = {
      mcidAbsoluteReduction: 0.08,
      taskSuccessNoninferiorityMargin: 0.05,
    }
    expect(evaluateH1ReadinessV2(thresholdDrift)).toMatchObject({
      blockers: expect.arrayContaining(['PROSPECTIVE_DESIGN_INVALID']),
      runAllowed: false,
    })

    const analysis = clone(committed.analysis) as {
      primary: { uncertainty: Record<string, unknown> }
    }
    analysis.primary.uncertainty.lowerQuantile = 0.05
    const quantileDrift = { ...clone(committed), analysis }
    expect(evaluateH1ReadinessV2(quantileDrift)).toMatchObject({
      blockers: expect.arrayContaining(['ANALYSIS_PLAN_INVALID']),
      runAllowed: false,
    })
  })

  it('requires the future hidden dataset task count to match the frozen planned count', () => {
    const mismatched = clone(committed)
    mismatched.hiddenDataset = {
      sha256: 'a'.repeat(64),
      taskCount: 80,
    }
    expect(evaluateH1ReadinessV2(mismatched)).toMatchObject({
      blockers: expect.arrayContaining(['TASK_SET_NOT_COMMITTED']),
      runAllowed: false,
    })
  })
})
