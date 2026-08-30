import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import {
  analyzeH1ProspectiveDesignV2,
  h1EffectMomentsV2,
  validateH1ProspectiveDesignV2,
  type H1ProspectiveDesignV2,
} from './m2-h1-design-sensitivity-v2.js'

const designUrl = new URL('../../docs/evaluation/m2/h1-prospective-design-v2.json', import.meta.url)
const engineUrl = new URL('./m2-h1-design-sensitivity-v2.ts', import.meta.url)

let frozenDesign: H1ProspectiveDesignV2

beforeAll(async () => {
  frozenDesign = validateH1ProspectiveDesignV2(JSON.parse(await readFile(designUrl, 'utf8')))
})

function clone<T>(value: T): T {
  return structuredClone(value)
}

describe('M2.3 H1 prospective design v2 validation', () => {
  it('accepts only the frozen pre-analysis identity and task-level inference contract', () => {
    expect(frozenDesign).toMatchObject({
      schema: 'dsh-toolchain-m2-h1-prospective-design-v2',
      version: 'h1-prospective-design-v2',
      status: 'FROZEN-PRE-ANALYSIS',
      analysisUnit: 'task',
      trialsPerTaskArm: 3,
      thresholds: {
        mcidAbsoluteReduction: 0.1,
        taskSuccessNoninferiorityMargin: 0.05,
      },
      canonicalH1Inference: {
        method: 'paired-task-percentile-bootstrap',
        confidenceLevel: 0.95,
        sidedness: 'two-sided',
        lowerQuantile: 0.025,
        resamples: 10000,
        primarySeed: 'm2-v2-primary',
        guardrailSeed: 'm2-v2-guardrail',
      },
      planningApproximation: {
        method: 'normal-known-scenario-variance-v1',
        criticalZ: 1.959963984540054,
        decisionUse: 'prospective-task-count-only',
      },
    })
  })

  it('rejects unknown keys, threshold drift, bootstrap ambiguity and malformed candidate grids', () => {
    expect(() => validateH1ProspectiveDesignV2({
      ...clone(frozenDesign),
      outcomeDrivenOverride: true,
    })).toThrow(/unknown|unexpected/u)

    expect(() => validateH1ProspectiveDesignV2({
      ...clone(frozenDesign),
      thresholds: {
        ...frozenDesign.thresholds,
        mcidAbsoluteReduction: 0.08,
      },
    })).toThrow(/MCID|threshold/u)

    expect(() => validateH1ProspectiveDesignV2({
      ...clone(frozenDesign),
      canonicalH1Inference: {
        ...frozenDesign.canonicalH1Inference,
        lowerQuantile: 0.05,
      },
    })).toThrow(/quantile|inference/u)

    expect(() => validateH1ProspectiveDesignV2({
      ...clone(frozenDesign),
      candidateTaskCounts: [24, 48, 32],
    })).toThrow(/candidate|increasing/u)
  })

  it('rejects duplicate scenario/criterion ids and criteria that reference unknown scenarios', () => {
    const duplicateScenario = clone(frozenDesign)
    duplicateScenario.scenarios[1] = {
      ...duplicateScenario.scenarios[1]!,
      id: duplicateScenario.scenarios[0]!.id,
    }
    expect(() => validateH1ProspectiveDesignV2(duplicateScenario)).toThrow(/scenario.*unique|duplicate.*scenario/u)

    const duplicateCriterion = clone(frozenDesign)
    duplicateCriterion.selection.criteria[1] = {
      ...duplicateCriterion.selection.criteria[1]!,
      id: duplicateCriterion.selection.criteria[0]!.id,
    }
    expect(() => validateH1ProspectiveDesignV2(duplicateCriterion)).toThrow(/criterion.*unique|duplicate.*criterion/u)

    const missingScenario = clone(frozenDesign)
    missingScenario.selection.criteria[0] = {
      ...missingScenario.selection.criteria[0]!,
      scenarioId: 'not-frozen',
    }
    expect(() => validateH1ProspectiveDesignV2(missingScenario)).toThrow(/scenario/u)
  })
})

describe('M2.3 exact discrete task-effect moments', () => {
  it('computes moments from valid thirds rather than trusting scenario labels', () => {
    expect(h1EffectMomentsV2([
      { effectThirds: 1, weight: 0.25 },
      { effectThirds: 0, weight: 0.65 },
      { effectThirds: -1, weight: 0.1 },
    ]).mean).toBeCloseTo(0.05, 12)
  })

  it('rejects non-third effects, invalid weights and distributions that do not sum to one', () => {
    expect(() => h1EffectMomentsV2([
      { effectThirds: 0.5, weight: 1 },
    ])).toThrow(/effectThirds|integer/u)

    expect(() => h1EffectMomentsV2([
      { effectThirds: 0, weight: 0 },
      { effectThirds: 1, weight: 1 },
    ])).toThrow(/weight/u)

    expect(() => h1EffectMomentsV2([
      { effectThirds: 0, weight: 0.4 },
      { effectThirds: 1, weight: 0.4 },
    ])).toThrow(/sum|one/u)
  })

  it('verifies every frozen scenario declared mean against its exact distribution', () => {
    for (const scenario of frozenDesign.scenarios) {
      expect(h1EffectMomentsV2(scenario.primaryEffects).mean).toBeCloseTo(scenario.expectedPrimaryMean, 12)
      expect(h1EffectMomentsV2(scenario.guardrailEffects).mean).toBeCloseTo(scenario.expectedGuardrailMean, 12)
    }
  })
})

