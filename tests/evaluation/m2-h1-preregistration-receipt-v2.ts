import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  hashEvaluationDefinition,
  validateBalancedAgentSchedule,
} from './m2-agent-eval-integrity.js'
import {
  validateCapabilityManifests,
  validateContentRef,
  type ContentRef,
} from './m2-agent-execution-evidence.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  evaluateH1ReadinessV2,
  type H1ProviderIdentityV2,
} from './m2-h1-readiness-v2.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const TARGET_FINGERPRINT_PATTERN = /^dsh-target-v2:[0-9a-f]{64}$/u
const CONTRACT_INDEX_FINGERPRINT_PATTERN = /^dsh-contract-index-v1:[0-9a-f]{64}$/u
const SYSTEM_FINGERPRINT_PATTERN = /^[\x21-\x7e]{1,256}$/u
const EXPECTED_TASK_COUNT = 96
const EXPECTED_SCHEDULE_COUNT = 864
const EXPECTED_SCHEDULE_SEED = 'm2-h1-holdout-v2'
const EXPECTED_TRIALS = 3
const EXPECTED_CONCURRENCY = 1
const EXPECTED_TARGET = Object.freeze({
  package: '@deepseek-ai/dsh',
  version: '0.1.1-rc.2',
  profile: 'web',
  targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
  contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
  ordinaryWorkspaceSha256: 'ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413',
})
const EXPECTED_STATIC_DOCS_SHA256 = '9325818edcb90fd4ea8d870c6dad3c438cdbc9b72c744d4807b76c2aacc1cacf'
const EXPECTED_MEASUREMENT = Object.freeze({
  truthFingerprint: 'dsh-api-truth-v2:14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb',
  apiClaimClassifier: {
    id: 'dsh-toolchain-m2-api-claims-v2',
    sourceCommit: '0bd4387e7da31344d92912670fac2de096cc0c7c',
  },
  taskAdjudicator: {
    id: 'dsh-toolchain-m2-h1-task-adjudicator-v2',
    sourceCommit: '8539d8cc173512233c5a04ff9be65a1583c3e9cf',
  },
  historicalP0: {
    runId: 33264398212,
    headSha: 'fee95e4613ffa32210f0800b7e5a9cbd929f0f6d',
    definitionSha256: '240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6',
    resultSha256: 'f22f2e4016ba12fe585971d6bf70106745f0d9b5393ec1bdc1b506ec32ae1d8e',
    historicalStatus: 'INCONCLUSIVE',
    derivedReportSha256: 'aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69',
  },
})
const EXPECTED_PROSPECTIVE_DESIGN = Object.freeze({
  id: 'dsh-toolchain-m2-h1-prospective-design-v2',
  sourceCommit: 'ceec1cb79ec77a6875bda678622ad2a7cdac4fad',
  selectedTaskCount: EXPECTED_TASK_COUNT,
})
const EXPECTED_THRESHOLDS = Object.freeze({
  mcidAbsoluteReduction: 0.1,
  taskSuccessNoninferiorityMargin: 0.05,
})
const EXPECTED_ANALYSIS = Object.freeze({
  trialsPerTask: EXPECTED_TRIALS,
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
const EXPECTED_DISCLOSURE = Object.freeze({
  hiddenTaskBytes: 'withheld-until-terminal-h1',
  credentials: 'never-recorded',
  outcomeMaterial: 'absent-pre-run',
})
const TOP_LEVEL_KEYS = Object.freeze([
  'schema',
  'version',
  'status',
  'evaluationId',
  'target',
  'finalizedCommitmentSha256',
  'measurement',
  'prospectiveDesign',
  'thresholds',
  'analysis',
  'hiddenDataset',
  'provider',
  'execution',
  'disclosure',
  'receiptSha256',
])
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'tasks',
  'prompt',
  'domain',
  'successrule',
  'answer',
  'answers',
  'rawanswer',
  'rawanswers',
  'modeloutcome',
  'modeloutcomes',
  'outcome',
  'outcomes',
  'apikey',
  'api_key',
  'authorization',
  'accesstoken',
  'access_token',
  'secret',
  'password',
])

