import type { Sha256Port } from '../../src/model/digest.js'

import {
  canonicalizeEvaluationJson,
  hashEvaluationDefinition,
  validateAgentResultAgainstDefinition,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import {
  validateCapabilityManifests,
  validateContentRef,
  validateIsolationReceipt,
  validateResourceReceipt,
  validateTraceReceipt,
  type AgentArm,
  type CapabilityManifest,
  type ContentRef,
  type IsolationReceipt,
  type ModelEnvelope,
  type ResourceReceipt,
  type RunControl,
  type TraceReceipt,
} from './m2-agent-execution-evidence.js'
import {
  validateRunnerAttemptSequence,
  type RunnerAttemptEvidence,
} from './m2-agent-runner-retry-evidence.js'

const RESULT_ONLY_FIELDS = new Set(['definitionSha256', 'executedAt', 'runs'])
const V2_SCHEMA = 'dsh-toolchain-m2-agent-eval-v2'

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function parseArm(value: unknown): AgentArm {
  if (value !== 'A' && value !== 'B' && value !== 'C') throw new Error('Agent v2 arm must be A, B or C')
  return value
}

function parseTrial(value: unknown): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) throw new Error('Agent v2 trial must be 1, 2 or 3')
  return value
}

function parseJsonRef(ref: ContentRef, label: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(ref.inline), `${label} retained JSON`)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} retained bytes are not valid JSON`)
    throw error
  }
}

function bindingProjection(record: Record<string, unknown>): Record<string, unknown> {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'recordType' || key === 'status' || RESULT_ONLY_FIELDS.has(key)) continue
    projection[key] = value
  }
  return projection
}

function contentRef(value: unknown, label: string): ContentRef {
  const record = requireRecord(value, label)
  return record as unknown as ContentRef
}

function executionRecord(record: Record<string, unknown>): Record<string, unknown> {
  return requireRecord(record.execution, 'Agent v2 execution preregistration')
}

function manifestRefs(execution: Record<string, unknown>): Record<AgentArm, ContentRef> {
  const refs = requireRecord(execution.capabilityManifests, 'Agent v2 capability manifests')
  return {
    A: contentRef(refs.A, 'Agent v2 capability manifest A'),
    B: contentRef(refs.B, 'Agent v2 capability manifest B'),
    C: contentRef(refs.C, 'Agent v2 capability manifest C'),
  }
}

function retryPolicy(record: Record<string, unknown>): AgentRetryPolicy {
  const retries = requireRecord(record.retries, 'Agent v2 retry policy')
  const maxInfrastructureRetries = retries.maxInfrastructureRetries
  if (typeof maxInfrastructureRetries !== 'number' || !Number.isInteger(maxInfrastructureRetries) || maxInfrastructureRetries < 0) {
    throw new Error('Agent v2 maxInfrastructureRetries must be a non-negative integer')
  }
  if (retries.modelOutcomeRetries !== 0) throw new Error('Agent v2 modelOutcomeRetries must remain zero')
  const reasons = requireArray(retries.retryableReasons, 'Agent v2 retryable reasons')
    .map((reason, index) => requireString(reason, `Agent v2 retryable reason[${index}]`))
  return {
    maxInfrastructureRetries,
    modelOutcomeRetries: 0,
    retryableReasons: reasons,
  }
}

function toV1Attempt(attempt: Record<string, unknown>): Record<string, unknown> {
  if (attempt.outcome === 'model-outcome') {
    const rawAnswer = requireRecord(attempt.rawAnswer, 'Agent v2 raw answer')
    return {
      attempt: attempt.attempt,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      outcome: 'model-outcome',
      rawAnswer: {
        reference: `inline:${requireString(rawAnswer.sha256, 'Agent v2 raw answer sha256')}`,
        sha256: rawAnswer.sha256,
      },
      parsedApiClaims: attempt.parsedApiClaims,
      taskSuccess: attempt.taskSuccess,
    }
  }

  return {
    attempt: attempt.attempt,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    outcome: attempt.outcome,
    reason: attempt.reason,
    ...(attempt.detail === undefined ? {} : { detail: attempt.detail }),
  }
}

function toV1Base(record: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'execution' || RESULT_ONLY_FIELDS.has(key)) continue
    base[key] = value
  }
  base.schema = 'dsh-toolchain-m2-agent-eval-v1'
  return base
}

async function validateV1Compatibility(
  definition: Record<string, unknown>,
  result: Record<string, unknown>,
  sha256: Sha256Port,
): Promise<void> {
  const v1Definition = toV1Base(definition)
  const v1DefinitionSha256 = await hashEvaluationDefinition(v1Definition, sha256)
  const v1Runs = requireArray(result.runs, 'Agent v2 result runs').map((runValue, runIndex) => {
    const run = requireRecord(runValue, `Agent v2 result run[${runIndex}]`)
    return {
      taskId: run.taskId,
      arm: run.arm,
      trial: run.trial,
      attempts: requireArray(run.attempts, `Agent v2 result run[${runIndex}].attempts`)
        .map((attempt, attemptIndex) => toV1Attempt(requireRecord(
          attempt,
          `Agent v2 result run[${runIndex}].attempt[${attemptIndex}]`,
        ))),
    }
  })
  const v1Result = {
    ...toV1Base(result),
    recordType: 'result',
    status: result.status,
    definitionSha256: v1DefinitionSha256,
    executedAt: result.executedAt,
    runs: v1Runs,
  }
  await validateAgentResultAgainstDefinition(v1Definition, v1Result, sha256)
}

async function validateDefinitionEvidence(
  definition: Record<string, unknown>,
  sha256: Sha256Port,
): Promise<{
  readonly execution: Record<string, unknown>
  readonly manifests: Record<AgentArm, CapabilityManifest>
  readonly manifestReferences: Record<AgentArm, ContentRef>
  readonly executorIdentity: ContentRef
  readonly resourcePolicy: ContentRef
  readonly retryPolicyReference: ContentRef
}> {
  const execution = executionRecord(definition)
  const runnerIdentity = contentRef(execution.runnerIdentity, 'Agent v2 runner identity')
  const executorIdentity = contentRef(execution.executorIdentity, 'Agent v2 executor identity')
  const references = manifestRefs(execution)
  const resourcePolicy = contentRef(execution.resourcePolicy, 'Agent v2 resource policy')
  const retryPolicyReference = contentRef(execution.retryPolicy, 'Agent v2 retry policy evidence')

  await validateContentRef(runnerIdentity, sha256)
  await validateContentRef(executorIdentity, sha256)
  await validateContentRef(resourcePolicy, sha256)
  await validateContentRef(retryPolicyReference, sha256)
  await Promise.all(Object.values(references).map(ref => validateContentRef(ref, sha256)))

  const manifests = {
    A: parseJsonRef(references.A, 'Agent v2 capability manifest A') as unknown as CapabilityManifest,
    B: parseJsonRef(references.B, 'Agent v2 capability manifest B') as unknown as CapabilityManifest,
    C: parseJsonRef(references.C, 'Agent v2 capability manifest C') as unknown as CapabilityManifest,
  }
  validateCapabilityManifests(manifests)

  const frozenRetry = parseJsonRef(retryPolicyReference, 'Agent v2 retry policy evidence')
  if (canonicalizeEvaluationJson(frozenRetry) !== canonicalizeEvaluationJson(definition.retries)) {
    throw new Error('Agent v2 retained retry policy does not match preregistered retries')
  }

  return {
    execution,
    manifests,
    manifestReferences: references,
    executorIdentity,
    resourcePolicy,
    retryPolicyReference,
  }
}

function assertRunControlBinding(input: {
  control: RunControl
  definition: Record<string, unknown>
  taskId: string
  arm: AgentArm
  trial: 1 | 2 | 3
  attempt: number
  modelEnvelope: ContentRef
  manifest: ContentRef
  executorIdentity: ContentRef
  resourcePolicy: ContentRef
  retryPolicy: ContentRef
}): void {
  const { control, definition } = input
  const target = requireRecord(definition.target, 'Agent v2 target')
  const dataset = requireRecord(definition.dataset, 'Agent v2 dataset')
  if (control.schema !== 'dsh-toolchain-m2-run-control-v1') throw new Error('Agent v2 RunControl schema is invalid')
  if (control.evaluationId !== definition.evaluationId || control.phase !== definition.phase) {
    throw new Error('Agent v2 RunControl does not bind the frozen evaluation identity')
  }
  if (control.taskId !== input.taskId || control.arm !== input.arm || control.trial !== input.trial || control.attempt !== input.attempt) {
    throw new Error('Agent v2 RunControl does not bind task/arm/trial/attempt identity')
  }
  if (
    control.targetFingerprint !== target.targetFingerprint
    || control.contractIndexFingerprint !== target.contractIndexFingerprint
  ) {
    throw new Error('Agent v2 RunControl does not bind the frozen target/index')
  }
  if (control.datasetCommitmentSha256 !== dataset.commitmentSha256) {
    throw new Error('Agent v2 RunControl does not bind the frozen dataset commitment')
  }
  if (control.capabilityManifestSha256 !== input.manifest.sha256) throw new Error('Agent v2 RunControl capability manifest hash mismatch')
  if (control.resourcePolicySha256 !== input.resourcePolicy.sha256) throw new Error('Agent v2 RunControl resource policy hash mismatch')
  if (control.retryPolicySha256 !== input.retryPolicy.sha256) throw new Error('Agent v2 RunControl retry policy hash mismatch')
  if (control.executorIdentitySha256 !== input.executorIdentity.sha256) throw new Error('Agent v2 RunControl executor identity hash mismatch')
  if (control.modelEnvelopeSha256 !== input.modelEnvelope.sha256) throw new Error('Agent v2 RunControl model-envelope hash mismatch')
}

function assertEnvelopeCapability(envelope: ModelEnvelope, manifest: CapabilityManifest, taskId: string): void {
  if (envelope.schema !== 'dsh-toolchain-m2-model-envelope-v1') throw new Error('Agent v2 ModelEnvelope schema is invalid')
  if (envelope.task.id !== taskId) throw new Error('Agent v2 ModelEnvelope task identity mismatch')
  if (canonicalizeEvaluationJson(envelope.tools) !== canonicalizeEvaluationJson(manifest.tools)) {
    throw new Error('Agent v2 ModelEnvelope tool surface does not match the frozen capability manifest')
  }
  if (manifest.arm === 'A' && envelope.staticContext.length !== 0) {
    throw new Error('Agent v2 arm A ModelEnvelope must not contain exact-target static context')
  }
}

export async function validateAgentV2ResultAgainstDefinition(
  definitionValue: unknown,
  resultValue: unknown,
  sha256: Sha256Port,
): Promise<void> {
  const definition = requireRecord(definitionValue, 'Agent v2 definition')
  const result = requireRecord(resultValue, 'Agent v2 result')
  if (definition.schema !== V2_SCHEMA || result.schema !== V2_SCHEMA) {
    throw new Error('New agent execution evidence requires the m2-agent-eval-v2 schema; v1 is historical only')
  }
  if (definition.recordType !== 'definition' || result.recordType !== 'result') {
    throw new Error('Agent v2 definition/result record types are invalid')
  }

  const expectedDefinitionSha256 = await hashEvaluationDefinition(definition, sha256)
  if (result.definitionSha256 !== expectedDefinitionSha256) {
    throw new Error('Agent v2 result definition hash does not match the frozen definition')
  }
  if (
    canonicalizeEvaluationJson(bindingProjection(definition))
    !== canonicalizeEvaluationJson(bindingProjection(result))
  ) {
    throw new Error('Agent v2 result preregistration fields, including execution policy, do not match the frozen definition')
  }

  await validateV1Compatibility(definition, result, sha256)
  const frozen = await validateDefinitionEvidence(definition, sha256)
  const policy = retryPolicy(definition)
  const resultStatus = requireString(result.status, 'Agent v2 result status')
  const runs = requireArray(result.runs, 'Agent v2 result runs')
  const sessionIds = new Set<string>()
  const environmentIds = new Set<string>()
  const envelopesByTaskArm = new Map<string, string>()
  const comparableEnvelopeByTaskTrial = new Map<string, ModelEnvelope>()

  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    const run = requireRecord(runs[runIndex], `Agent v2 run[${runIndex}]`)
    const taskId = requireString(run.taskId, `Agent v2 run[${runIndex}].taskId`)
    const arm = parseArm(run.arm)
    const trial = parseTrial(run.trial)
    const rawAttempts = requireArray(run.attempts, `Agent v2 run[${runIndex}].attempts`)
    const attemptEvidence: RunnerAttemptEvidence[] = []

    for (let attemptIndex = 0; attemptIndex < rawAttempts.length; attemptIndex += 1) {
      const attempt = requireRecord(rawAttempts[attemptIndex], `Agent v2 run[${runIndex}].attempt[${attemptIndex}]`)
      const attemptNumber = requireInteger(attempt.attempt, 'Agent v2 attempt number')
      const evidence = requireRecord(attempt.executionEvidence, 'Agent v2 execution evidence')
      const runControlRef = contentRef(evidence.runControl, 'Agent v2 RunControl evidence')
      const modelEnvelopeRef = contentRef(evidence.modelEnvelope, 'Agent v2 ModelEnvelope evidence')
      const traceRef = contentRef(evidence.trace, 'Agent v2 trace evidence')
      const executorIdentity = contentRef(evidence.executorIdentity, 'Agent v2 executor identity evidence')
      const isolationRef = contentRef(evidence.isolationReceipt, 'Agent v2 isolation receipt evidence')
      const resourceRef = contentRef(evidence.resourceReceipt, 'Agent v2 resource receipt evidence')
      const refs = [runControlRef, modelEnvelopeRef, traceRef, executorIdentity, isolationRef, resourceRef]
      await Promise.all(refs.map(ref => validateContentRef(ref, sha256)))

      if (
        executorIdentity.sha256 !== frozen.executorIdentity.sha256
        || canonicalizeEvaluationJson(executorIdentity) !== canonicalizeEvaluationJson(frozen.executorIdentity)
      ) {
        throw new Error('Agent v2 attempt executor identity does not match the frozen definition')
      }

      const control = parseJsonRef(runControlRef, 'Agent v2 RunControl') as unknown as RunControl
      const envelope = parseJsonRef(modelEnvelopeRef, 'Agent v2 ModelEnvelope') as unknown as ModelEnvelope
      const trace = parseJsonRef(traceRef, 'Agent v2 trace') as unknown as TraceReceipt
      const isolation = parseJsonRef(isolationRef, 'Agent v2 isolation receipt') as unknown as IsolationReceipt
      const resource = parseJsonRef(resourceRef, 'Agent v2 resource receipt') as unknown as ResourceReceipt
      const currentManifest = frozen.manifests[arm]
      const currentManifestRef = frozen.manifestReferences[arm]

      assertRunControlBinding({
        control,
        definition,
        taskId,
        arm,
        trial,
        attempt: attemptNumber,
        modelEnvelope: modelEnvelopeRef,
        manifest: currentManifestRef,
        executorIdentity: frozen.executorIdentity,
        resourcePolicy: frozen.resourcePolicy,
        retryPolicy: frozen.retryPolicyReference,
      })
      assertEnvelopeCapability(envelope, currentManifest, taskId)

      if (trace.runControlSha256 !== runControlRef.sha256) throw new Error('Agent v2 trace RunControl binding mismatch')
      await validateTraceReceipt(trace, arm, sha256)
      if (isolation.runControlSha256 !== runControlRef.sha256) throw new Error('Agent v2 isolation RunControl binding mismatch')
      validateIsolationReceipt(isolation)
      if (resource.runControlSha256 !== runControlRef.sha256) throw new Error('Agent v2 resource RunControl binding mismatch')
      await validateResourceReceipt(resource, sha256)
      if (resource.configuredPolicySha256 !== frozen.resourcePolicy.sha256) {
        throw new Error('Agent v2 resource receipt is not bound to the frozen resource policy')
      }
      if (resultStatus !== 'INCONCLUSIVE' && resource.compliance !== 'compliant') {
        throw new Error(`Agent v2 terminal result requires compliant resource evidence; use INCONCLUSIVE for ${resource.compliance}`)
      }

      if (sessionIds.has(isolation.sessionIdSha256)) throw new Error('Agent v2 isolation forbids model-session reuse across scheduled runs')
      sessionIds.add(isolation.sessionIdSha256)
      if (environmentIds.has(isolation.mutableEnvironmentIdSha256)) throw new Error('Agent v2 isolation forbids mutable-environment reuse across scheduled runs')
      environmentIds.add(isolation.mutableEnvironmentIdSha256)

      const envelopeKey = `${taskId}\u0000${arm}`
      const canonicalEnvelope = canonicalizeEvaluationJson(envelope)
      const previousEnvelope = envelopesByTaskArm.get(envelopeKey)
      if (previousEnvelope !== undefined && previousEnvelope !== canonicalEnvelope) {
        throw new Error('Agent v2 ModelEnvelope must remain identical across trials/retries for one task and arm')
      }
      envelopesByTaskArm.set(envelopeKey, canonicalEnvelope)

      if (arm === 'B' || arm === 'C') {
        const pairKey = `${taskId}\u0000${trial}`
        const previous = comparableEnvelopeByTaskTrial.get(pairKey)
        if (previous === undefined) {
          comparableEnvelopeByTaskTrial.set(pairKey, envelope)
        } else {
          const left = { ...previous, tools: [] }
          const right = { ...envelope, tools: [] }
          if (canonicalizeEvaluationJson(left) !== canonicalizeEvaluationJson(right)) {
            throw new Error('Agent v2 B/C ModelEnvelope must differ only by the frozen Toolchain capability surface')
          }
        }
      }

      if (attempt.outcome === 'model-outcome') {
        await validateContentRef(contentRef(attempt.rawAnswer, 'Agent v2 raw answer'), sha256)
        await validateContentRef(contentRef(attempt.providerMetadata, 'Agent v2 provider metadata'), sha256)
      } else if (attempt.outcome === 'infrastructure-failure') {
        if (attempt.qualityIndependent !== true) {
          throw new Error('Agent v2 infrastructure failure must be classified independently of answer quality')
        }
        if (attempt.partialOutput !== undefined) {
          await validateContentRef(contentRef(attempt.partialOutput, 'Agent v2 partial output'), sha256)
        }
      } else {
        throw new Error('Agent v2 attempt outcome is invalid')
      }

      attemptEvidence.push({
        taskId,
        arm,
        trial,
        attempt: attemptNumber,
        kind: attempt.outcome,
        ...(attempt.reason === undefined ? {} : { reason: requireString(attempt.reason, 'Agent v2 retry reason') }),
        qualityIndependent: attempt.outcome === 'infrastructure-failure' ? attempt.qualityIndependent === true : true,
        modelEnvelopeSha256: modelEnvelopeRef.sha256,
        trace,
        isolation,
      })
    }

    validateRunnerAttemptSequence(attemptEvidence, policy)
  }
}