describe('M2.3 prospective lower-bound diagnostics', () => {
  it('keeps the estimator resolution tied to three trials per task', () => {
    const report = analyzeH1ProspectiveDesignV2(frozenDesign)
    for (const candidate of report.candidates) {
      for (const scenario of candidate.scenarios) {
        expect(scenario.primary.estimatorResolution).toBeCloseTo(1 / (3 * candidate.taskCount), 15)
        expect(scenario.guardrail.estimatorResolution).toBeCloseTo(1 / (3 * candidate.taskCount), 15)
      }
    }
  })

  it('treats MCID and NI boundary scenarios as ~2.5% diagnostics, not high-power targets', () => {
    const report = analyzeH1ProspectiveDesignV2(frozenDesign)
    for (const candidate of report.candidates) {
      const atMcid = candidate.scenarios.find((item: { scenarioId: string }) => item.scenarioId === 'at-mcid')
      const atNi = candidate.scenarios.find((item: { scenarioId: string }) => item.scenarioId === 'ni-boundary')
      expect(atMcid?.primary.passProbability).toBeCloseTo(0.025, 4)
      expect(atNi?.guardrail.passProbability).toBeCloseTo(0.025, 4)
    }
  })

  it('uses MCID for primary and -NI for the task-success lower-bound threshold', () => {
    const report = analyzeH1ProspectiveDesignV2(frozenDesign)
    const first = report.candidates[0]!
    for (const scenario of first.scenarios) {
      expect(scenario.primary.threshold).toBe(0.1)
      expect(scenario.guardrail.threshold).toBe(-0.05)
    }
  })
})

describe('M2.3 mechanical candidate selection', () => {
  it('selects only a candidate that satisfies every pre-frozen criterion', () => {
    const report = analyzeH1ProspectiveDesignV2(frozenDesign)
    expect(report.outcome === 'ADEQUATE' || report.outcome === 'INADEQUATE').toBe(true)

    if (report.selectedTaskCount === null) {
      expect(report.outcome).toBe('INADEQUATE')
      expect(report.candidates.every((candidate: { meetsAllCriteria: boolean }) => candidate.meetsAllCriteria === false)).toBe(true)
      return
    }

    expect(report.outcome).toBe('ADEQUATE')
    const selectedIndex = report.candidates.findIndex(
      (candidate: { taskCount: number }) => candidate.taskCount === report.selectedTaskCount,
    )
    expect(selectedIndex).toBeGreaterThanOrEqual(0)
    expect(report.candidates[selectedIndex]?.meetsAllCriteria).toBe(true)
    expect(report.candidates.slice(0, selectedIndex).every(
      (candidate: { meetsAllCriteria: boolean }) => candidate.meetsAllCriteria === false,
    )).toBe(true)
  })

  it('does not use boundary diagnostics as hidden selection criteria', () => {
    const frozenCriterionScenarios = new Set(
      frozenDesign.selection.criteria.map((item: { scenarioId: string }) => item.scenarioId),
    )
    for (const diagnostic of frozenDesign.boundaryDiagnostics) {
      expect(frozenCriterionScenarios.has(diagnostic.scenarioId)).toBe(false)
    }
  })

  it('mechanically advances to the next passing candidate when an earlier passing candidate is removed', () => {
    const baseline = analyzeH1ProspectiveDesignV2(frozenDesign)
    if (baseline.selectedTaskCount === null) return

    const selectedIndex = frozenDesign.candidateTaskCounts.indexOf(baseline.selectedTaskCount)
    if (selectedIndex === frozenDesign.candidateTaskCounts.length - 1) return

    const reduced = clone(frozenDesign)
    reduced.candidateTaskCounts = reduced.candidateTaskCounts.filter(
      (value: number) => value !== baseline.selectedTaskCount,
    )
    const next = analyzeH1ProspectiveDesignV2(reduced)
    const baselineLaterPassing = baseline.candidates
      .slice(selectedIndex + 1)
      .find((candidate: { meetsAllCriteria: boolean; taskCount: number }) => candidate.meetsAllCriteria)

    expect(next.selectedTaskCount).toBe(baselineLaterPassing?.taskCount ?? null)
  })
})

describe('M2.3 sensitivity anti-contamination boundary', () => {
  it('has no P0/provider/H1-result dependency and no random or filesystem/network runtime surface', async () => {
    const source = await readFile(engineUrl, 'utf8')
    const forbidden = [
      'p0-live',
      'p0-readjudication',
      'agent-pilot-p0',
      'm2-agent-p0-',
      'providerProbe',
      'Math.random',
      "from 'node:fs",
      "from 'node:http",
      "from 'node:https",
      'fetch(',
    ]
    for (const marker of forbidden) expect(source).not.toContain(marker)
  })
})
