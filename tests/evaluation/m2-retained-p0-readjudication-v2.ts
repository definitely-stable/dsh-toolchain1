import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import {
  adjudicateP0ModelOutcomeV2,
  type P0ApiClaimResolutionV2,
  type P0TaskSuccessV2,
} from './m2-agent-p0-adjudication-v2.js'
import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'

const REPORT_SCHEMA = 'dsh-toolchain-m2-p0-readjudication-v2' as const
const ADJUDICATOR_ID = 'dsh-toolchain-m2-p0-adjudication-v2' as const
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u

export type RetainedP0ArmV2 = 'A' | 'B' | 'C'

export interface RetainedP0ReAdjudicationV2Source {
  readonly runId: number
  readonly headSha: string
  readonly definitionSha256: string
  readonly resultSha256: string
  readonly historicalStatus: string
  readonly scheduledRuns: number
  readonly modelOutcomes: number
}

export interface RetainedP0ReAdjudicationV2Claim {
  readonly package: string | '*'
  readonly symbol: string
  readonly assertion: 'exists' | 'absent'
  readonly classification: 'VALID' | 'INVALID' | 'UNKNOWN'
  readonly resolution: P0ApiClaimResolutionV2
}

export interface RetainedP0ReAdjudicationV2Run {
  readonly taskId: string
  readonly arm: RetainedP0ArmV2
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly taskSuccess: P0TaskSuccessV2
  readonly apiClaims: readonly RetainedP0ReAdjudicationV2Claim[]
}

export interface RetainedP0ReAdjudicationV2ArmSummary {
  readonly modelOutcomes: number
  readonly success: number
  readonly failure: number
  readonly unknown: number
  readonly validClaims: number
  readonly invalidClaims: number
  readonly unknownClaims: number
}

export interface RetainedP0ReAdjudicationV2Report {
  readonly schema: typeof REPORT_SCHEMA
  readonly derived: true
  readonly source: RetainedP0ReAdjudicationV2Source
  readonly adjudicator: typeof ADJUDICATOR_ID
  readonly truthFingerprint: string
  readonly runs: readonly RetainedP0ReAdjudicationV2Run[]
  readonly byArm: Readonly<Record<RetainedP0ArmV2, RetainedP0ReAdjudicationV2ArmSummary>>
  readonly reportSha256: string
}

export interface RetainedP0ReAdjudicationV2Input {
  readonly source: RetainedP0ReAdjudicationV2Source
  readonly retainedResult: unknown
}

