import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { validateH1TaskSuccessRuleV2 } from './m2-h1-task-adjudication-v2.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const H1_TASK_ID_PATTERN = /^h1-[a-z0-9][a-z0-9-]{0,63}$/u
const H1_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/u

const EXPECTED_TARGET = Object.freeze({
  package: '@deepseek-ai/dsh',
  version: '0.1.1-rc.2',
  profile: 'web',
  targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
  contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
  ordinaryWorkspaceSha256: 'ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413',
})

const EXPECTED_DATASET_TARGET = Object.freeze({
  package: EXPECTED_TARGET.package,
  version: EXPECTED_TARGET.version,
  profile: EXPECTED_TARGET.profile,
  targetFingerprint: EXPECTED_TARGET.targetFingerprint,
  contractIndexFingerprint: EXPECTED_TARGET.contractIndexFingerprint,
})

const EXPECTED_CLASSIFIER = Object.freeze({
  id: 'dsh-toolchain-m2-api-claims-v2',
  sourceCommit: '0bd4387e7da31344d92912670fac2de096cc0c7c',
})

const EXPECTED_TASK_ADJUDICATOR = Object.freeze({
  id: 'dsh-toolchain-m2-h1-task-adjudicator-v2',
  sourceCommit: '8539d8cc173512233c5a04ff9be65a1583c3e9cf',
})

const EXPECTED_PROSPECTIVE_DESIGN = Object.freeze({
  id: 'dsh-toolchain-m2-h1-prospective-design-v2',
  sourceCommit: 'ceec1cb79ec77a6875bda678622ad2a7cdac4fad',
  selectedTaskCount: 96,
})

const EXPECTED_THRESHOLDS = Object.freeze({
  mcidAbsoluteReduction: 0.1,
  taskSuccessNoninferiorityMargin: 0.05,
})

const EXPECTED_HISTORICAL_P0 = Object.freeze({
  runId: 33264398212,
  headSha: 'fee95e4613ffa32210f0800b7e5a9cbd929f0f6d',
  definitionSha256: '240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6',
  resultSha256: 'f22f2e4016ba12fe585971d6bf70106745f0d9b5393ec1bdc1b506ec32ae1d8e',
  historicalStatus: 'INCONCLUSIVE',
  derivedReportSha256: 'aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69',
})

const EXPECTED_ANALYSIS = Object.freeze({
  trialsPerTask: 3,
  primary: {
    metric: 'invalid-api-task-rate',
    comparison: 'C-vs-B',
    trialToTaskAggregation: 'mean-trial-invalid-indicator',
    uncertainty: {
      method: 'paired-task-percentile-bootstrap',
      confidenceLevel: 0.95,
      sidedness: 'two-sided',
      lowerQuantile: 0.025,
      resamples: 10_000,
      seed: 'm2-v2-primary',
      decisionRule: 'lower-bound-at-least-mcid',
    },
  },
  guardrail: {
    metric: 'task-success-noninferiority',
    trialToTaskAggregation: 'mean-trial-success-indicator',
    uncertainty: {
      method: 'paired-task-percentile-bootstrap',
      confidenceLevel: 0.95,
      sidedness: 'two-sided',
      lowerQuantile: 0.025,
      resamples: 10_000,
      seed: 'm2-v2-guardrail',
      decisionRule: 'lower-bound-at-least-negative-margin',
    },
  },
})

const FORBIDDEN_OUTCOME_KEYS = new Set([
  'answer',
  'answers',
  'executedAt',
  'modelOutcome',
  'modelOutcomes',
  'outcome',
  'outcomes',
  'response',
  'result',
  'results',
  'run',
  'runs',
])

export type H1ReadinessBlockerV2 =
  | 'COMMITMENT_NOT_FINALIZED'
  | 'TARGET_IDENTITY_INVALID'
  | 'MEASUREMENT_IDENTITY_INVALID'
  | 'TASK_ADJUDICATOR_NOT_FROZEN'
  | 'PROSPECTIVE_DESIGN_INVALID'
  | 'MCID_NOT_FROZEN'
  | 'NONINFERIORITY_MARGIN_NOT_FROZEN'
  | 'TASK_SET_NOT_COMMITTED'
  | 'PROVIDER_IDENTITY_NOT_FROZEN'
  | 'ANALYSIS_PLAN_INVALID'

export interface H1ComponentIdentityV2 {
  readonly id: string
  readonly sourceCommit: string
}

export interface H1ProviderIdentityV2 {
  readonly provider: string
  readonly baseUrl: string
  readonly requestModel: string
  readonly responseModel: string
  readonly adapterVersion: string
  readonly thinking: 'enabled' | 'disabled'
  readonly reasoningEffort: 'low' | 'high' | 'max'
  readonly identityMode: 'managed-gateway'
  readonly identityReceiptSha256: string | null
}

