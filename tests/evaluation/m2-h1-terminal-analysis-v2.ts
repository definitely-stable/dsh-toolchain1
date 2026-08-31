import type { Sha256Port } from '../../src/model/digest.js'

export type H1TerminalTaskSuccessV2 = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

export interface H1TerminalObservationV2 {
  readonly taskId: string
  readonly arm: 'A' | 'B' | 'C'
  readonly trial: 1 | 2 | 3
  readonly invalidApi: 0 | 1 | null
  readonly taskSuccess: H1TerminalTaskSuccessV2 | null
  readonly unresolvedApi: boolean
}

interface H1TerminalMetricV2 {
  readonly estimate: number | null
  readonly lowerBound: number | null
  readonly upperBound: number | null
  readonly threshold: number
  readonly decisionPass: boolean | null
}

export interface H1TerminalAnalysisV2 {
  readonly schema: 'dsh-toolchain-m2-h1-terminal-analysis-v2'
  readonly version: 'h1-terminal-analysis-v2'
  readonly status: 'PASS' | 'NEEDS-IMPROVEMENT' | 'INCONCLUSIVE'
  readonly taskCount: number
  readonly unresolvedDecisionRuns: number
  readonly infrastructureInconclusive: boolean
  readonly primary: H1TerminalMetricV2
  readonly guardrail: H1TerminalMetricV2
  readonly analysis: {
    readonly method: 'paired-task-percentile-bootstrap'
    readonly confidenceLevel: 0.95
    readonly lowerQuantile: 0.025
    readonly upperQuantile: 0.975
    readonly resamples: 10000
    readonly primarySeed: 'm2-v2-primary'
    readonly guardrailSeed: 'm2-v2-guardrail'
    readonly quantileAlgorithm: 'linear-type-7'
  }
}

const EXPECTED_TASK_COUNT = 96
const TRIALS = [1, 2, 3] as const
const PRIMARY_SEED = 'm2-v2-primary'
const GUARDRAIL_SEED = 'm2-v2-guardrail'
const RESAMPLES = 10_000
const PRIMARY_THRESHOLD = 0.10
const GUARDRAIL_THRESHOLD = -0.05
const LOWER_QUANTILE = 0.025
const UPPER_QUANTILE = 0.975

function requireFiniteUnit(value: number | null, label: string): 0 | 1 | null {
  if (value === null) return null
  if (value !== 0 && value !== 1) throw new Error(`${label} must be 0, 1 or null`)
  return value
}

function observationKey(value: H1TerminalObservationV2): string {
  return `${value.taskId}\u0000${value.arm}\u0000${value.trial}`
}

function validateObservations(observations: readonly H1TerminalObservationV2[]): readonly string[] {
  const taskIds = [...new Set(observations.map(value => value.taskId))].toSorted()
  if (taskIds.length !== EXPECTED_TASK_COUNT) {
    throw new Error(`H1 terminal analysis requires exactly ${EXPECTED_TASK_COUNT} task ids, got ${taskIds.length}`)
  }
  const byKey = new Map<string, H1TerminalObservationV2>()
  for (const observation of observations) {
    if (observation.taskId.trim().length === 0) throw new Error('H1 terminal observation taskId must be non-empty')
    if (observation.arm !== 'A' && observation.arm !== 'B' && observation.arm !== 'C') {
      throw new Error('H1 terminal observation arm must be A, B or C')
    }
    if (!TRIALS.includes(observation.trial)) throw new Error('H1 terminal observation trial must be 1, 2 or 3')
    requireFiniteUnit(observation.invalidApi, 'H1 terminal invalid API indicator')
    if (
      observation.taskSuccess !== null
      && observation.taskSuccess !== 'SUCCESS'
      && observation.taskSuccess !== 'FAILURE'
      && observation.taskSuccess !== 'UNKNOWN'
    ) {
      throw new Error('H1 terminal taskSuccess is invalid')
    }
    const key = observationKey(observation)
    if (byKey.has(key)) throw new Error(`H1 terminal observation is duplicated: ${key}`)
    byKey.set(key, observation)
  }

  for (const taskId of taskIds) {
    for (const arm of ['B', 'C'] as const) {
      for (const trial of TRIALS) {
        const key = `${taskId}\u0000${arm}\u0000${trial}`
        if (!byKey.has(key)) throw new Error(`H1 terminal analysis is missing decision observation ${key}`)
      }
    }
  }
  return taskIds
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('H1 terminal metric mean requires at least one value')
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantileType7(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) throw new Error('H1 terminal bootstrap quantile requires samples')
  if (!(probability >= 0 && probability <= 1)) throw new Error('H1 terminal bootstrap quantile probability is invalid')
  if (sorted.length === 1) return sorted[0]!
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const left = sorted[lower]!
  const right = sorted[upper]!
  return left + (right - left) * (position - lower)
}

