import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  hashEvaluationDefinition,
  validateBalancedAgentSchedule,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import {
  createModelEnvelope,
  validateCapabilityManifests,
  validateContentRef,
  type CapabilityManifest,
  type ContentRef,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { createFrozenP0ToolRuntime } from './m2-agent-p0-tool-runtime.js'
import {
  validateOrdinaryWorkspace,
  type OrdinaryWorkspace,
} from './m2-agent-ordinary-workspace.js'
import type { ProcessAttemptEvidenceInput } from './m2-agent-process-runner.js'
import {
  FROZEN_H1_SYSTEM_PROMPT,
  type FrozenH1ExecutionDefinitionV2,
} from './m2-h1-execution-definition-v2.js'
import type { H1NextResumeV2 } from './m2-h1-durable-schedule-runner-v2.js'

const MAX_STDOUT_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 16 * 1024
const NO_ORDINARY_WORKSPACE_DOMAIN = 'dsh-toolchain-m2-h1-no-ordinary-workspace-v2'
const NO_ORDINARY_EVIDENCE_DOMAIN = 'dsh-toolchain-m2-h1-no-ordinary-evidence-v2'
const ALLOWED_ENVIRONMENT = new Set([
  'PATH',
  'OPENCODE_API_KEY',
  'OPENCODE_GO_BASE_URL',
  'OPENCODE_GO_REQUEST_MODEL',
  'OPENCODE_GO_EXPECTED_RESPONSE_MODEL',
  'OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT',
  'OPENCODE_GO_THINKING',
  'OPENCODE_GO_REASONING_EFFORT',
  'OPENCODE_GO_MAX_OUTPUT_TOKENS',
])
const REQUIRED_PROVIDER_ENVIRONMENT = Object.freeze([
  'OPENCODE_API_KEY',
  'OPENCODE_GO_BASE_URL',
  'OPENCODE_GO_REQUEST_MODEL',
  'OPENCODE_GO_EXPECTED_RESPONSE_MODEL',
  'OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT',
  'OPENCODE_GO_THINKING',
  'OPENCODE_GO_REASONING_EFFORT',
  'OPENCODE_GO_MAX_OUTPUT_TOKENS',
])

export interface H1ProcessConfigurationV2 {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
}

export interface FrozenH1AttemptInputFactoryV2 {
  buildAttemptInput(resume: H1NextResumeV2): Promise<ProcessAttemptEvidenceInput>
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

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`)
  }
  return value
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeEvaluationJson(left) === canonicalizeEvaluationJson(right)
}

function assertCanonicalEqual(left: unknown, right: unknown, label: string): void {
  if (!canonicalEqual(left, right)) throw new Error(`${label} drifted from the frozen definition`)
}

async function parseJsonContentRef(
  value: unknown,
  label: string,
  sha256: Sha256Port,
): Promise<Record<string, unknown>> {
  const ref = requireRecord(value, `${label} ContentRef`) as unknown as ContentRef
  await validateContentRef(ref, sha256)
  try {
    return requireRecord(JSON.parse(ref.inline), `${label} retained JSON`)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} retained bytes are not valid JSON`)
    throw error
  }
}

function parseResourcePolicy(value: Record<string, unknown>): ResourcePolicy {
  return {
    maxWallTimeMs: requireInteger(value.maxWallTimeMs, 'H1 maxWallTimeMs', 1),
    maxTurns: requireInteger(value.maxTurns, 'H1 maxTurns', 1),
    maxAttempts: requireInteger(value.maxAttempts, 'H1 maxAttempts', 1),
    concurrency: requireInteger(value.concurrency, 'H1 concurrency', 1),
    maxInputTokens: requireInteger(value.maxInputTokens, 'H1 maxInputTokens', 1),
    maxOutputTokens: requireInteger(value.maxOutputTokens, 'H1 maxOutputTokens', 1),
    tokenMeasurementRequired: value.tokenMeasurementRequired === true,
  }
}

function parseRetryPolicy(value: Record<string, unknown>): AgentRetryPolicy {
  const retryableReasons = value.retryableReasons
  if (!Array.isArray(retryableReasons) || !retryableReasons.every(reason => typeof reason === 'string')) {
    throw new Error('H1 retryableReasons must be a string array')
  }
  if (value.modelOutcomeRetries !== 0) throw new Error('H1 modelOutcomeRetries must remain zero')
  return {
    maxInfrastructureRetries: requireInteger(value.maxInfrastructureRetries, 'H1 maxInfrastructureRetries'),
    modelOutcomeRetries: 0,
    retryableReasons: Object.freeze([...retryableReasons]),
  }
}