export interface H1CommitmentV2 {
  readonly schema: 'dsh-toolchain-m2-agent-holdout-commitment-v2'
  readonly version: 'h1-commitment-v2'
  readonly datasetId: 'H1'
  readonly status: 'BLOCKED' | 'COMMITTED'
  readonly target: typeof EXPECTED_TARGET
  readonly measurement: {
    readonly truthFingerprint: string
    readonly apiClaimClassifier: H1ComponentIdentityV2
    readonly taskAdjudicator: H1ComponentIdentityV2 | null
    readonly historicalP0: typeof EXPECTED_HISTORICAL_P0
  }
  readonly prospectiveDesign: typeof EXPECTED_PROSPECTIVE_DESIGN
  readonly thresholds: {
    readonly mcidAbsoluteReduction: number | null
    readonly taskSuccessNoninferiorityMargin: number | null
  }
  readonly hiddenDataset: {
    readonly sha256: string | null
    readonly taskCount: number | null
  }
  readonly provider: H1ProviderIdentityV2 | null
  readonly analysis: typeof EXPECTED_ANALYSIS
}

export interface H1ReadinessV2 {
  readonly status: 'BLOCKED' | 'READY'
  readonly blockers: readonly H1ReadinessBlockerV2[]
  readonly runAllowed: boolean
}

export interface H1DatasetCommitmentV2 {
  readonly sha256: string
  readonly taskCount: number
  readonly modelTasks: readonly {
    readonly id: string
    readonly prompt: string
  }[]
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(record).filter(key => !allowedSet.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function equalCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeEvaluationJson(left) === canonicalizeEvaluationJson(right)
  } catch {
    return false
  }
}