async function seededRandom(seed: string, sha256: Sha256Port): Promise<() => number> {
  const digest = await sha256.sha256Utf8(seed)
  let state = Number.parseInt(digest.slice(0, 8), 16) >>> 0
  if (state === 0) state = 0x6d2b79f5
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

async function pairedBootstrap(
  effects: readonly number[],
  seed: string,
  sha256: Sha256Port,
): Promise<{ readonly estimate: number; readonly lowerBound: number; readonly upperBound: number }> {
  const random = await seededRandom(seed, sha256)
  const samples = new Array<number>(RESAMPLES)
  for (let sampleIndex = 0; sampleIndex < RESAMPLES; sampleIndex += 1) {
    let total = 0
    for (let draw = 0; draw < effects.length; draw += 1) {
      total += effects[Math.floor(random() * effects.length)]!
    }
    samples[sampleIndex] = total / effects.length
  }
  const sorted = samples.toSorted((left, right) => left - right)
  return Object.freeze({
    estimate: mean(effects),
    lowerBound: quantileType7(sorted, LOWER_QUANTILE),
    upperBound: quantileType7(sorted, UPPER_QUANTILE),
  })
}

function decisionObservationUnresolved(value: H1TerminalObservationV2): boolean {
  return value.invalidApi === null
    || value.unresolvedApi
    || value.taskSuccess === null
    || value.taskSuccess === 'UNKNOWN'
}

function resolvedMetric(
  bootstrap: { readonly estimate: number; readonly lowerBound: number; readonly upperBound: number },
  threshold: number,
): H1TerminalMetricV2 {
  return Object.freeze({
    ...bootstrap,
    threshold,
    decisionPass: bootstrap.lowerBound >= threshold,
  })
}

function inconclusiveMetric(threshold: number): H1TerminalMetricV2 {
  return Object.freeze({
    estimate: null,
    lowerBound: null,
    upperBound: null,
    threshold,
    decisionPass: null,
  })
}

export async function analyzeH1TerminalObservationsV2(
  observations: readonly H1TerminalObservationV2[],
  infrastructureInconclusive: boolean,
  sha256: Sha256Port,
): Promise<H1TerminalAnalysisV2> {
  const taskIds = validateObservations(observations)
  const decision = observations.filter(value => value.arm === 'B' || value.arm === 'C')
  const unresolvedDecisionRuns = decision.filter(decisionObservationUnresolved).length
  const analysis = Object.freeze({
    method: 'paired-task-percentile-bootstrap' as const,
    confidenceLevel: 0.95 as const,
    lowerQuantile: LOWER_QUANTILE as 0.025,
    upperQuantile: UPPER_QUANTILE as 0.975,
    resamples: RESAMPLES as 10000,
    primarySeed: PRIMARY_SEED as 'm2-v2-primary',
    guardrailSeed: GUARDRAIL_SEED as 'm2-v2-guardrail',
    quantileAlgorithm: 'linear-type-7' as const,
  })

  if (infrastructureInconclusive || unresolvedDecisionRuns > 0) {
    return Object.freeze({
      schema: 'dsh-toolchain-m2-h1-terminal-analysis-v2',
      version: 'h1-terminal-analysis-v2',
      status: 'INCONCLUSIVE',
      taskCount: taskIds.length,
      unresolvedDecisionRuns,
      infrastructureInconclusive,
      primary: inconclusiveMetric(PRIMARY_THRESHOLD),
      guardrail: inconclusiveMetric(GUARDRAIL_THRESHOLD),
      analysis,
    })
  }

  const byKey = new Map(decision.map(value => [observationKey(value), value] as const))
  const primaryEffects: number[] = []
  const guardrailEffects: number[] = []
  for (const taskId of taskIds) {
    const invalid: Record<'B' | 'C', number[]> = { B: [], C: [] }
    const success: Record<'B' | 'C', number[]> = { B: [], C: [] }
    for (const arm of ['B', 'C'] as const) {
      for (const trial of TRIALS) {
        const observation = byKey.get(`${taskId}\u0000${arm}\u0000${trial}`)!
        invalid[arm].push(observation.invalidApi as 0 | 1)
        success[arm].push(observation.taskSuccess === 'SUCCESS' ? 1 : 0)
      }
    }
    primaryEffects.push(mean(invalid.B) - mean(invalid.C))
    guardrailEffects.push(mean(success.C) - mean(success.B))
  }

  const [primaryBootstrap, guardrailBootstrap] = await Promise.all([
    pairedBootstrap(primaryEffects, PRIMARY_SEED, sha256),
    pairedBootstrap(guardrailEffects, GUARDRAIL_SEED, sha256),
  ])
  const primary = resolvedMetric(primaryBootstrap, PRIMARY_THRESHOLD)
  const guardrail = resolvedMetric(guardrailBootstrap, GUARDRAIL_THRESHOLD)
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-terminal-analysis-v2',
    version: 'h1-terminal-analysis-v2',
    status: primary.decisionPass === true && guardrail.decisionPass === true ? 'PASS' : 'NEEDS-IMPROVEMENT',
    taskCount: taskIds.length,
    unresolvedDecisionRuns,
    infrastructureInconclusive,
    primary,
    guardrail,
    analysis,
  })
}