export interface H1PreregistrationReceiptV2 {
  readonly schema: 'dsh-toolchain-m2-h1-preregistration-receipt-v2'
  readonly version: 'h1-preregistration-receipt-v2'
  readonly status: 'PREREGISTERED'
  readonly evaluationId: 'm2-agent-h1-v2'
  readonly target: {
    readonly package: string
    readonly version: string
    readonly profile: string
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly ordinaryWorkspaceSha256: string
  }
  readonly finalizedCommitmentSha256: string
  readonly measurement: Record<string, unknown>
  readonly prospectiveDesign: Record<string, unknown>
  readonly thresholds: Record<string, unknown>
  readonly analysis: Record<string, unknown>
  readonly hiddenDataset: {
    readonly sha256: string
    readonly taskCount: number
    readonly modelTaskProjectionSha256: string
  }
  readonly provider: H1ProviderIdentityV2 & {
    readonly backendFingerprint: string
    readonly identityReceiptSha256: string
  }
  readonly execution: {
    readonly definitionSha256: string
    readonly scheduleCount: number
    readonly scheduleSeed: string
    readonly trialsPerTaskArm: number
    readonly concurrency: number
    readonly harness: {
      readonly systemPromptSha256: string
      readonly taskPromptSha256: string
      readonly toolSchemaSha256: string
      readonly staticDocsSha256: string
      readonly networkPolicy: 'provider-only'
    }
    readonly contentRefs: {
      readonly runnerIdentitySha256: string
      readonly executorIdentitySha256: string
      readonly capabilityManifestSha256: {
        readonly A: string
        readonly B: string
        readonly C: string
      }
      readonly resourcePolicySha256: string
      readonly retryPolicySha256: string
    }
    readonly ledgerBinding: H1LedgerBindingV2
  }
  readonly disclosure: {
    readonly hiddenTaskBytes: 'withheld-until-terminal-h1'
    readonly credentials: 'never-recorded'
    readonly outcomeMaterial: 'absent-pre-run'
  }
  readonly receiptSha256: string
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireInteger(value: unknown, label: string, expected?: number): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number') {
    throw new Error(`${label} must be a safe integer`)
  }
  if (expected !== undefined && value !== expected) {
    throw new Error(`${label} must equal ${expected}`)
  }
  return value
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label)
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return digest
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys)
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  const missing = keys.filter(key => !(key in record))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
  if (missing.length > 0) throw new Error(`${label} is missing required key(s): ${missing.join(', ')}`)
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeEvaluationJson(left) === canonicalizeEvaluationJson(right)
}

function assertCanonicalEqual(left: unknown, right: unknown, label: string): void {
  if (!canonicalEqual(left, right)) throw new Error(`${label} drifted from the frozen H1 identity`)
}

function assertFinalizationReady(finalization: H1FinalizationResultV2): void {
  if (
    finalization.readiness.status !== 'READY'
    || !finalization.readiness.runAllowed
    || finalization.readiness.blockers.length !== 0
  ) {
    throw new Error('H1 preregistration receipt requires a READY finalization result')
  }
  const recomputed = evaluateH1ReadinessV2(finalization.commitment)
  if (recomputed.status !== 'READY' || !recomputed.runAllowed || recomputed.blockers.length !== 0) {
    throw new Error('H1 preregistration receipt finalization no longer satisfies readiness')
  }
  if (finalization.commitment.status !== 'COMMITTED') {
    throw new Error('H1 preregistration receipt requires a COMMITTED finalization')
  }
  if (
    finalization.commitment.hiddenDataset.taskCount !== EXPECTED_TASK_COUNT
    || finalization.modelTasks.length !== EXPECTED_TASK_COUNT
    || finalization.construction.taskCount !== EXPECTED_TASK_COUNT
  ) {
    throw new Error('H1 preregistration receipt requires the exact finalized 96-task holdout')
  }
  assertCanonicalEqual(finalization.commitment.target, EXPECTED_TARGET, 'H1 preregistration target')
  assertCanonicalEqual(finalization.commitment.measurement, EXPECTED_MEASUREMENT, 'H1 preregistration measurement')
  assertCanonicalEqual(finalization.commitment.prospectiveDesign, EXPECTED_PROSPECTIVE_DESIGN, 'H1 preregistration prospective design')
  assertCanonicalEqual(finalization.commitment.thresholds, EXPECTED_THRESHOLDS, 'H1 preregistration thresholds')
  assertCanonicalEqual(finalization.commitment.analysis, EXPECTED_ANALYSIS, 'H1 preregistration analysis')
}

