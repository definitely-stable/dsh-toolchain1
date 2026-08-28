import type { Sha256Port } from '../../src/model/digest.js'

import {
  canonicalizeEvaluationJson,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  createResourceReceipt,
  createRunControl,
  type AgentArm,
  type CapabilityManifest,
  type ContentRef,
  type IsolationReceipt,
  type ModelEnvelope,
  type ResourcePolicy,
  type TraceReceipt,
} from './m2-agent-execution-evidence.js'
import {
  executeProcessModelAttempt,
  type ProcessModelAttemptInput,
  type ProcessToolCallRequest,
} from './m2-agent-process-executor.js'

export interface ProcessAttemptIdentity {
  readonly evaluationId: string
  readonly phase: 'P0' | 'H1'
  readonly taskId: string
  readonly arm: AgentArm
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly targetFingerprint: string
  readonly contractIndexFingerprint: string
  readonly datasetCommitmentSha256: string
}

export interface ProcessAttemptIsolationInput {
  readonly sessionIdSha256: string
  readonly workspaceMode: 'fresh' | 'read-only-reset'
  readonly workspaceSnapshotSha256: string
  readonly ordinaryEvidenceSha256: string
  readonly mutableEnvironmentIdSha256: string
}

export interface RunnerToolRuntime {
  dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown>
  traceReceipt(): Promise<TraceReceipt>
}

export interface ProcessAttemptEvidenceInput {
  readonly identity: ProcessAttemptIdentity
  readonly capabilityManifest: CapabilityManifest
  readonly resourcePolicy: ResourcePolicy
  readonly retryPolicy: AgentRetryPolicy
  readonly executorIdentity: unknown
  readonly modelEnvelope: ModelEnvelope
  readonly isolation: ProcessAttemptIsolationInput
  readonly process: Omit<ProcessModelAttemptInput, 'envelope' | 'dispatchToolCall'>
  readonly createToolRuntime: (runControlSha256: string) => Promise<RunnerToolRuntime>
  readonly sha256: Sha256Port
  readonly now?: () => number
}

export interface ProcessAttemptExecutionEvidence {
  readonly runControl: ContentRef
  readonly modelEnvelope: ContentRef
  readonly trace: ContentRef
  readonly executorIdentity: ContentRef
  readonly isolationReceipt: ContentRef
  readonly resourceReceipt: ContentRef
}

export interface ProcessAttemptEvidenceBase {
  readonly attempt: number
  readonly startedAt: string
  readonly completedAt: string
  readonly executionEvidence: ProcessAttemptExecutionEvidence
}

export interface ProcessModelOutcomeEvidenceRecord extends ProcessAttemptEvidenceBase {
  readonly outcome: 'model-outcome'
  readonly rawAnswer: ContentRef
  readonly providerMetadata: ContentRef
  readonly parsedApiClaims: readonly unknown[]
  readonly taskSuccess: 'SUCCESS' | 'FAILURE' | 'UNKNOWN'
}

export interface ProcessInfrastructureFailureEvidenceRecord extends ProcessAttemptEvidenceBase {
  readonly outcome: 'infrastructure-failure'
  readonly reason: 'provider-transport' | 'tool-transport' | 'runner-infrastructure'
  readonly qualityIndependent: true
  readonly partialOutput?: ContentRef
  readonly detail: string
}

export type ProcessAttemptEvidenceRecord =
  | ProcessModelOutcomeEvidenceRecord
  | ProcessInfrastructureFailureEvidenceRecord

export interface ProcessAttemptEvidenceResult {
  readonly attempt: ProcessAttemptEvidenceRecord
  readonly frozen: {
    readonly capabilityManifest: ContentRef
    readonly resourcePolicy: ContentRef
    readonly retryPolicy: ContentRef
    readonly executorIdentity: ContentRef
    readonly modelEnvelope: ContentRef
    readonly runControl: ContentRef
  }
}

async function jsonRef(value: unknown, sha256: Sha256Port): Promise<ContentRef> {
  return createInlineContentRef(
    canonicalizeEvaluationJson(value),
    'application/json',
    'utf8-bytes-v1',
    sha256,
  )
}

function assertAttemptInputs(input: ProcessAttemptEvidenceInput): void {
  if (input.capabilityManifest.arm !== input.identity.arm) {
    throw new Error('Process attempt capability manifest arm must match RunControl identity')
  }
  if (input.modelEnvelope.task.id !== input.identity.taskId) {
    throw new Error('Process attempt ModelEnvelope task must match RunControl identity')
  }
  if (
    canonicalizeEvaluationJson(input.modelEnvelope.tools)
    !== canonicalizeEvaluationJson(input.capabilityManifest.tools)
  ) {
    throw new Error('Process attempt ModelEnvelope tools must match the frozen capability manifest')
  }
}

function isolationReceipt(
  runControlSha256: string,
  input: ProcessAttemptIsolationInput,
): IsolationReceipt {
  return {
    schema: 'dsh-toolchain-m2-isolation-v1',
    runControlSha256,
    sessionIdSha256: input.sessionIdSha256,
    freshModelSession: true,
    memoryCarryover: false,
    workspaceMode: input.workspaceMode,
    workspaceSnapshotSha256: input.workspaceSnapshotSha256,
    toolStateReset: true,
    ordinaryEvidenceSha256: input.ordinaryEvidenceSha256,
    mutableEnvironmentIdSha256: input.mutableEnvironmentIdSha256,
    parallelMutableStateShared: false,
    retrySessionPolicy: 'fresh-session-per-attempt',
  }
}