function assertProcessConfigurationBasics(configuration: H1ProcessConfigurationV2): void {
  requireString(configuration.command, 'H1 child command')
  requireString(configuration.cwd, 'H1 child cwd')
  if (!Array.isArray(configuration.args) || !configuration.args.every(argument => typeof argument === 'string')) {
    throw new Error('H1 child args must be a string array')
  }
  if (configuration.command.includes('\0') || configuration.cwd.includes('\0') || configuration.args.some(argument => argument.includes('\0'))) {
    throw new Error('H1 child process configuration must not contain NUL')
  }
}

function assertEnvironment(
  environment: Readonly<Record<string, string>>,
  executorIdentity: Record<string, unknown>,
  resourcePolicy: ResourcePolicy,
  expectedResponseModel: string,
  expectedBackendFingerprint: string,
): void {
  for (const [key, value] of Object.entries(environment)) {
    if (!ALLOWED_ENVIRONMENT.has(key)) throw new Error(`H1 child environment key ${key} is outside the allowlist`)
    if (typeof value !== 'string') throw new Error(`H1 child environment ${key} must be a string`)
  }
  for (const key of REQUIRED_PROVIDER_ENVIRONMENT) {
    if (typeof environment[key] !== 'string' || environment[key]!.trim().length === 0) {
      throw new Error(`H1 child environment requires non-empty ${key}`)
    }
  }

  const expected = {
    OPENCODE_GO_BASE_URL: requireString(executorIdentity.baseUrl, 'H1 executor baseUrl'),
    OPENCODE_GO_REQUEST_MODEL: requireString(executorIdentity.requestModel, 'H1 executor requestModel'),
    OPENCODE_GO_EXPECTED_RESPONSE_MODEL: expectedResponseModel,
    OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT: expectedBackendFingerprint,
    OPENCODE_GO_THINKING: requireString(executorIdentity.thinking, 'H1 executor thinking'),
    OPENCODE_GO_REASONING_EFFORT: requireString(executorIdentity.reasoningEffort, 'H1 executor reasoningEffort'),
    OPENCODE_GO_MAX_OUTPUT_TOKENS: String(resourcePolicy.maxOutputTokens),
  } as const

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (environment[key] !== expectedValue) {
      throw new Error(`H1 child environment ${key} drifted from frozen provider/resource identity`)
    }
  }
}

async function isolationIdentity(
  sha256: Sha256Port,
  domain: 'session' | 'environment',
  definitionSha256: string,
  resume: H1NextResumeV2,
): Promise<string> {
  return sha256.sha256Utf8([
    `dsh-toolchain-m2-h1-${domain}-v2`,
    definitionSha256,
    String(resume.scheduleIndex),
    resume.taskId,
    resume.arm,
    String(resume.trial),
    String(resume.attempt),
  ].join('\u0000'))
}

function validateResume(
  frozen: FrozenH1ExecutionDefinitionV2,
  resume: H1NextResumeV2,
): void {
  if (resume.status !== 'NEXT') throw new Error('H1 attempt input requires a NEXT resume tuple')
  if (!Number.isSafeInteger(resume.scheduleIndex) || resume.scheduleIndex < 0 || resume.scheduleIndex >= frozen.schedule.length) {
    throw new Error('H1 resume schedule index is outside the frozen schedule')
  }
  const expected = frozen.schedule[resume.scheduleIndex]!
  if (
    expected.taskId !== resume.taskId
    || expected.arm !== resume.arm
    || expected.trial !== resume.trial
  ) {
    throw new Error('H1 resume tuple drifted from the frozen schedule')
  }
  if (!Number.isSafeInteger(resume.attempt) || resume.attempt < 1 || resume.attempt > frozen.resourcePolicy.maxAttempts) {
    throw new Error('H1 resume attempt is outside the frozen retry envelope')
  }
}