function validateThreshold(
  value: unknown,
  label: 'MCID' | 'task-success non-inferiority margin',
  minimumExclusive: boolean,
): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite numeric rate`)
  }
  const lowerBoundInvalid = minimumExclusive ? value <= 0 : value < 0
  if (lowerBoundInvalid || value > 1) {
    throw new Error(`${label} must be ${minimumExclusive ? '> 0 and ' : ''}within the [0, 1] rate domain`)
  }
  return value
}

function validProviderIdentity(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = [
    'provider',
    'baseUrl',
    'requestModel',
    'responseModel',
    'adapterVersion',
    'thinking',
    'reasoningEffort',
    'identityMode',
    'identityReceiptSha256',
  ] as const
  if (!equalCanonical(Object.keys(record).toSorted(), [...keys].toSorted())) return false
  if (
    record.provider !== 'opencode-go'
    || record.baseUrl !== 'https://opencode.ai/zen/go/v1'
    || record.requestModel !== 'deepseek-v4-flash'
    || record.responseModel !== 'deepseek-v4-flash'
    || record.adapterVersion !== 'opencode-go-deepseek-chat-v1'
    || record.thinking !== 'enabled'
    || record.reasoningEffort !== 'high'
    || record.identityMode !== 'managed-gateway'
  ) {
    return false
  }
  if (typeof record.identityReceiptSha256 !== 'string' || !SHA256_PATTERN.test(record.identityReceiptSha256)) {
    return false
  }
  return true
}

function hiddenDatasetCommitted(value: unknown, expectedTaskCount: number): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.sha256 === 'string'
    && SHA256_PATTERN.test(record.sha256)
    && Number.isInteger(record.taskCount)
    && record.taskCount === expectedTaskCount
}

export function evaluateH1ReadinessV2(value: unknown): H1ReadinessV2 {
  const commitment = requireRecord(value, 'H1 commitment v2')
  if (commitment.schema !== 'dsh-toolchain-m2-agent-holdout-commitment-v2') {
    throw new Error('H1 commitment v2 schema drifted')
  }
  if (commitment.version !== 'h1-commitment-v2' || commitment.datasetId !== 'H1') {
    throw new Error('H1 commitment v2 identity drifted')
  }
  if (commitment.status !== 'BLOCKED' && commitment.status !== 'COMMITTED') {
    throw new Error('H1 commitment v2 status must be BLOCKED or COMMITTED')
  }

  const blockers: H1ReadinessBlockerV2[] = []
  if (commitment.status !== 'COMMITTED') blockers.push('COMMITMENT_NOT_FINALIZED')
  if (!equalCanonical(commitment.target, EXPECTED_TARGET)) blockers.push('TARGET_IDENTITY_INVALID')

  const measurement = requireRecord(commitment.measurement, 'H1 measurement identity')
  const fixedMeasurementValid = measurement.truthFingerprint
      === 'dsh-api-truth-v2:14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb'
    && equalCanonical(measurement.apiClaimClassifier, EXPECTED_CLASSIFIER)
    && equalCanonical(measurement.historicalP0, EXPECTED_HISTORICAL_P0)
  if (!fixedMeasurementValid) blockers.push('MEASUREMENT_IDENTITY_INVALID')
  if (!equalCanonical(measurement.taskAdjudicator, EXPECTED_TASK_ADJUDICATOR)) {
    blockers.push('TASK_ADJUDICATOR_NOT_FROZEN')
  }

  const designIdentityValid = equalCanonical(commitment.prospectiveDesign, EXPECTED_PROSPECTIVE_DESIGN)
  if (!designIdentityValid) blockers.push('PROSPECTIVE_DESIGN_INVALID')

  const thresholds = requireRecord(commitment.thresholds, 'H1 thresholds')
  const mcid = validateThreshold(thresholds.mcidAbsoluteReduction, 'MCID', true)
  const margin = validateThreshold(
    thresholds.taskSuccessNoninferiorityMargin,
    'task-success non-inferiority margin',
    false,
  )
  if (mcid === null) blockers.push('MCID_NOT_FROZEN')
  if (margin === null) blockers.push('NONINFERIORITY_MARGIN_NOT_FROZEN')
  if (mcid !== null && margin !== null && !equalCanonical({
    mcidAbsoluteReduction: mcid,
    taskSuccessNoninferiorityMargin: margin,
  }, EXPECTED_THRESHOLDS) && !blockers.includes('PROSPECTIVE_DESIGN_INVALID')) {
    blockers.push('PROSPECTIVE_DESIGN_INVALID')
  }

  if (!hiddenDatasetCommitted(commitment.hiddenDataset, EXPECTED_PROSPECTIVE_DESIGN.selectedTaskCount)) {
    blockers.push('TASK_SET_NOT_COMMITTED')
  }
  if (!validProviderIdentity(commitment.provider)) blockers.push('PROVIDER_IDENTITY_NOT_FROZEN')
  if (!equalCanonical(commitment.analysis, EXPECTED_ANALYSIS)) blockers.push('ANALYSIS_PLAN_INVALID')

  return Object.freeze({
    status: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers: Object.freeze(blockers),
    runAllowed: blockers.length === 0,
  })
}

function rejectOutcomeMaterial(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectOutcomeMaterial(item, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OUTCOME_KEYS.has(key)) {
      throw new Error(`H1 dataset must not contain result/run/outcome material at ${path}.${key}`)
    }
    rejectOutcomeMaterial(child, `${path}.${key}`)
  }
}

export async function commitHiddenH1DatasetV2(
  value: unknown,
  sha256: Sha256Port,
): Promise<H1DatasetCommitmentV2> {
  const dataset = requireRecord(value, 'H1 hidden dataset')
  rejectOutcomeMaterial(dataset)
  assertExactKeys(dataset, ['schema', 'datasetId', 'target', 'taskCount', 'tasks'], 'H1 hidden dataset')

  if (dataset.schema !== 'dsh-toolchain-m2-agent-dataset-v2' || dataset.datasetId !== 'H1') {
    throw new Error('H1 hidden dataset identity drifted')
  }
  if (!equalCanonical(dataset.target, EXPECTED_DATASET_TARGET)) {
    throw new Error('H1 hidden dataset target identity drifted')
  }
  if (!Array.isArray(dataset.tasks)) throw new Error('H1 hidden dataset tasks must be an array')
  if (!Number.isInteger(dataset.taskCount) || (dataset.taskCount as number) < 1) {
    throw new Error('H1 hidden dataset taskCount must be a positive integer')
  }
  if (dataset.taskCount !== dataset.tasks.length) {
    throw new Error('H1 hidden dataset taskCount must equal tasks.length')
  }

  const seen = new Set<string>()
  const normalizedTasks = dataset.tasks.map((taskValue, index) => {
    const task = requireRecord(taskValue, `H1 task[${index}]`)
    assertExactKeys(task, ['id', 'domain', 'prompt', 'successRule'], `H1 task[${index}]`)

    const id = requireString(task.id, `H1 task[${index}].id`)
    if (!H1_TASK_ID_PATTERN.test(id)) {
      throw new Error(`H1 task id ${id} must use stable h1-* form`)
    }
    if (seen.has(id)) throw new Error(`H1 task ids must be unique: ${id}`)
    seen.add(id)

    const domain = requireString(task.domain, `H1 task ${id} domain`)
    if (!H1_DOMAIN_PATTERN.test(domain)) {
      throw new Error(`H1 task ${id} domain must use a stable lowercase identifier`)
    }

    const prompt = requireString(task.prompt, `H1 task ${id} prompt`)
    const successRule = validateH1TaskSuccessRuleV2(task.successRule)
    return Object.freeze({ id, domain, prompt, successRule })
  })

  const normalizedDataset = Object.freeze({
    schema: 'dsh-toolchain-m2-agent-dataset-v2' as const,
    datasetId: 'H1' as const,
    target: EXPECTED_DATASET_TARGET,
    taskCount: normalizedTasks.length,
    tasks: Object.freeze(normalizedTasks),
  })
  const canonicalDataset = canonicalizeEvaluationJson(normalizedDataset)
  const digest = await sha256.sha256Utf8(canonicalDataset)
  if (!SHA256_PATTERN.test(digest)) throw new Error('SHA-256 port returned a malformed H1 dataset digest')

  return Object.freeze({
    sha256: digest,
    taskCount: normalizedTasks.length,
    modelTasks: Object.freeze(normalizedTasks.map(task => Object.freeze({ id: task.id, prompt: task.prompt }))),
  })
}
