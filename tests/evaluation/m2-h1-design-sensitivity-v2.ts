const DISTRIBUTION_TOLERANCE = 1e-12
const EXPECTED_MCID = 0.1
const EXPECTED_NONINFERIORITY_MARGIN = 0.05
const EXPECTED_CRITICAL_Z = 1.959963984540054

export interface H1EffectPointV2 {
  effectThirds: number
  weight: number
}

export interface H1EffectMomentsV2 {
  mean: number
  variance: number
  standardDeviation: number
}

export interface H1DesignScenarioV2 {
  id: string
  purpose: string
  primaryEffects: H1EffectPointV2[]
  guardrailEffects: H1EffectPointV2[]
  expectedPrimaryMean: number
  expectedGuardrailMean: number
}

export interface H1SelectionCriterionV2 {
  id: string
  scenarioId: string
  endpoint: 'primary' | 'guardrail'
  statistic: 'passProbability'
  comparator: 'gte' | 'lte'
  value: number
}

export interface H1BoundaryDiagnosticV2 {
  scenarioId: string
  endpoint: 'primary' | 'guardrail'
  expectedPassProbability: number
}

export interface H1ProspectiveDesignV2 {
  schema: 'dsh-toolchain-m2-h1-prospective-design-v2'
  version: 'h1-prospective-design-v2'
  status: 'FROZEN-PRE-ANALYSIS'
  analysisUnit: 'task'
  trialsPerTaskArm: 3
  thresholds: {
    mcidAbsoluteReduction: 0.1
    taskSuccessNoninferiorityMargin: 0.05
  }
  canonicalH1Inference: {
    method: 'paired-task-percentile-bootstrap'
    confidenceLevel: 0.95
    sidedness: 'two-sided'
    lowerQuantile: 0.025
    resamples: 10000
    primarySeed: 'm2-v2-primary'
    guardrailSeed: 'm2-v2-guardrail'
  }
  planningApproximation: {
    method: 'normal-known-scenario-variance-v1'
    criticalZ: number
    decisionUse: 'prospective-task-count-only'
  }
  candidateTaskCounts: number[]
  selection: {
    rule: 'smallest-candidate-meeting-all-criteria'
    criteria: H1SelectionCriterionV2[]
  }
  boundaryDiagnostics: H1BoundaryDiagnosticV2[]
  scenarios: H1DesignScenarioV2[]
}

export interface H1EndpointSensitivityV2 {
  mean: number
  variance: number
  standardDeviation: number
  threshold: number
  estimatorResolution: number
  expectedLowerBound: number
  passProbability: number
}

export interface H1ScenarioSensitivityV2 {
  scenarioId: string
  primary: H1EndpointSensitivityV2
  guardrail: H1EndpointSensitivityV2
}

export interface H1CriterionResultV2 {
  criterionId: string
  scenarioId: string
  endpoint: 'primary' | 'guardrail'
  comparator: 'gte' | 'lte'
  target: number
  actual: number
  passed: boolean
}

export interface H1CandidateSensitivityV2 {
  taskCount: number
  scenarios: H1ScenarioSensitivityV2[]
  criteria: H1CriterionResultV2[]
  meetsAllCriteria: boolean
}

