import {
  analyzeH1ProspectiveDesignV2,
  h1EffectMomentsV2,
  validateH1ProspectiveDesignV2,
  type H1EffectPointV2,
  type H1ProspectiveDesignV2,
  type H1SelectionCriterionV2,
} from './m2-h1-design-sensitivity-v2.js'

const FLOAT_TOLERANCE = 1e-15

export interface H1ExactEndpointAuditV2 {
  readonly passProbability: number
}

export interface H1ExactScenarioAuditV2 {
  readonly scenarioId: string
  readonly primary: H1ExactEndpointAuditV2
  readonly guardrail: H1ExactEndpointAuditV2
}

export interface H1ExactCriterionAuditV2 {
  readonly criterionId: string
  readonly scenarioId: string
  readonly endpoint: 'primary' | 'guardrail'
  readonly comparator: 'gte' | 'lte'
  readonly target: number
  readonly actual: number
  readonly passed: boolean
}

export interface H1ExactCandidateAuditV2 {
  readonly taskCount: number
  readonly scenarios: readonly H1ExactScenarioAuditV2[]
  readonly criteria: readonly H1ExactCriterionAuditV2[]
  readonly meetsAllCriteria: boolean
}

export interface H1ProspectiveExactAuditV2 {
  readonly schema: 'dsh-toolchain-m2-h1-exact-audit-v2'
  readonly approximateSelectedTaskCount: number | null
  readonly exactSelectedTaskCount: number | null
  readonly selectionAgrees: boolean
  readonly candidates: readonly H1ExactCandidateAuditV2[]
  readonly maxAbsolutePassProbabilityDelta: number
}

function exactKnownVariancePassProbability(
  distribution: readonly H1EffectPointV2[],
  threshold: number,
  taskCount: number,
  criticalZ: number,
): number {
  const moments = h1EffectMomentsV2(distribution)
  if (moments.standardDeviation === 0) {
    return moments.mean >= threshold ? 1 : 0
  }

  const lowerBoundCutoff = threshold
    + (criticalZ * moments.standardDeviation) / Math.sqrt(taskCount)

  let sums = new Map<number, number>([[0, 1]])
  for (let taskIndex = 0; taskIndex < taskCount; taskIndex += 1) {
    const next = new Map<number, number>()
    for (const [sumThirds, probability] of sums) {
      for (const point of distribution) {
        const nextSum = sumThirds + point.effectThirds
        next.set(nextSum, (next.get(nextSum) ?? 0) + probability * point.weight)
      }
    }
    sums = next
  }

  let passProbability = 0
  for (const [sumThirds, probability] of sums) {
    const sampleMean = sumThirds / (3 * taskCount)
    if (sampleMean + FLOAT_TOLERANCE >= lowerBoundCutoff) {
      passProbability += probability
    }
  }
  return Math.min(1, Math.max(0, passProbability))
}

function criterionAudit(
  criterion: H1SelectionCriterionV2,
  scenarios: readonly H1ExactScenarioAuditV2[],
): H1ExactCriterionAuditV2 {
  const scenario = scenarios.find(item => item.scenarioId === criterion.scenarioId)
  if (scenario === undefined) {
    throw new Error(`missing exact-audit scenario ${criterion.scenarioId}`)
  }
  const actual = scenario[criterion.endpoint].passProbability
  const passed = criterion.comparator === 'gte'
    ? actual >= criterion.value
    : actual <= criterion.value
  return Object.freeze({
    criterionId: criterion.id,
    scenarioId: criterion.scenarioId,
    endpoint: criterion.endpoint,
    comparator: criterion.comparator,
    target: criterion.value,
    actual,
    passed,
  })
}

export function auditH1ProspectiveDesignExactV2(value: unknown): H1ProspectiveExactAuditV2 {
  const design: H1ProspectiveDesignV2 = validateH1ProspectiveDesignV2(value)
  const approximate = analyzeH1ProspectiveDesignV2(design)
  const primaryThreshold = design.thresholds.mcidAbsoluteReduction
  const guardrailThreshold = -design.thresholds.taskSuccessNoninferiorityMargin
  const criticalZ = design.planningApproximation.criticalZ

  const candidates = design.candidateTaskCounts.map(taskCount => {
    const scenarios = design.scenarios.map(scenario => Object.freeze({
      scenarioId: scenario.id,
      primary: Object.freeze({
        passProbability: exactKnownVariancePassProbability(
          scenario.primaryEffects,
          primaryThreshold,
          taskCount,
          criticalZ,
        ),
      }),
      guardrail: Object.freeze({
        passProbability: exactKnownVariancePassProbability(
          scenario.guardrailEffects,
          guardrailThreshold,
          taskCount,
          criticalZ,
        ),
      }),
    }))
    const criteria = design.selection.criteria.map(criterion => criterionAudit(criterion, scenarios))
    return Object.freeze({
      taskCount,
      scenarios: Object.freeze(scenarios),
      criteria: Object.freeze(criteria),
      meetsAllCriteria: criteria.every(criterion => criterion.passed),
    })
  })

  const exactSelectedTaskCount = candidates.find(candidate => candidate.meetsAllCriteria)?.taskCount ?? null
  const approximateSelectedTaskCount = approximate.selectedTaskCount

  let maxAbsolutePassProbabilityDelta = 0
  for (const approximateCandidate of approximate.candidates) {
    const exactCandidate = candidates.find(candidate => candidate.taskCount === approximateCandidate.taskCount)
    if (exactCandidate === undefined) throw new Error(`missing exact-audit candidate ${approximateCandidate.taskCount}`)
    for (const approximateScenario of approximateCandidate.scenarios) {
      const exactScenario = exactCandidate.scenarios.find(item => item.scenarioId === approximateScenario.scenarioId)
      if (exactScenario === undefined) throw new Error(`missing exact-audit scenario ${approximateScenario.scenarioId}`)
      maxAbsolutePassProbabilityDelta = Math.max(
        maxAbsolutePassProbabilityDelta,
        Math.abs(approximateScenario.primary.passProbability - exactScenario.primary.passProbability),
        Math.abs(approximateScenario.guardrail.passProbability - exactScenario.guardrail.passProbability),
      )
    }
  }

  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-exact-audit-v2',
    approximateSelectedTaskCount,
    exactSelectedTaskCount,
    selectionAgrees: approximateSelectedTaskCount === exactSelectedTaskCount,
    candidates: Object.freeze(candidates),
    maxAbsolutePassProbabilityDelta,
  })
}