async function validateModelTasks(finalization: H1FinalizationResultV2, sha256: Sha256Port): Promise<void> {
  const seen = new Set<string>()
  for (const task of finalization.modelTasks) {
    if (!canonicalEqual(Object.keys(task), ['id', 'prompt'])) {
      throw new Error('H1 preregistration model task projection may contain only id and prompt')
    }
    if (task.id.trim().length === 0 || task.prompt.trim().length === 0 || seen.has(task.id)) {
      throw new Error('H1 preregistration model task projection is malformed')
    }
    seen.add(task.id)
  }
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalization.modelTasks))
  if (digest !== finalization.commitment.hiddenDataset.modelTaskProjectionSha256) {
    throw new Error('H1 preregistration model task projection hash drifted from commitment')
  }
}

function requireContentRef(value: unknown, label: string): ContentRef {
  const record = requireRecord(value, label)
  assertExactKeys(record, ['sha256', 'mediaType', 'canonicalization', 'byteLength', 'inline'], label)
  return record as unknown as ContentRef
}

async function parseCanonicalContentRef(value: unknown, label: string, sha256: Sha256Port): Promise<{
  readonly ref: ContentRef
  readonly parsed: Record<string, unknown>
}> {
  const ref = requireContentRef(value, label)
  await validateContentRef(ref, sha256)
  if (ref.mediaType !== 'application/json' || ref.canonicalization !== 'utf8-bytes-v1') {
    throw new Error(`${label} must be canonical JSON evidence`)
  }
  let parsed: Record<string, unknown>
  try {
    parsed = requireRecord(JSON.parse(ref.inline), `${label} retained JSON`)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} retained bytes are not JSON`, { cause: error })
    throw error
  }
  if (ref.inline !== canonicalizeEvaluationJson(parsed)) {
    throw new Error(`${label} retained JSON is not canonical`)
  }
  return { ref, parsed }
}

function expectedLedgerBinding(
  definitionSha256: string,
  finalization: H1FinalizationResultV2,
): H1LedgerBindingV2 {
  const provider = finalization.commitment.provider
  if (provider?.identityReceiptSha256 === null || provider?.identityReceiptSha256 === undefined) {
    throw new Error('H1 preregistration requires a provider identity receipt SHA')
  }
  if (provider.backendFingerprint === null) {
    throw new Error('H1 preregistration requires a strong provider backend fingerprint')
  }
  return {
    definitionSha256,
    datasetCommitmentSha256: finalization.commitment.hiddenDataset.sha256,
    providerIdentityReceiptSha256: provider.identityReceiptSha256,
    expectedResponseModel: provider.responseModel,
    expectedBackendFingerprint: provider.backendFingerprint,
  }
}

async function assertFrozenDefinition(
  finalization: H1FinalizationResultV2,
  frozen: FrozenH1ExecutionDefinitionV2,
  sha256: Sha256Port,
): Promise<{
  readonly definition: Record<string, unknown>
  readonly harness: Record<string, unknown>
  readonly execution: Record<string, unknown>
  readonly refs: {
    readonly runnerIdentity: ContentRef
    readonly executorIdentity: ContentRef
    readonly A: ContentRef
    readonly B: ContentRef
    readonly C: ContentRef
    readonly resourcePolicy: ContentRef
    readonly retryPolicy: ContentRef
  }
}> {
  const definitionSha256 = await hashEvaluationDefinition(frozen.definition, sha256)
  if (definitionSha256 !== frozen.definitionSha256) {
    throw new Error('H1 preregistration execution definition hash drifted')
  }
  const definition = requireRecord(frozen.definition, 'H1 preregistration execution definition')
  if (
    definition.schema !== 'dsh-toolchain-m2-agent-eval-v2'
    || definition.recordType !== 'definition'
    || definition.evaluationId !== 'm2-agent-h1-v2'
    || definition.phase !== 'H1'
    || definition.status !== 'PREREGISTERED'
  ) {
    throw new Error('H1 preregistration execution definition identity drifted')
  }

  if (!canonicalEqual(frozen.modelTasks, finalization.modelTasks)) {
    throw new Error('H1 preregistration frozen model task projection drifted from finalization')
  }
  const taskIds = frozen.modelTasks.map(task => task.id)
  validateBalancedAgentSchedule(frozen.schedule, taskIds)
  if (frozen.schedule.length !== EXPECTED_SCHEDULE_COUNT) {
    throw new Error(`H1 preregistration schedule must contain exactly ${EXPECTED_SCHEDULE_COUNT} entries`)
  }

  const target = requireRecord(definition.target, 'H1 preregistration definition target')
  assertCanonicalEqual(target, {
    package: EXPECTED_TARGET.package,
    version: EXPECTED_TARGET.version,
    profile: EXPECTED_TARGET.profile,
    targetFingerprint: EXPECTED_TARGET.targetFingerprint,
    contractIndexFingerprint: EXPECTED_TARGET.contractIndexFingerprint,
  }, 'H1 preregistration definition target')

  const dataset = requireRecord(definition.dataset, 'H1 preregistration definition dataset')
  if (
    dataset.id !== 'H1'
    || dataset.taskCount !== EXPECTED_TASK_COUNT
    || dataset.commitmentSha256 !== finalization.commitment.hiddenDataset.sha256
    || dataset.hiddenUntilRunComplete !== true
  ) {
    throw new Error('H1 preregistration definition dataset binding drifted')
  }

  const runOrder = requireRecord(definition.runOrder, 'H1 preregistration definition runOrder')
  if (runOrder.seed !== EXPECTED_SCHEDULE_SEED || runOrder.trialsPerTaskArm !== EXPECTED_TRIALS) {
    throw new Error('H1 preregistration schedule seed/trial contract drifted')
  }
  if (!canonicalEqual(runOrder.schedule, frozen.schedule)) {
    throw new Error('H1 preregistration frozen schedule drifted from the exact definition')
  }

  const resources = requireRecord(definition.resources, 'H1 preregistration definition resources')
  requireInteger(resources.concurrency, 'H1 preregistration definition concurrency', EXPECTED_CONCURRENCY)
  requireInteger(frozen.resourcePolicy.concurrency, 'H1 preregistration frozen concurrency', EXPECTED_CONCURRENCY)

  const harness = requireRecord(definition.harness, 'H1 preregistration definition harness')
  assertExactKeys(harness, [
    'runner',
    'version',
    'systemPromptSha256',
    'taskPromptSha256',
    'toolSchemaSha256',
    'staticDocsSha256',
    'networkPolicy',
  ], 'H1 preregistration definition harness')
  if (
    harness.runner !== 'dsh-m2-isolated-runner'
    || harness.version !== '2'
    || harness.networkPolicy !== 'provider-only'
    || harness.staticDocsSha256 !== EXPECTED_STATIC_DOCS_SHA256
    || harness.taskPromptSha256 !== finalization.commitment.hiddenDataset.modelTaskProjectionSha256
  ) {
    throw new Error('H1 preregistration harness identity drifted')
  }
  for (const field of ['systemPromptSha256', 'taskPromptSha256', 'toolSchemaSha256', 'staticDocsSha256'] as const) {
    requireSha256(harness[field], `H1 preregistration harness ${field}`)
  }

  const execution = requireRecord(definition.execution, 'H1 preregistration definition execution')
  const manifests = requireRecord(execution.capabilityManifests, 'H1 preregistration capability ContentRefs')
  const [runnerIdentity, executorIdentity, A, B, C, resourcePolicy, retryPolicy] = await Promise.all([
    parseCanonicalContentRef(execution.runnerIdentity, 'H1 preregistration runner ContentRef', sha256),
    parseCanonicalContentRef(execution.executorIdentity, 'H1 preregistration executor ContentRef', sha256),
    parseCanonicalContentRef(manifests.A, 'H1 preregistration arm A ContentRef', sha256),
    parseCanonicalContentRef(manifests.B, 'H1 preregistration arm B ContentRef', sha256),
    parseCanonicalContentRef(manifests.C, 'H1 preregistration arm C ContentRef', sha256),
    parseCanonicalContentRef(execution.resourcePolicy, 'H1 preregistration resource-policy ContentRef', sha256),
    parseCanonicalContentRef(execution.retryPolicy, 'H1 preregistration retry-policy ContentRef', sha256),
  ])

  assertCanonicalEqual(A.parsed, frozen.capabilityManifests.A, 'H1 preregistration arm A capability')
  assertCanonicalEqual(B.parsed, frozen.capabilityManifests.B, 'H1 preregistration arm B capability')
  assertCanonicalEqual(C.parsed, frozen.capabilityManifests.C, 'H1 preregistration arm C capability')
  validateCapabilityManifests(frozen.capabilityManifests)
  assertCanonicalEqual(resourcePolicy.parsed, frozen.resourcePolicy, 'H1 preregistration resource policy')
  assertCanonicalEqual(retryPolicy.parsed, frozen.retryPolicy, 'H1 preregistration retry policy')

  const commitmentSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalization.commitment))
  const provider = finalization.commitment.provider
  if (provider === null || provider.backendFingerprint === null || provider.identityReceiptSha256 === null) {
    throw new Error('H1 preregistration requires a finalized strong provider identity')
  }
  assertExactKeys(runnerIdentity.parsed, [
    'runner',
    'version',
    'executorProtocol',
    'scheduleSeed',
    'h1CommitmentSha256',
    'datasetCommitmentSha256',
    'modelTaskProjectionSha256',
    'providerIdentityReceiptSha256',
    'measurement',
    'prospectiveDesign',
    'thresholds',
    'analysis',
  ], 'H1 preregistration runner identity')
  if (
    runnerIdentity.parsed.runner !== 'dsh-m2-isolated-runner'
    || runnerIdentity.parsed.version !== '2'
    || runnerIdentity.parsed.executorProtocol !== 'closed-ndjson-v1'
    || runnerIdentity.parsed.scheduleSeed !== EXPECTED_SCHEDULE_SEED
    || runnerIdentity.parsed.h1CommitmentSha256 !== commitmentSha256
    || runnerIdentity.parsed.datasetCommitmentSha256 !== finalization.commitment.hiddenDataset.sha256
    || runnerIdentity.parsed.modelTaskProjectionSha256 !== finalization.commitment.hiddenDataset.modelTaskProjectionSha256
    || runnerIdentity.parsed.providerIdentityReceiptSha256 !== provider.identityReceiptSha256
  ) {
    throw new Error('H1 preregistration runner identity binding drifted')
  }
  assertCanonicalEqual(runnerIdentity.parsed.measurement, finalization.commitment.measurement, 'H1 preregistration runner measurement')
  assertCanonicalEqual(runnerIdentity.parsed.prospectiveDesign, finalization.commitment.prospectiveDesign, 'H1 preregistration runner design')
  assertCanonicalEqual(runnerIdentity.parsed.thresholds, finalization.commitment.thresholds, 'H1 preregistration runner thresholds')
  assertCanonicalEqual(runnerIdentity.parsed.analysis, finalization.commitment.analysis, 'H1 preregistration runner analysis')

  const expectedExecutor = {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    requestModel: provider.requestModel,
    expectedResponseModel: provider.responseModel,
    adapterVersion: provider.adapterVersion,
    thinking: provider.thinking,
    reasoningEffort: provider.reasoningEffort,
    backendIdentityStrength: provider.backendIdentityStrength,
    expectedSystemFingerprint: provider.backendFingerprint,
    providerIdentityReceiptSha256: provider.identityReceiptSha256,
  }
  assertCanonicalEqual(executorIdentity.parsed, expectedExecutor, 'H1 preregistration executor identity')

  const ledger = expectedLedgerBinding(frozen.definitionSha256, finalization)
  assertCanonicalEqual(frozen.ledgerBinding, ledger, 'H1 preregistration ledger binding')

  return {
    definition,
    harness,
    execution,
    refs: {
      runnerIdentity: runnerIdentity.ref,
      executorIdentity: executorIdentity.ref,
      A: A.ref,
      B: B.ref,
      C: C.ref,
      resourcePolicy: resourcePolicy.ref,
      retryPolicy: retryPolicy.ref,
    },
  }
}

function assertPublicSafe(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicSafe(item, `${path}[${index}]`))
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key.toLowerCase())) {
      throw new Error(`H1 preregistration receipt contains forbidden private/outcome key at ${path}.${key}`)
    }
    assertPublicSafe(child, `${path}.${key}`)
  }
}

function assertNoSecretLikeText(value: unknown): void {
  const text = canonicalizeEvaluationJson(value)
  if (/Bearer\s+/iu.test(text) || /"sk-[A-Za-z0-9_-]{8,}"/u.test(text)) {
    throw new Error('H1 preregistration receipt contains credential-like material')
  }
}

function providerProjection(provider: H1ProviderIdentityV2 | null): H1PreregistrationReceiptV2['provider'] {
  if (provider === null || provider.backendFingerprint === null || provider.identityReceiptSha256 === null) {
    throw new Error('H1 preregistration requires a strong finalized provider identity')
  }
  return Object.freeze({ ...provider, backendFingerprint: provider.backendFingerprint, identityReceiptSha256: provider.identityReceiptSha256 })
}

function receiptProjection(receipt: Omit<H1PreregistrationReceiptV2, 'receiptSha256'>): unknown {
  return receipt
}

export async function createH1PreregistrationReceiptV2(
  finalization: H1FinalizationResultV2,
  frozen: FrozenH1ExecutionDefinitionV2,
  sha256: Sha256Port,
): Promise<H1PreregistrationReceiptV2> {
  assertFinalizationReady(finalization)
  await validateModelTasks(finalization, sha256)
  const validated = await assertFrozenDefinition(finalization, frozen, sha256)
  const finalizedCommitmentSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalization.commitment))
  requireSha256(finalizedCommitmentSha256, 'H1 preregistration finalized commitment SHA')
  const harness = validated.harness
  const receiptWithoutHash = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-preregistration-receipt-v2' as const,
    version: 'h1-preregistration-receipt-v2' as const,
    status: 'PREREGISTERED' as const,
    evaluationId: 'm2-agent-h1-v2' as const,
    target: Object.freeze({ ...EXPECTED_TARGET }),
    finalizedCommitmentSha256,
    measurement: structuredClone(finalization.commitment.measurement) as unknown as Record<string, unknown>,
    prospectiveDesign: structuredClone(finalization.commitment.prospectiveDesign) as unknown as Record<string, unknown>,
    thresholds: structuredClone(finalization.commitment.thresholds) as unknown as Record<string, unknown>,
    analysis: structuredClone(finalization.commitment.analysis) as unknown as Record<string, unknown>,
    hiddenDataset: Object.freeze({
      sha256: finalization.commitment.hiddenDataset.sha256,
      taskCount: EXPECTED_TASK_COUNT,
      modelTaskProjectionSha256: finalization.commitment.hiddenDataset.modelTaskProjectionSha256,
    }),
    provider: providerProjection(finalization.commitment.provider),
    execution: Object.freeze({
      definitionSha256: frozen.definitionSha256,
      scheduleCount: EXPECTED_SCHEDULE_COUNT,
      scheduleSeed: EXPECTED_SCHEDULE_SEED,
      trialsPerTaskArm: EXPECTED_TRIALS,
      concurrency: EXPECTED_CONCURRENCY,
      harness: Object.freeze({
        systemPromptSha256: requireSha256(harness.systemPromptSha256, 'H1 preregistration system prompt SHA'),
        taskPromptSha256: requireSha256(harness.taskPromptSha256, 'H1 preregistration task prompt SHA'),
        toolSchemaSha256: requireSha256(harness.toolSchemaSha256, 'H1 preregistration tool schema SHA'),
        staticDocsSha256: requireSha256(harness.staticDocsSha256, 'H1 preregistration static docs SHA'),
        networkPolicy: 'provider-only' as const,
      }),
      contentRefs: Object.freeze({
        runnerIdentitySha256: validated.refs.runnerIdentity.sha256,
        executorIdentitySha256: validated.refs.executorIdentity.sha256,
        capabilityManifestSha256: Object.freeze({
          A: validated.refs.A.sha256,
          B: validated.refs.B.sha256,
          C: validated.refs.C.sha256,
        }),
        resourcePolicySha256: validated.refs.resourcePolicy.sha256,
        retryPolicySha256: validated.refs.retryPolicy.sha256,
      }),
      ledgerBinding: Object.freeze({ ...frozen.ledgerBinding }),
    }),
    disclosure: EXPECTED_DISCLOSURE,
  }) satisfies Omit<H1PreregistrationReceiptV2, 'receiptSha256'>

  assertPublicSafe(receiptWithoutHash)
  assertNoSecretLikeText(receiptWithoutHash)
  const receiptSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(receiptProjection(receiptWithoutHash)))
  requireSha256(receiptSha256, 'H1 preregistration receipt SHA')
  const receipt: H1PreregistrationReceiptV2 = Object.freeze({ ...receiptWithoutHash, receiptSha256 })
  return validateH1PreregistrationReceiptV2(receipt, sha256)
}

function validateTarget(record: Record<string, unknown>): void {
  assertExactKeys(record, ['package', 'version', 'profile', 'targetFingerprint', 'contractIndexFingerprint', 'ordinaryWorkspaceSha256'], 'H1 preregistration target')
  if (!TARGET_FINGERPRINT_PATTERN.test(requireString(record.targetFingerprint, 'H1 preregistration target fingerprint'))) {
    throw new Error('H1 preregistration target fingerprint format is invalid')
  }
  if (!CONTRACT_INDEX_FINGERPRINT_PATTERN.test(requireString(record.contractIndexFingerprint, 'H1 preregistration Contract Index fingerprint'))) {
    throw new Error('H1 preregistration Contract Index fingerprint format is invalid')
  }
  requireSha256(record.ordinaryWorkspaceSha256, 'H1 preregistration ordinary workspace SHA')
  assertCanonicalEqual(record, EXPECTED_TARGET, 'H1 preregistration target')
}

function validateProvider(record: Record<string, unknown>): void {
  assertExactKeys(record, [
    'provider', 'baseUrl', 'requestModel', 'responseModel', 'adapterVersion', 'thinking', 'reasoningEffort',
    'backendIdentityStrength', 'backendFingerprint', 'identityReceiptSha256',
  ], 'H1 preregistration provider')
  if (
    record.provider !== 'opencode-go'
    || record.baseUrl !== 'https://opencode.ai/zen/go/v1'
    || record.requestModel !== 'deepseek-v4-flash'
    || record.responseModel !== 'deepseek-v4-flash'
    || record.adapterVersion !== 'opencode-go-deepseek-chat-v1'
    || record.thinking !== 'enabled'
    || record.reasoningEffort !== 'high'
    || record.backendIdentityStrength !== 'system-fingerprint'
  ) {
    throw new Error('H1 preregistration provider identity drifted')
  }
  const fingerprint = requireString(record.backendFingerprint, 'H1 preregistration backend fingerprint')
  if (!SYSTEM_FINGERPRINT_PATTERN.test(fingerprint)) throw new Error('H1 preregistration backend fingerprint is malformed')
  requireSha256(record.identityReceiptSha256, 'H1 preregistration provider receipt SHA')
  const url = new URL(requireString(record.baseUrl, 'H1 preregistration provider base URL'))
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('H1 preregistration provider base URL is unsafe')
  }
}

function validateExecution(record: Record<string, unknown>, hiddenDataset: Record<string, unknown>, provider: Record<string, unknown>): void {
  assertExactKeys(record, [
    'definitionSha256', 'scheduleCount', 'scheduleSeed', 'trialsPerTaskArm', 'concurrency', 'harness', 'contentRefs', 'ledgerBinding',
  ], 'H1 preregistration execution')
  const definitionSha256 = requireSha256(record.definitionSha256, 'H1 preregistration definition SHA')
  requireInteger(record.scheduleCount, 'H1 preregistration schedule count', EXPECTED_SCHEDULE_COUNT)
  if (record.scheduleSeed !== EXPECTED_SCHEDULE_SEED) throw new Error('H1 preregistration schedule seed drifted')
  requireInteger(record.trialsPerTaskArm, 'H1 preregistration trials per task/arm', EXPECTED_TRIALS)
  requireInteger(record.concurrency, 'H1 preregistration concurrency', EXPECTED_CONCURRENCY)

  const harness = requireRecord(record.harness, 'H1 preregistration harness')
  assertExactKeys(harness, ['systemPromptSha256', 'taskPromptSha256', 'toolSchemaSha256', 'staticDocsSha256', 'networkPolicy'], 'H1 preregistration harness')
  for (const field of ['systemPromptSha256', 'taskPromptSha256', 'toolSchemaSha256', 'staticDocsSha256'] as const) {
    requireSha256(harness[field], `H1 preregistration harness ${field}`)
  }
  if (harness.staticDocsSha256 !== EXPECTED_STATIC_DOCS_SHA256 || harness.networkPolicy !== 'provider-only') {
    throw new Error('H1 preregistration harness public identity drifted')
  }
  if (harness.taskPromptSha256 !== hiddenDataset.modelTaskProjectionSha256) {
    throw new Error('H1 preregistration task-prompt hash does not match hidden dataset projection')
  }

  const refs = requireRecord(record.contentRefs, 'H1 preregistration execution ContentRef SHAs')
  assertExactKeys(refs, ['runnerIdentitySha256', 'executorIdentitySha256', 'capabilityManifestSha256', 'resourcePolicySha256', 'retryPolicySha256'], 'H1 preregistration execution ContentRef SHAs')
  requireSha256(refs.runnerIdentitySha256, 'H1 preregistration runner ContentRef SHA')
  requireSha256(refs.executorIdentitySha256, 'H1 preregistration executor ContentRef SHA')
  requireSha256(refs.resourcePolicySha256, 'H1 preregistration resource-policy ContentRef SHA')
  requireSha256(refs.retryPolicySha256, 'H1 preregistration retry-policy ContentRef SHA')
  const manifests = requireRecord(refs.capabilityManifestSha256, 'H1 preregistration capability ContentRef SHAs')
  assertExactKeys(manifests, ['A', 'B', 'C'], 'H1 preregistration capability ContentRef SHAs')
  requireSha256(manifests.A, 'H1 preregistration arm A ContentRef SHA')
  requireSha256(manifests.B, 'H1 preregistration arm B ContentRef SHA')
  requireSha256(manifests.C, 'H1 preregistration arm C ContentRef SHA')

  const ledger = requireRecord(record.ledgerBinding, 'H1 preregistration ledger binding')
  assertExactKeys(ledger, [
    'definitionSha256', 'datasetCommitmentSha256', 'providerIdentityReceiptSha256', 'expectedResponseModel', 'expectedBackendFingerprint',
  ], 'H1 preregistration ledger binding')
  if (
    requireSha256(ledger.definitionSha256, 'H1 preregistration ledger definition SHA') !== definitionSha256
    || requireSha256(ledger.datasetCommitmentSha256, 'H1 preregistration ledger dataset SHA') !== hiddenDataset.sha256
    || requireSha256(ledger.providerIdentityReceiptSha256, 'H1 preregistration ledger provider receipt SHA') !== provider.identityReceiptSha256
    || ledger.expectedResponseModel !== provider.responseModel
    || ledger.expectedBackendFingerprint !== provider.backendFingerprint
  ) {
    throw new Error('H1 preregistration ledger binding is internally inconsistent')
  }
}

export async function validateH1PreregistrationReceiptV2(
  value: unknown,
  sha256: Sha256Port,
): Promise<H1PreregistrationReceiptV2> {
  const receipt = requireRecord(value, 'H1 preregistration receipt')
  assertExactKeys(receipt, TOP_LEVEL_KEYS, 'H1 preregistration receipt')
  if (
    receipt.schema !== 'dsh-toolchain-m2-h1-preregistration-receipt-v2'
    || receipt.version !== 'h1-preregistration-receipt-v2'
    || receipt.status !== 'PREREGISTERED'
    || receipt.evaluationId !== 'm2-agent-h1-v2'
  ) {
    throw new Error('H1 preregistration receipt identity drifted')
  }
  requireSha256(receipt.finalizedCommitmentSha256, 'H1 preregistration finalized commitment SHA')

  const target = requireRecord(receipt.target, 'H1 preregistration target')
  validateTarget(target)
  const measurement = requireRecord(receipt.measurement, 'H1 preregistration measurement')
  assertCanonicalEqual(measurement, EXPECTED_MEASUREMENT, 'H1 preregistration measurement')
  const design = requireRecord(receipt.prospectiveDesign, 'H1 preregistration prospective design')
  assertCanonicalEqual(design, EXPECTED_PROSPECTIVE_DESIGN, 'H1 preregistration prospective design')
  const thresholds = requireRecord(receipt.thresholds, 'H1 preregistration thresholds')
  assertCanonicalEqual(thresholds, EXPECTED_THRESHOLDS, 'H1 preregistration thresholds')
  const analysis = requireRecord(receipt.analysis, 'H1 preregistration analysis')
  assertCanonicalEqual(analysis, EXPECTED_ANALYSIS, 'H1 preregistration analysis')

  const hiddenDataset = requireRecord(receipt.hiddenDataset, 'H1 preregistration hidden dataset')
  assertExactKeys(hiddenDataset, ['sha256', 'taskCount', 'modelTaskProjectionSha256'], 'H1 preregistration hidden dataset')
  requireSha256(hiddenDataset.sha256, 'H1 preregistration hidden dataset SHA')
  requireInteger(hiddenDataset.taskCount, 'H1 preregistration hidden dataset task count', EXPECTED_TASK_COUNT)
  requireSha256(hiddenDataset.modelTaskProjectionSha256, 'H1 preregistration model-task projection SHA')

  const provider = requireRecord(receipt.provider, 'H1 preregistration provider')
  validateProvider(provider)
  const execution = requireRecord(receipt.execution, 'H1 preregistration execution')
  validateExecution(execution, hiddenDataset, provider)
  const disclosure = requireRecord(receipt.disclosure, 'H1 preregistration disclosure')
  assertExactKeys(disclosure, ['hiddenTaskBytes', 'credentials', 'outcomeMaterial'], 'H1 preregistration disclosure')
  assertCanonicalEqual(disclosure, EXPECTED_DISCLOSURE, 'H1 preregistration disclosure')

  assertPublicSafe(receipt)
  assertNoSecretLikeText(receipt)
  const receiptSha256 = requireSha256(receipt.receiptSha256, 'H1 preregistration receipt SHA')
  const projection = structuredClone(receipt)
  delete projection.receiptSha256
  const expectedReceiptSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(projection))
  if (receiptSha256 !== expectedReceiptSha256) {
    throw new Error('H1 preregistration receipt SHA does not match canonical public bytes')
  }
  return Object.freeze(structuredClone(receipt)) as unknown as H1PreregistrationReceiptV2
}