export interface H1ProspectiveSensitivityReportV2 {
  schema: 'dsh-toolchain-m2-h1-sensitivity-report-v2'
  designStatus: 'FROZEN-PRE-ANALYSIS'
  candidates: H1CandidateSensitivityV2[]
  selectedTaskCount: number | null
  outcome: 'ADEQUATE' | 'INADEQUATE'
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`${label} has unknown key(s): ${unknown.join(', ')}`)
  const missing = keys.filter(key => !(key in record))
  if (missing.length > 0) throw new Error(`${label} is missing key(s): ${missing.join(', ')}`)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function requireProbability(value: unknown, label: string): number {
  const number = requireFiniteNumber(value, label)
  if (number < 0 || number > 1) throw new Error(`${label} must be within [0, 1]`)
  return number
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireLiteral<T extends string | number>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must remain ${String(expected)}`)
  return expected
}

function near(left: number, right: number, tolerance = DISTRIBUTION_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance
}

function validateEffectDistribution(value: unknown, label: string): H1EffectPointV2[] {
  const values = requireArray(value, label)
  if (values.length === 0) throw new Error(`${label} must not be empty`)
  const seenEffects = new Set<number>()
  const points = values.map((pointValue, index) => {
    const point = requireRecord(pointValue, `${label}[${index}]`)
    assertExactKeys(point, ['effectThirds', 'weight'], `${label}[${index}]`)
    const effectThirds = requireFiniteNumber(point.effectThirds, `${label}[${index}].effectThirds`)
    if (!Number.isInteger(effectThirds) || effectThirds < -3 || effectThirds > 3) {
      throw new Error(`${label}[${index}].effectThirds must be an integer within [-3, 3]`)
    }
    if (seenEffects.has(effectThirds)) throw new Error(`${label} effectThirds values must be unique`)
    seenEffects.add(effectThirds)
    const weight = requireFiniteNumber(point.weight, `${label}[${index}].weight`)
    if (weight <= 0 || weight > 1) throw new Error(`${label}[${index}].weight must be within (0, 1]`)
    return { effectThirds, weight }
  })
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0)
  if (!near(totalWeight, 1)) throw new Error(`${label} weights must sum to one`)
  return points
}

export function h1EffectMomentsV2(distribution: readonly H1EffectPointV2[]): H1EffectMomentsV2 {
  const points = validateEffectDistribution(distribution, 'H1 effect distribution')
  const mean = points.reduce((sum, point) => sum + (point.effectThirds / 3) * point.weight, 0)
  const variance = points.reduce((sum, point) => {
    const effect = point.effectThirds / 3
    const difference = effect - mean
    return sum + point.weight * difference * difference
  }, 0)
  return {
    mean,
    variance,
    standardDeviation: Math.sqrt(Math.max(0, variance)),
  }
}

function validateScenario(value: unknown, index: number): H1DesignScenarioV2 {
  const scenario = requireRecord(value, `H1 design scenario[${index}]`)
  assertExactKeys(
    scenario,
    ['id', 'purpose', 'primaryEffects', 'guardrailEffects', 'expectedPrimaryMean', 'expectedGuardrailMean'],
    `H1 design scenario[${index}]`,
  )
  const id = requireString(scenario.id, `H1 design scenario[${index}].id`)
  if (!/^[a-z][a-z0-9-]*$/u.test(id)) throw new Error(`H1 design scenario id ${id} is invalid`)
  const purpose = requireString(scenario.purpose, `H1 design scenario ${id} purpose`)
  const primaryEffects = validateEffectDistribution(scenario.primaryEffects, `H1 design scenario ${id} primaryEffects`)
  const guardrailEffects = validateEffectDistribution(scenario.guardrailEffects, `H1 design scenario ${id} guardrailEffects`)
  const expectedPrimaryMean = requireFiniteNumber(scenario.expectedPrimaryMean, `H1 design scenario ${id} expectedPrimaryMean`)
  const expectedGuardrailMean = requireFiniteNumber(scenario.expectedGuardrailMean, `H1 design scenario ${id} expectedGuardrailMean`)
  if (expectedPrimaryMean < -1 || expectedPrimaryMean > 1 || expectedGuardrailMean < -1 || expectedGuardrailMean > 1) {
    throw new Error(`H1 design scenario ${id} expected means must be within [-1, 1]`)
  }
  const primaryMoments = h1EffectMomentsV2(primaryEffects)
  const guardrailMoments = h1EffectMomentsV2(guardrailEffects)
  if (!near(primaryMoments.mean, expectedPrimaryMean)) {
    throw new Error(`H1 design scenario ${id} expectedPrimaryMean does not match its distribution`)
  }
  if (!near(guardrailMoments.mean, expectedGuardrailMean)) {
    throw new Error(`H1 design scenario ${id} expectedGuardrailMean does not match its distribution`)
  }
  return { id, purpose, primaryEffects, guardrailEffects, expectedPrimaryMean, expectedGuardrailMean }
}

function validateCriterion(value: unknown, index: number): H1SelectionCriterionV2 {
  const criterion = requireRecord(value, `H1 selection criterion[${index}]`)
  assertExactKeys(
    criterion,
    ['id', 'scenarioId', 'endpoint', 'statistic', 'comparator', 'value'],
    `H1 selection criterion[${index}]`,
  )
  const id = requireString(criterion.id, `H1 selection criterion[${index}].id`)
  const scenarioId = requireString(criterion.scenarioId, `H1 selection criterion ${id} scenarioId`)
  if (criterion.endpoint !== 'primary' && criterion.endpoint !== 'guardrail') {
    throw new Error(`H1 selection criterion ${id} endpoint is invalid`)
  }
  if (criterion.statistic !== 'passProbability') throw new Error(`H1 selection criterion ${id} statistic is invalid`)
  if (criterion.comparator !== 'gte' && criterion.comparator !== 'lte') {
    throw new Error(`H1 selection criterion ${id} comparator is invalid`)
  }
  const threshold = requireProbability(criterion.value, `H1 selection criterion ${id} value`)
  return {
    id,
    scenarioId,
    endpoint: criterion.endpoint,
    statistic: 'passProbability',
    comparator: criterion.comparator,
    value: threshold,
  }
}

function validateBoundaryDiagnostic(value: unknown, index: number): H1BoundaryDiagnosticV2 {
  const diagnostic = requireRecord(value, `H1 boundary diagnostic[${index}]`)
  assertExactKeys(diagnostic, ['scenarioId', 'endpoint', 'expectedPassProbability'], `H1 boundary diagnostic[${index}]`)
  const scenarioId = requireString(diagnostic.scenarioId, `H1 boundary diagnostic[${index}].scenarioId`)
  if (diagnostic.endpoint !== 'primary' && diagnostic.endpoint !== 'guardrail') {
    throw new Error(`H1 boundary diagnostic ${scenarioId} endpoint is invalid`)
  }
  const expectedPassProbability = requireProbability(
    diagnostic.expectedPassProbability,
    `H1 boundary diagnostic ${scenarioId} expectedPassProbability`,
  )
  if (!near(expectedPassProbability, 0.025)) {
    throw new Error(`H1 boundary diagnostic ${scenarioId} must preserve the 0.025 two-sided lower-tail probability`)
  }
  return { scenarioId, endpoint: diagnostic.endpoint, expectedPassProbability }
}

export function validateH1ProspectiveDesignV2(value: unknown): H1ProspectiveDesignV2 {
  const design = requireRecord(value, 'H1 prospective design v2')
  assertExactKeys(
    design,
    [
      'schema',
      'version',
      'status',
      'analysisUnit',
      'trialsPerTaskArm',
      'thresholds',
      'canonicalH1Inference',
      'planningApproximation',
      'candidateTaskCounts',
      'selection',
      'boundaryDiagnostics',
      'scenarios',
    ],
    'H1 prospective design v2',
  )
  requireLiteral(design.schema, 'dsh-toolchain-m2-h1-prospective-design-v2', 'H1 prospective design schema')
  requireLiteral(design.version, 'h1-prospective-design-v2', 'H1 prospective design version')
  requireLiteral(design.status, 'FROZEN-PRE-ANALYSIS', 'H1 prospective design status')
  requireLiteral(design.analysisUnit, 'task', 'H1 prospective design analysis unit')
  requireLiteral(design.trialsPerTaskArm, 3, 'H1 prospective design trials per task/arm')

  const thresholds = requireRecord(design.thresholds, 'H1 prospective design thresholds')
  assertExactKeys(thresholds, ['mcidAbsoluteReduction', 'taskSuccessNoninferiorityMargin'], 'H1 prospective design thresholds')
  if (!near(requireFiniteNumber(thresholds.mcidAbsoluteReduction, 'H1 design MCID'), EXPECTED_MCID)) {
    throw new Error('H1 prospective design MCID threshold drifted')
  }
  if (!near(requireFiniteNumber(thresholds.taskSuccessNoninferiorityMargin, 'H1 design non-inferiority margin'), EXPECTED_NONINFERIORITY_MARGIN)) {
    throw new Error('H1 prospective design non-inferiority threshold drifted')
  }

  const inference = requireRecord(design.canonicalH1Inference, 'H1 canonical inference')
  assertExactKeys(
    inference,
    ['method', 'confidenceLevel', 'sidedness', 'lowerQuantile', 'resamples', 'primarySeed', 'guardrailSeed'],
    'H1 canonical inference',
  )
  requireLiteral(inference.method, 'paired-task-percentile-bootstrap', 'H1 canonical inference method')
  requireLiteral(inference.confidenceLevel, 0.95, 'H1 canonical inference confidence level')
  requireLiteral(inference.sidedness, 'two-sided', 'H1 canonical inference sidedness')
  if (!near(requireFiniteNumber(inference.lowerQuantile, 'H1 canonical inference lower quantile'), 0.025)) {
    throw new Error('H1 canonical inference lower quantile drifted')
  }
  requireLiteral(inference.resamples, 10000, 'H1 canonical inference resamples')
  requireLiteral(inference.primarySeed, 'm2-v2-primary', 'H1 canonical primary seed')
  requireLiteral(inference.guardrailSeed, 'm2-v2-guardrail', 'H1 canonical guardrail seed')

  const planning = requireRecord(design.planningApproximation, 'H1 planning approximation')
  assertExactKeys(planning, ['method', 'criticalZ', 'decisionUse'], 'H1 planning approximation')
  requireLiteral(planning.method, 'normal-known-scenario-variance-v1', 'H1 planning approximation method')
  const criticalZ = requireFiniteNumber(planning.criticalZ, 'H1 planning critical z')
  if (!near(criticalZ, EXPECTED_CRITICAL_Z, 1e-15)) throw new Error('H1 planning critical z drifted')
  requireLiteral(planning.decisionUse, 'prospective-task-count-only', 'H1 planning approximation decision use')

  const candidateTaskCounts = requireArray(design.candidateTaskCounts, 'H1 candidate task counts').map((value, index) => {
    const count = requireFiniteNumber(value, `H1 candidate task count[${index}]`)
    if (!Number.isInteger(count) || count < 1) throw new Error('H1 candidate task counts must be positive integers')
    return count
  })
  if (candidateTaskCounts.length === 0) throw new Error('H1 candidate task counts must not be empty')
  for (let index = 1; index < candidateTaskCounts.length; index += 1) {
    if ((candidateTaskCounts[index - 1] ?? 0) >= (candidateTaskCounts[index] ?? 0)) {
      throw new Error('H1 candidate task counts must be unique and strictly increasing')
    }
  }

  const scenarios = requireArray(design.scenarios, 'H1 prospective design scenarios').map(validateScenario)
  if (scenarios.length === 0) throw new Error('H1 prospective design scenarios must not be empty')
  const scenarioIds = new Set<string>()
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.id)) throw new Error(`H1 design scenario ids must be unique: duplicate ${scenario.id}`)
    scenarioIds.add(scenario.id)
  }

  const selection = requireRecord(design.selection, 'H1 task-count selection')
  assertExactKeys(selection, ['rule', 'criteria'], 'H1 task-count selection')
  requireLiteral(selection.rule, 'smallest-candidate-meeting-all-criteria', 'H1 task-count selection rule')
  const criteria = requireArray(selection.criteria, 'H1 selection criteria').map(validateCriterion)
  if (criteria.length === 0) throw new Error('H1 selection criteria must not be empty')
  const criterionIds = new Set<string>()
  for (const criterion of criteria) {
    if (criterionIds.has(criterion.id)) throw new Error(`H1 selection criterion ids must be unique: duplicate ${criterion.id}`)
    criterionIds.add(criterion.id)
    if (!scenarioIds.has(criterion.scenarioId)) {
      throw new Error(`H1 selection criterion ${criterion.id} references unknown scenario ${criterion.scenarioId}`)
    }
  }

  const boundaryDiagnostics = requireArray(design.boundaryDiagnostics, 'H1 boundary diagnostics')
    .map(validateBoundaryDiagnostic)
  if (boundaryDiagnostics.length === 0) throw new Error('H1 boundary diagnostics must not be empty')
  const criterionScenarioIds = new Set(criteria.map(criterion => criterion.scenarioId))
  for (const diagnostic of boundaryDiagnostics) {
    if (!scenarioIds.has(diagnostic.scenarioId)) {
      throw new Error(`H1 boundary diagnostic references unknown scenario ${diagnostic.scenarioId}`)
    }
    if (criterionScenarioIds.has(diagnostic.scenarioId)) {
      throw new Error(`H1 boundary diagnostic ${diagnostic.scenarioId} must not be a selection criterion`)
    }
  }

  return {
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
      criticalZ,
      decisionUse: 'prospective-task-count-only',
    },
    candidateTaskCounts,
    selection: {
      rule: 'smallest-candidate-meeting-all-criteria',
      criteria,
    },
    boundaryDiagnostics,
    scenarios,
  }
}

function standardNormalCdf(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return 1
  if (value === Number.NEGATIVE_INFINITY) return 0
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.SQRT2
  const p = 0.3275911
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const t = 1 / (1 + p * x)
  const polynomial = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t
  const erf = sign * (1 - polynomial * Math.exp(-x * x))
  return Math.min(1, Math.max(0, 0.5 * (1 + erf)))
}

function endpointSensitivity(
  moments: H1EffectMomentsV2,
  threshold: number,
  taskCount: number,
  criticalZ: number,
  trialsPerTaskArm: number,
): H1EndpointSensitivityV2 {
  const estimatorResolution = 1 / (trialsPerTaskArm * taskCount)
  if (moments.standardDeviation === 0) {
    const expectedLowerBound = moments.mean
    return {
      ...moments,
      threshold,
      estimatorResolution,
      expectedLowerBound,
      passProbability: expectedLowerBound >= threshold ? 1 : 0,
    }
  }
  const standardError = moments.standardDeviation / Math.sqrt(taskCount)
  const expectedLowerBound = moments.mean - criticalZ * standardError
  const standardizedPass = ((moments.mean - threshold) / standardError) - criticalZ
  return {
    ...moments,
    threshold,
    estimatorResolution,
    expectedLowerBound,
    passProbability: standardNormalCdf(standardizedPass),
  }
}

function criterionResult(
  criterion: H1SelectionCriterionV2,
  scenarios: readonly H1ScenarioSensitivityV2[],
): H1CriterionResultV2 {
  const scenario = scenarios.find(item => item.scenarioId === criterion.scenarioId)
  if (scenario === undefined) throw new Error(`missing computed H1 scenario ${criterion.scenarioId}`)
  const actual = scenario[criterion.endpoint].passProbability
  const passed = criterion.comparator === 'gte'
    ? actual >= criterion.value
    : actual <= criterion.value
  return {
    criterionId: criterion.id,
    scenarioId: criterion.scenarioId,
    endpoint: criterion.endpoint,
    comparator: criterion.comparator,
    target: criterion.value,
    actual,
    passed,
  }
}

export function analyzeH1ProspectiveDesignV2(value: unknown): H1ProspectiveSensitivityReportV2 {
  const design = validateH1ProspectiveDesignV2(value)
  const primaryThreshold = design.thresholds.mcidAbsoluteReduction
  const guardrailThreshold = -design.thresholds.taskSuccessNoninferiorityMargin
  const criticalZ = design.planningApproximation.criticalZ

  const candidates = design.candidateTaskCounts.map(taskCount => {
    const scenarios = design.scenarios.map(scenario => ({
      scenarioId: scenario.id,
      primary: endpointSensitivity(
        h1EffectMomentsV2(scenario.primaryEffects),
        primaryThreshold,
        taskCount,
        criticalZ,
        design.trialsPerTaskArm,
      ),
      guardrail: endpointSensitivity(
        h1EffectMomentsV2(scenario.guardrailEffects),
        guardrailThreshold,
        taskCount,
        criticalZ,
        design.trialsPerTaskArm,
      ),
    }))
    const criteria = design.selection.criteria.map(criterion => criterionResult(criterion, scenarios))
    return {
      taskCount,
      scenarios,
      criteria,
      meetsAllCriteria: criteria.every(criterion => criterion.passed),
    }
  })

  const selected = candidates.find(candidate => candidate.meetsAllCriteria)
  return {
    schema: 'dsh-toolchain-m2-h1-sensitivity-report-v2',
    designStatus: design.status,
    candidates,
    selectedTaskCount: selected?.taskCount ?? null,
    outcome: selected === undefined ? 'INADEQUATE' : 'ADEQUATE',
  }
}