function processFailureDetail(result: {
  reason: string
  detail: string
  stderr?: string
}): string {
  return result.stderr === undefined || result.stderr.length === 0
    ? `${result.reason}: ${result.detail}`
    : `${result.reason}: ${result.detail}; stderr=${result.stderr}`
}

export async function executeProcessAttemptWithEvidence(
  input: ProcessAttemptEvidenceInput,
): Promise<ProcessAttemptEvidenceResult> {
  assertAttemptInputs(input)

  const capabilityManifest = await jsonRef(input.capabilityManifest, input.sha256)
  const resourcePolicy = await jsonRef(input.resourcePolicy, input.sha256)
  const retryPolicy = await jsonRef(input.retryPolicy, input.sha256)
  const executorIdentity = await jsonRef(input.executorIdentity, input.sha256)
  const modelEnvelope = await jsonRef(input.modelEnvelope, input.sha256)
  const runControl = createRunControl({
    evaluationId: input.identity.evaluationId,
    phase: input.identity.phase,
    taskId: input.identity.taskId,
    arm: input.identity.arm,
    trial: input.identity.trial,
    attempt: input.identity.attempt,
    targetFingerprint: input.identity.targetFingerprint,
    contractIndexFingerprint: input.identity.contractIndexFingerprint,
    datasetCommitmentSha256: input.identity.datasetCommitmentSha256,
    capabilityManifestSha256: capabilityManifest.sha256,
    resourcePolicySha256: resourcePolicy.sha256,
    retryPolicySha256: retryPolicy.sha256,
    executorIdentitySha256: executorIdentity.sha256,
    modelEnvelopeSha256: modelEnvelope.sha256,
  })
  const runControlRef = await jsonRef(runControl, input.sha256)
  const runtime = await input.createToolRuntime(runControlRef.sha256)
  const now = input.now ?? Date.now
  const startedMs = now()
  let toolCalls = 0

  const processResult = await executeProcessModelAttempt({
    ...input.process,
    envelope: input.modelEnvelope,
    dispatchToolCall: async request => {
      toolCalls += 1
      return runtime.dispatchToolCall(request)
    },
  })
  const completedMs = now()
  const trace = await runtime.traceReceipt()
  if (trace.runControlSha256 !== runControlRef.sha256) {
    throw new Error('Process attempt trace must bind the runner-owned RunControl')
  }
  const traceRef = await jsonRef(trace, input.sha256)
  const isolation = isolationReceipt(runControlRef.sha256, input.isolation)
  const isolationRef = await jsonRef(isolation, input.sha256)

  const inputTokens = processResult.kind === 'model-outcome'
    ? processResult.providerMetadata.inputTokens
    : undefined
  const outputTokens = processResult.kind === 'model-outcome'
    ? processResult.providerMetadata.outputTokens
    : undefined
  const tokenMeasurementAvailable = inputTokens !== undefined && outputTokens !== undefined
  const resource = await createResourceReceipt(
    runControlRef.sha256,
    input.resourcePolicy,
    {
      wallTimeMs: Math.max(0, completedMs - startedMs),
      turns: toolCalls + 1,
      attempts: 1,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
    },
    {
      wallTime: 'runner',
      turns: 'runner',
      tokens: tokenMeasurementAvailable ? 'provider-reported' : 'unavailable',
    },
    input.sha256,
  )
  const resourceRef = await jsonRef(resource, input.sha256)
  const executionEvidence = {
    runControl: runControlRef,
    modelEnvelope,
    trace: traceRef,
    executorIdentity,
    isolationReceipt: isolationRef,
    resourceReceipt: resourceRef,
  } as const
  const timestamps = {
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
  } as const

  const frozen = {
    capabilityManifest,
    resourcePolicy,
    retryPolicy,
    executorIdentity,
    modelEnvelope,
    runControl: runControlRef,
  } as const

  if (processResult.kind === 'model-outcome') {
    const rawAnswer = await createInlineContentRef(
      processResult.finalAnswer,
      'text/plain',
      'utf8-bytes-v1',
      input.sha256,
    )
    const providerMetadata = await jsonRef(processResult.providerMetadata, input.sha256)
    return {
      frozen,
      attempt: {
        attempt: input.identity.attempt,
        ...timestamps,
        outcome: 'model-outcome',
        executionEvidence,
        rawAnswer,
        providerMetadata,
        parsedApiClaims: [],
        taskSuccess: 'UNKNOWN',
      },
    }
  }

  const retainedOutput = (
    processResult.partialOutput === undefined
    && processResult.stderr === undefined
    && processResult.providerMetadata === undefined
  )
    ? undefined
    : await jsonRef({
      stdout: processResult.partialOutput ?? '',
      stderr: processResult.stderr ?? '',
      ...(processResult.providerMetadata === undefined
        ? {}
        : { providerMetadata: processResult.providerMetadata }),
    }, input.sha256)
  const retryReason = processResult.reason === 'provider-transport' || processResult.reason === 'tool-transport'
    ? processResult.reason
    : 'runner-infrastructure'
  return {
    frozen,
    attempt: {
      attempt: input.identity.attempt,
      ...timestamps,
      outcome: 'infrastructure-failure',
      executionEvidence,
      reason: retryReason,
      qualityIndependent: true,
      ...(retainedOutput === undefined ? {} : { partialOutput: retainedOutput }),
      detail: processFailureDetail(processResult),
    },
  }
}