async function validateFrozenInputs(
  frozen: FrozenH1ExecutionDefinitionV2,
  workspace: OrdinaryWorkspace,
  processConfiguration: H1ProcessConfigurationV2,
  sha256: Sha256Port,
): Promise<{
  readonly evaluationId: string
  readonly targetFingerprint: string
  readonly contractIndexFingerprint: string
  readonly datasetCommitmentSha256: string
  readonly executorIdentity: Record<string, unknown>
  readonly processConfiguration: H1ProcessConfigurationV2
  readonly noWorkspaceSha256: string
  readonly noEvidenceSha256: string
}> {
  const definitionSha256 = await hashEvaluationDefinition(frozen.definition, sha256)
  if (definitionSha256 !== frozen.definitionSha256) throw new Error('H1 execution definition hash drifted before attempt construction')
  if (frozen.ledgerBinding.definitionSha256 !== frozen.definitionSha256) {
    throw new Error('H1 ledger binding definition hash drifted from the frozen definition')
  }

  const definition = requireRecord(frozen.definition, 'H1 execution definition')
  if (definition.schema !== 'dsh-toolchain-m2-agent-eval-v2' || definition.phase !== 'H1' || definition.recordType !== 'definition') {
    throw new Error('H1 attempt factory requires the canonical H1 definition shape')
  }
  const evaluationId = requireString(definition.evaluationId, 'H1 evaluationId')
  const target = requireRecord(definition.target, 'H1 target')
  const dataset = requireRecord(definition.dataset, 'H1 dataset binding')
  const harness = requireRecord(definition.harness, 'H1 harness')
  const runOrder = requireRecord(definition.runOrder, 'H1 runOrder')
  const execution = requireRecord(definition.execution, 'H1 execution')

  const targetFingerprint = requireString(target.targetFingerprint, 'H1 target fingerprint')
  const contractIndexFingerprint = requireString(target.contractIndexFingerprint, 'H1 Contract Index fingerprint')
  const datasetCommitmentSha256 = requireString(dataset.commitmentSha256, 'H1 dataset commitment')
  if (datasetCommitmentSha256 !== frozen.ledgerBinding.datasetCommitmentSha256) {
    throw new Error('H1 dataset commitment drifted from the ledger binding')
  }
  if (dataset.id !== 'H1' || dataset.hiddenUntilRunComplete !== true) {
    throw new Error('H1 dataset binding must remain hidden H1')
  }
  if (dataset.taskCount !== frozen.modelTasks.length) {
    throw new Error('H1 dataset task count drifted from the frozen model tasks')
  }

  const taskIds = frozen.modelTasks.map(task => task.id)
  validateBalancedAgentSchedule(frozen.schedule, taskIds)
  assertCanonicalEqual(runOrder.schedule, frozen.schedule, 'H1 schedule')

  const modelTaskProjectionSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(frozen.modelTasks))
  if (harness.taskPromptSha256 !== modelTaskProjectionSha256) {
    throw new Error('H1 model-task projection hash drifted from the frozen definition')
  }

  validateCapabilityManifests(frozen.capabilityManifests)
  const capabilityRefs = requireRecord(execution.capabilityManifests, 'H1 capability manifest refs')
  for (const arm of ['A', 'B', 'C'] as const) {
    const retained = await parseJsonContentRef(capabilityRefs[arm], `H1 capability manifest ${arm}`, sha256)
    assertCanonicalEqual(retained, frozen.capabilityManifests[arm], `H1 capability manifest ${arm}`)
  }

  const retainedResource = parseResourcePolicy(await parseJsonContentRef(execution.resourcePolicy, 'H1 resource policy', sha256))
  const retainedRetry = parseRetryPolicy(await parseJsonContentRef(execution.retryPolicy, 'H1 retry policy', sha256))
  assertCanonicalEqual(retainedResource, frozen.resourcePolicy, 'H1 resource policy')
  assertCanonicalEqual(retainedRetry, frozen.retryPolicy, 'H1 retry policy')
  if (frozen.resourcePolicy.concurrency !== 1) throw new Error('H1 attempt factory requires frozen concurrency=1')
  if (frozen.retryPolicy.modelOutcomeRetries !== 0) throw new Error('H1 attempt factory requires zero model-outcome retries')

  await parseJsonContentRef(execution.runnerIdentity, 'H1 runner identity', sha256)
  const executorIdentity = await parseJsonContentRef(execution.executorIdentity, 'H1 executor identity', sha256)
  const expectedResponseModel = requireString(executorIdentity.expectedResponseModel, 'H1 executor expectedResponseModel')
  const expectedBackendFingerprint = requireString(executorIdentity.expectedSystemFingerprint, 'H1 executor expectedSystemFingerprint')
  if (
    expectedResponseModel !== frozen.ledgerBinding.expectedResponseModel
    || expectedBackendFingerprint !== frozen.ledgerBinding.expectedBackendFingerprint
    || executorIdentity.providerIdentityReceiptSha256 !== frozen.ledgerBinding.providerIdentityReceiptSha256
  ) {
    throw new Error('H1 executor identity drifted from the frozen ledger binding')
  }
  if (executorIdentity.provider !== 'opencode-go' || executorIdentity.adapterVersion !== 'opencode-go-deepseek-chat-v1') {
    throw new Error('H1 executor identity must remain the frozen OpenCode Go adapter')
  }

  await validateOrdinaryWorkspace(workspace, sha256)
  if (
    workspace.target.targetFingerprint !== targetFingerprint
    || workspace.target.contractIndexFingerprint !== contractIndexFingerprint
  ) {
    throw new Error('H1 ordinary workspace target identity drifted from the frozen definition')
  }
  for (const arm of ['B', 'C'] as const) {
    const evidence = frozen.capabilityManifests[arm].ordinaryEvidence
    if (
      evidence === null
      || evidence.workspaceSnapshotSha256 !== workspace.workspaceSnapshotSha256
      || evidence.staticDocsSha256 !== workspace.documentationSha256
    ) {
      throw new Error(`H1 capability manifest ${arm} ordinary workspace identity drifted`)
    }
  }

  assertProcessConfigurationBasics(processConfiguration)
  assertEnvironment(
    processConfiguration.environment,
    executorIdentity,
    frozen.resourcePolicy,
    frozen.ledgerBinding.expectedResponseModel,
    frozen.ledgerBinding.expectedBackendFingerprint,
  )

  return Object.freeze({
    evaluationId,
    targetFingerprint,
    contractIndexFingerprint,
    datasetCommitmentSha256,
    executorIdentity: Object.freeze(structuredClone(executorIdentity)),
    processConfiguration: Object.freeze({
      command: processConfiguration.command,
      args: Object.freeze([...processConfiguration.args]),
      cwd: processConfiguration.cwd,
      environment: Object.freeze({ ...processConfiguration.environment }),
    }),
    noWorkspaceSha256: await sha256.sha256Utf8(NO_ORDINARY_WORKSPACE_DOMAIN),
    noEvidenceSha256: await sha256.sha256Utf8(NO_ORDINARY_EVIDENCE_DOMAIN),
  })
}

