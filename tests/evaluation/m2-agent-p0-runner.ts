import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import type { Sha256Port } from '../../src/model/digest.js'
import {
  hashEvaluationDefinition,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import { validateAgentV2ResultAgainstDefinition } from './m2-agent-eval-v2-integrity.js'
import {
  createModelEnvelope,
  createModelTask,
  type AgentArm,
  type ContentRef,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import {
  adjudicateP0ModelOutcome,
  type ClassifiedP0ApiClaim,
} from './m2-agent-p0-adjudication.js'
import {
  FROZEN_P0_SYSTEM_PROMPT,
  type FrozenP0Inputs,
} from './m2-agent-p0-definition.js'
import { createFrozenP0ToolRuntime } from './m2-agent-p0-tool-runtime.js'
import {
  executeProcessAttemptWithEvidence,
  type ProcessAttemptEvidenceRecord,
  type ProcessModelOutcomeEvidenceRecord,
} from './m2-agent-process-runner.js'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default
const schemaUrl = new URL('../../docs/evaluation/m2/m2-agent-eval-v2.schema.json', import.meta.url)
const NO_ORDINARY_WORKSPACE_DOMAIN = 'dsh-toolchain-m2-p0-no-ordinary-workspace-v1'
const NO_ORDINARY_EVIDENCE_DOMAIN = 'dsh-toolchain-m2-p0-no-ordinary-evidence-v1'

export interface P0ProcessConfiguration {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly maxStdoutBytes: number
  readonly maxStderrBytes: number
}

export interface P0RunResult {
  readonly definition: Record<string, unknown>
  readonly result: Record<string, unknown>
}

interface FrozenExecutionValues {
  readonly evaluationId: string
  readonly datasetCommitmentSha256: string
  readonly targetFingerprint: string
  readonly contractIndexFingerprint: string
  readonly resourcePolicy: ResourcePolicy
  readonly retryPolicy: AgentRetryPolicy
  readonly executorIdentity: Record<string, unknown>
}

interface CanonicalApiClaim {
  readonly text: string
  readonly classification: 'VALID' | 'INVALID' | 'UNKNOWN'
  readonly oracleEvidenceIds: readonly string[]
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

function contentRef(value: unknown, label: string): ContentRef {
  return requireRecord(value, label) as unknown as ContentRef
}

function parseContentJson(ref: ContentRef, label: string): Record<string, unknown> {
  try {
    return requireRecord(JSON.parse(ref.inline), `${label} retained JSON`)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} retained bytes are not JSON`)
    throw error
  }
}

function parseResourcePolicy(value: unknown): ResourcePolicy {
  const record = requireRecord(value, 'P0 resource policy')
  return {
    maxWallTimeMs: requireInteger(record.maxWallTimeMs, 'P0 maxWallTimeMs', 1),
    maxTurns: requireInteger(record.maxTurns, 'P0 maxTurns', 1),
    maxAttempts: requireInteger(record.maxAttempts, 'P0 maxAttempts', 1),
    concurrency: requireInteger(record.concurrency, 'P0 concurrency', 1),
    maxInputTokens: requireInteger(record.maxInputTokens, 'P0 maxInputTokens', 1),
    maxOutputTokens: requireInteger(record.maxOutputTokens, 'P0 maxOutputTokens', 1),
    tokenMeasurementRequired: record.tokenMeasurementRequired === true,
  }
}

function parseRetryPolicy(value: unknown): AgentRetryPolicy {
  const record = requireRecord(value, 'P0 retry policy')
  const reasons = record.retryableReasons
  if (!Array.isArray(reasons) || !reasons.every(reason => typeof reason === 'string')) {
    throw new Error('P0 retryableReasons must be a string array')
  }
  if (record.modelOutcomeRetries !== 0) throw new Error('P0 modelOutcomeRetries must remain zero')
  return {
    maxInfrastructureRetries: requireInteger(record.maxInfrastructureRetries, 'P0 maxInfrastructureRetries'),
    modelOutcomeRetries: 0,
    retryableReasons: reasons as string[],
  }
}

function frozenExecutionValues(frozen: FrozenP0Inputs): FrozenExecutionValues {
  const definition = requireRecord(frozen.definition, 'P0 definition')
  const target = requireRecord(definition.target, 'P0 target')
  const dataset = requireRecord(definition.dataset, 'P0 dataset binding')
  const execution = requireRecord(definition.execution, 'P0 execution')
  const resourceRef = contentRef(execution.resourcePolicy, 'P0 resource policy ref')
  const retryRef = contentRef(execution.retryPolicy, 'P0 retry policy ref')
  const executorRef = contentRef(execution.executorIdentity, 'P0 executor identity ref')
  return {
    evaluationId: requireString(definition.evaluationId, 'P0 evaluationId'),
    datasetCommitmentSha256: requireString(dataset.commitmentSha256, 'P0 dataset commitment'),
    targetFingerprint: requireString(target.targetFingerprint, 'P0 target fingerprint'),
    contractIndexFingerprint: requireString(target.contractIndexFingerprint, 'P0 Contract Index fingerprint'),
    resourcePolicy: parseResourcePolicy(parseContentJson(resourceRef, 'P0 resource policy')),
    retryPolicy: parseRetryPolicy(parseContentJson(retryRef, 'P0 retry policy')),
    executorIdentity: parseContentJson(executorRef, 'P0 executor identity'),
  }
}

function canonicalClaim(claim: ClassifiedP0ApiClaim): CanonicalApiClaim {
  return Object.freeze({
    text: `package=${claim.package} symbol=${claim.symbol} assertion=${claim.assertion}`,
    classification: claim.classification,
    oracleEvidenceIds: Object.freeze([...claim.evidenceIds]),
  })
}

function modelOutcomeWithAdjudication(
  attempt: ProcessModelOutcomeEvidenceRecord,
  adjudication: Awaited<ReturnType<typeof adjudicateP0ModelOutcome>>,
): ProcessModelOutcomeEvidenceRecord {
  return {
    ...attempt,
    parsedApiClaims: adjudication.parsedApiClaims.map(canonicalClaim),
    taskSuccess: adjudication.taskSuccess,
  }
}

async function isolationId(
  sha256: Sha256Port,
  domain: 'session' | 'environment',
  definitionSha256: string,
  taskId: string,
  arm: AgentArm,
  trial: 1 | 2 | 3,
  attempt: number,
): Promise<string> {
  return sha256.sha256Utf8(
    `dsh-toolchain-m2-p0-${domain}-v1\u0000${definitionSha256}\u0000${taskId}\u0000${arm}\u0000${trial}\u0000${attempt}`,
  )
}

async function noOrdinaryHash(sha256: Sha256Port, domain: string): Promise<string> {
  return sha256.sha256Utf8(domain)
}

function canRetry(
  attempt: ProcessAttemptEvidenceRecord,
  attemptNumber: number,
  retryPolicy: AgentRetryPolicy,
): boolean {
  return attempt.outcome === 'infrastructure-failure'
    && retryPolicy.retryableReasons.includes(attempt.reason)
    && attemptNumber <= retryPolicy.maxInfrastructureRetries
}

function modelOutcomeResolved(arm: AgentArm, attempt: ProcessModelOutcomeEvidenceRecord): boolean {
  const resource = parseContentJson(attempt.executionEvidence.resourceReceipt, 'P0 resource receipt')
  if (resource.compliance !== 'compliant') return false
  if (arm === 'A') return true
  if (attempt.taskSuccess === 'UNKNOWN') return false
  const claims = attempt.parsedApiClaims as readonly CanonicalApiClaim[]
  return claims.every(claim => claim.classification !== 'UNKNOWN')
}

let schemaValidatorPromise: Promise<ReturnType<InstanceType<typeof Ajv2020>['compile']>> | undefined

async function schemaValidator() {
  schemaValidatorPromise ??= (async () => {
    const schema = JSON.parse(await readFile(schemaUrl, 'utf8')) as object
    const ajv = new Ajv2020({ allErrors: true, strict: true })
    addFormats(ajv)
    return ajv.compile(schema)
  })()
  return schemaValidatorPromise
}

async function validateV2Schema(value: unknown, label: string): Promise<void> {
  const validate = await schemaValidator()
  if (!validate(value)) {
    const details = validate.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ') ?? 'unknown schema error'
    throw new Error(`${label} failed m2-agent-eval-v2 schema validation: ${details}`)
  }
}

export async function executeFrozenP0(
  frozen: FrozenP0Inputs,
  processConfiguration: P0ProcessConfiguration,
): Promise<P0RunResult> {
  const sha256 = createNodeSha256Port()
  const definitionHash = await hashEvaluationDefinition(frozen.definition, sha256)
  if (definitionHash !== frozen.definitionSha256) throw new Error('Frozen P0 definition hash drifted before execution')
  if (frozen.schedule.length !== 72) throw new Error(`Frozen P0 schedule must contain exactly 72 runs, got ${frozen.schedule.length}`)
  await validateV2Schema(frozen.definition, 'P0 definition')

  const values = frozenExecutionValues(frozen)
  if (values.resourcePolicy.concurrency !== 1) throw new Error('Canonical P0 runner requires concurrency=1')
  const tasks = new Map(frozen.dataset.tasks.map(task => [task.id, task]))
  const noWorkspaceSha256 = await noOrdinaryHash(sha256, NO_ORDINARY_WORKSPACE_DOMAIN)
  const noEvidenceSha256 = await noOrdinaryHash(sha256, NO_ORDINARY_EVIDENCE_DOMAIN)
  const runs: Array<Record<string, unknown>> = []
  let conclusive = true

  for (const entry of frozen.schedule) {
    const sourceTask = tasks.get(entry.taskId)
    if (sourceTask === undefined) throw new Error(`Frozen P0 schedule references unknown task ${entry.taskId}`)
    const capabilityManifest = frozen.capabilityManifests[entry.arm]
    const modelEnvelope = createModelEnvelope({
      systemPrompt: FROZEN_P0_SYSTEM_PROMPT,
      task: createModelTask(sourceTask),
      staticContext: [],
      capabilityManifest,
    })
    const attempts: ProcessAttemptEvidenceRecord[] = []
    let attemptNumber = 1

    while (true) {
      const [sessionIdSha256, mutableEnvironmentIdSha256] = await Promise.all([
        isolationId(sha256, 'session', frozen.definitionSha256, entry.taskId, entry.arm, entry.trial, attemptNumber),
        isolationId(sha256, 'environment', frozen.definitionSha256, entry.taskId, entry.arm, entry.trial, attemptNumber),
      ])
      const hasOrdinaryEvidence = entry.arm !== 'A'
      const executed = await executeProcessAttemptWithEvidence({
        identity: {
          evaluationId: values.evaluationId,
          phase: 'P0',
          taskId: entry.taskId,
          arm: entry.arm,
          trial: entry.trial,
          attempt: attemptNumber,
          targetFingerprint: values.targetFingerprint,
          contractIndexFingerprint: values.contractIndexFingerprint,
          datasetCommitmentSha256: values.datasetCommitmentSha256,
        },
        capabilityManifest,
        resourcePolicy: values.resourcePolicy,
        retryPolicy: values.retryPolicy,
        executorIdentity: values.executorIdentity,
        modelEnvelope,
        isolation: {
          sessionIdSha256,
          workspaceMode: hasOrdinaryEvidence ? 'read-only-reset' : 'fresh',
          workspaceSnapshotSha256: hasOrdinaryEvidence
            ? frozen.workspace.workspaceSnapshotSha256
            : noWorkspaceSha256,
          ordinaryEvidenceSha256: hasOrdinaryEvidence
            ? frozen.workspace.documentationSha256
            : noEvidenceSha256,
          mutableEnvironmentIdSha256,
        },
        process: {
          command: processConfiguration.command,
          args: processConfiguration.args,
          cwd: processConfiguration.cwd,
          environment: processConfiguration.environment,
          timeoutMs: processConfiguration.timeoutMs,
          maxStdoutBytes: processConfiguration.maxStdoutBytes,
          maxStderrBytes: processConfiguration.maxStderrBytes,
        },
        createToolRuntime: runControlSha256 => createFrozenP0ToolRuntime(runControlSha256, frozen.workspace),
        sha256,
      })

      if (executed.attempt.outcome === 'model-outcome') {
        let finalAttempt: ProcessModelOutcomeEvidenceRecord
        try {
          finalAttempt = modelOutcomeWithAdjudication(
            executed.attempt,
            await adjudicateP0ModelOutcome(entry.taskId, executed.attempt.rawAnswer.inline),
          )
        } catch {
          finalAttempt = executed.attempt
        }
        attempts.push(finalAttempt)
        if (!modelOutcomeResolved(entry.arm, finalAttempt)) conclusive = false
        break
      }

      attempts.push(executed.attempt)
      if (!canRetry(executed.attempt, attemptNumber, values.retryPolicy)) {
        conclusive = false
        break
      }
      attemptNumber += 1
    }

    runs.push({ taskId: entry.taskId, arm: entry.arm, trial: entry.trial, attempts })
  }

  const result: Record<string, unknown> = {
    ...structuredClone(frozen.definition),
    recordType: 'result',
    status: conclusive ? 'CALIBRATED' : 'INCONCLUSIVE',
    definitionSha256: frozen.definitionSha256,
    executedAt: new Date().toISOString(),
    runs,
  }
  await validateV2Schema(result, 'P0 result')
  await validateAgentV2ResultAgainstDefinition(frozen.definition, result, sha256)
  return Object.freeze({ definition: frozen.definition, result })
}