interface RetainedModelOutcomeAttempt {
  readonly outcome: 'model-outcome'
  readonly attempt: number
  readonly rawAnswer: {
    readonly inline: string
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`)
  }
  return value
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireArm(value: unknown, label: string): RetainedP0ArmV2 {
  if (value !== 'A' && value !== 'B' && value !== 'C') throw new Error(`${label} must be A, B, or C`)
  return value
}

function requireTrial(value: unknown, label: string): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) throw new Error(`${label} must be 1, 2, or 3`)
  return value
}

function validateSource(source: RetainedP0ReAdjudicationV2Source): void {
  if (!Number.isSafeInteger(source.runId) || source.runId < 1) {
    throw new Error('Retained P0 source runId must be a positive safe integer')
  }
  if (!COMMIT_SHA_PATTERN.test(source.headSha)) throw new Error('Retained P0 source headSha must be a 40-character lowercase Git SHA')
  if (!SHA256_PATTERN.test(source.definitionSha256)) throw new Error('Retained P0 source definitionSha256 must be a lowercase SHA-256 digest')
  if (!SHA256_PATTERN.test(source.resultSha256)) throw new Error('Retained P0 source resultSha256 must be a lowercase SHA-256 digest')
  if (source.historicalStatus.length === 0) throw new Error('Retained P0 historicalStatus must be non-empty')
  if (!Number.isSafeInteger(source.scheduledRuns) || source.scheduledRuns < 1) {
    throw new Error('Retained P0 scheduledRuns must be a positive safe integer')
  }
  if (!Number.isSafeInteger(source.modelOutcomes) || source.modelOutcomes < 0) {
    throw new Error('Retained P0 modelOutcomes must be a non-negative safe integer')
  }
  if (source.modelOutcomes > source.scheduledRuns) {
    throw new Error('Retained P0 modelOutcomes cannot exceed scheduledRuns')
  }
}

function modelOutcomeAttempt(value: unknown, label: string): RetainedModelOutcomeAttempt | undefined {
  const record = requireRecord(value, label)
  if (record.outcome !== 'model-outcome') return undefined
  const attempt = requireInteger(record.attempt, `${label}.attempt`, 1)
  const rawAnswer = requireRecord(record.rawAnswer, `${label}.rawAnswer`)
  const inline = requireString(rawAnswer.inline, `${label}.rawAnswer.inline`)
  return Object.freeze({
    outcome: 'model-outcome',
    attempt,
    rawAnswer: Object.freeze({ inline }),
  })
}

function emptyArmSummary(): RetainedP0ReAdjudicationV2ArmSummary {
  return {
    modelOutcomes: 0,
    success: 0,
    failure: 0,
    unknown: 0,
    validClaims: 0,
    invalidClaims: 0,
    unknownClaims: 0,
  }
}

function incrementArmSummary(
  summary: RetainedP0ReAdjudicationV2ArmSummary,
  run: RetainedP0ReAdjudicationV2Run,
): RetainedP0ReAdjudicationV2ArmSummary {
  let validClaims = 0
  let invalidClaims = 0
  let unknownClaims = 0
  for (const claim of run.apiClaims) {
    if (claim.classification === 'VALID') validClaims += 1
    else if (claim.classification === 'INVALID') invalidClaims += 1
    else unknownClaims += 1
  }

  return {
    modelOutcomes: summary.modelOutcomes + 1,
    success: summary.success + (run.taskSuccess === 'SUCCESS' ? 1 : 0),
    failure: summary.failure + (run.taskSuccess === 'FAILURE' ? 1 : 0),
    unknown: summary.unknown + (run.taskSuccess === 'UNKNOWN' ? 1 : 0),
    validClaims: summary.validClaims + validClaims,
    invalidClaims: summary.invalidClaims + invalidClaims,
    unknownClaims: summary.unknownClaims + unknownClaims,
  }
}

function compactClaim(claim: Awaited<ReturnType<typeof adjudicateP0ModelOutcomeV2>>['parsedApiClaims'][number]): RetainedP0ReAdjudicationV2Claim {
  return Object.freeze({
    package: claim.package,
    symbol: claim.symbol,
    assertion: claim.assertion,
    classification: claim.classification,
    resolution: claim.resolution,
  })
}

function bindSourceToRetainedResult(
  source: RetainedP0ReAdjudicationV2Source,
  retainedResult: Record<string, unknown>,
  runs: readonly unknown[],
): void {
  const definitionSha256 = requireString(retainedResult.definitionSha256, 'Retained P0 result.definitionSha256')
  const historicalStatus = requireString(retainedResult.status, 'Retained P0 result.status')
  if (definitionSha256 !== source.definitionSha256) {
    throw new Error('Retained P0 source definition hash does not match retained result')
  }
  if (historicalStatus !== source.historicalStatus) {
    throw new Error('Retained P0 source historical status does not match retained result')
  }
  if (runs.length !== source.scheduledRuns) {
    throw new Error(`Retained P0 scheduled run count mismatch: ${runs.length} != ${source.scheduledRuns}`)
  }
}

async function readjudicatedRuns(
  retainedRuns: readonly unknown[],
  truth: ApiTruthUniverseV2,
): Promise<readonly RetainedP0ReAdjudicationV2Run[]> {
  const result: RetainedP0ReAdjudicationV2Run[] = []

  for (let runIndex = 0; runIndex < retainedRuns.length; runIndex += 1) {
    const record = requireRecord(retainedRuns[runIndex], `Retained P0 runs[${runIndex}]`)
    const taskId = requireString(record.taskId, `Retained P0 runs[${runIndex}].taskId`)
    const arm = requireArm(record.arm, `Retained P0 runs[${runIndex}].arm`)
    const trial = requireTrial(record.trial, `Retained P0 runs[${runIndex}].trial`)
    const attempts = requireArray(record.attempts, `Retained P0 runs[${runIndex}].attempts`)
    const modelOutcomes = attempts
      .map((attempt, attemptIndex) => modelOutcomeAttempt(attempt, `Retained P0 runs[${runIndex}].attempts[${attemptIndex}]`))
      .filter((attempt): attempt is RetainedModelOutcomeAttempt => attempt !== undefined)

    if (modelOutcomes.length === 0) continue
    if (modelOutcomes.length !== 1) {
      throw new Error(`Retained P0 ${taskId}/${arm}/${trial} must contain at most one terminal model outcome`)
    }

    const [modelOutcome] = modelOutcomes
    if (modelOutcome === undefined) continue
    const adjudicated = adjudicateP0ModelOutcomeV2(taskId, modelOutcome.rawAnswer.inline, truth)
    result.push(Object.freeze({
      taskId,
      arm,
      trial,
      attempt: modelOutcome.attempt,
      taskSuccess: adjudicated.taskSuccess,
      apiClaims: Object.freeze(adjudicated.parsedApiClaims.map(compactClaim)),
    }))
  }

  return Object.freeze(result)
}

function summarizeByArm(runs: readonly RetainedP0ReAdjudicationV2Run[]): Readonly<Record<RetainedP0ArmV2, RetainedP0ReAdjudicationV2ArmSummary>> {
  let A = emptyArmSummary()
  let B = emptyArmSummary()
  let C = emptyArmSummary()
  for (const run of runs) {
    if (run.arm === 'A') A = incrementArmSummary(A, run)
    else if (run.arm === 'B') B = incrementArmSummary(B, run)
    else C = incrementArmSummary(C, run)
  }
  return Object.freeze({
    A: Object.freeze(A),
    B: Object.freeze(B),
    C: Object.freeze(C),
  })
}

export async function readjudicateRetainedP0V2(
  input: RetainedP0ReAdjudicationV2Input,
  truth: ApiTruthUniverseV2,
  sha256: Sha256Port,
): Promise<RetainedP0ReAdjudicationV2Report> {
  validateSource(input.source)
  const retainedResult = requireRecord(input.retainedResult, 'Retained P0 result')
  const retainedRuns = requireArray(retainedResult.runs, 'Retained P0 result.runs')
  bindSourceToRetainedResult(input.source, retainedResult, retainedRuns)

  const runs = await readjudicatedRuns(retainedRuns, truth)
  if (runs.length !== input.source.modelOutcomes) {
    throw new Error(`Retained P0 model-outcome count mismatch: ${runs.length} != ${input.source.modelOutcomes}`)
  }

  const projection = Object.freeze({
    schema: REPORT_SCHEMA,
    derived: true as const,
    source: Object.freeze({ ...input.source }),
    adjudicator: ADJUDICATOR_ID,
    truthFingerprint: truth.fingerprint,
    runs,
    byArm: summarizeByArm(runs),
  })
  const reportSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(projection))
  return Object.freeze({ ...projection, reportSha256 })
}