export async function createFrozenH1AttemptInputFactoryV2(
  frozen: FrozenH1ExecutionDefinitionV2,
  workspace: OrdinaryWorkspace,
  processConfiguration: H1ProcessConfigurationV2,
  sha256: Sha256Port,
): Promise<FrozenH1AttemptInputFactoryV2> {
  const validated = await validateFrozenInputs(frozen, workspace, processConfiguration, sha256)
  const tasks = new Map(frozen.modelTasks.map(task => [task.id, Object.freeze({ ...task })]))

  async function buildAttemptInput(resume: H1NextResumeV2): Promise<ProcessAttemptEvidenceInput> {
    validateResume(frozen, resume)
    const task = tasks.get(resume.taskId)
    if (task === undefined) throw new Error(`H1 frozen schedule references unknown model task ${resume.taskId}`)
    const capabilityManifest: CapabilityManifest = structuredClone(frozen.capabilityManifests[resume.arm])
    const modelEnvelope = createModelEnvelope({
      systemPrompt: FROZEN_H1_SYSTEM_PROMPT,
      task,
      staticContext: [],
      capabilityManifest,
    })
    const [sessionIdSha256, mutableEnvironmentIdSha256] = await Promise.all([
      isolationIdentity(sha256, 'session', frozen.definitionSha256, resume),
      isolationIdentity(sha256, 'environment', frozen.definitionSha256, resume),
    ])
    const hasOrdinaryEvidence = resume.arm !== 'A'

    return {
      identity: {
        evaluationId: validated.evaluationId,
        phase: 'H1',
        taskId: resume.taskId,
        arm: resume.arm,
        trial: resume.trial,
        attempt: resume.attempt,
        targetFingerprint: validated.targetFingerprint,
        contractIndexFingerprint: validated.contractIndexFingerprint,
        datasetCommitmentSha256: validated.datasetCommitmentSha256,
      },
      capabilityManifest,
      resourcePolicy: structuredClone(frozen.resourcePolicy),
      retryPolicy: structuredClone(frozen.retryPolicy),
      executorIdentity: structuredClone(validated.executorIdentity),
      modelEnvelope,
      isolation: {
        sessionIdSha256,
        workspaceMode: hasOrdinaryEvidence ? 'read-only-reset' : 'fresh',
        workspaceSnapshotSha256: hasOrdinaryEvidence
          ? workspace.workspaceSnapshotSha256
          : validated.noWorkspaceSha256,
        ordinaryEvidenceSha256: hasOrdinaryEvidence
          ? workspace.documentationSha256
          : validated.noEvidenceSha256,
        mutableEnvironmentIdSha256,
      },
      process: {
        command: validated.processConfiguration.command,
        args: [...validated.processConfiguration.args],
        cwd: validated.processConfiguration.cwd,
        environment: { ...validated.processConfiguration.environment },
        timeoutMs: frozen.resourcePolicy.maxWallTimeMs,
        maxStdoutBytes: MAX_STDOUT_BYTES,
        maxStderrBytes: MAX_STDERR_BYTES,
      },
      createToolRuntime: runControlSha256 => createFrozenP0ToolRuntime(runControlSha256, workspace),
      sha256,
    }
  }

  return Object.freeze({ buildAttemptInput })
}
