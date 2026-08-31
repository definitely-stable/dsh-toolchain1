import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  createBalancedAgentSchedule,
  hashEvaluationDefinition,
  validateBalancedAgentSchedule,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  validateCapabilityManifests,
  type CapabilityManifest,
  type ContentRef,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { createFrozenP0CapabilityManifests } from './m2-agent-ordinary-broker.js'
import {
  validateOrdinaryWorkspace,
  type OrdinaryWorkspace,
} from './m2-agent-ordinary-workspace.js'
import { FROZEN_P0_SYSTEM_PROMPT } from './m2-agent-p0-definition.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import { evaluateH1ReadinessV2 } from './m2-h1-readiness-v2.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'

const TARGET_FINGERPRINT = 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe'
const CONTRACT_INDEX_FINGERPRINT = 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2'
const ORDINARY_WORKSPACE_SHA256 = 'ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413'
const ORDINARY_DOCUMENTATION_SHA256 = '9325818edcb90fd4ea8d870c6dad3c438cdbc9b72c744d4807b76c2aacc1cacf'
const TRUTH_FINGERPRINT = 'dsh-api-truth-v2:14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb'
const TRUTH_SHA256 = '14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb'
const SCHEDULE_SEED = 'm2-h1-holdout-v2'
const EXPECTED_TASK_COUNT = 96
const EXPECTED_SCHEDULE_COUNT = 864

export const FROZEN_H1_SYSTEM_PROMPT = FROZEN_P0_SYSTEM_PROMPT

export interface FrozenH1ExecutionDefinitionV2 {
  readonly definition: Record<string, unknown>
  readonly definitionSha256: string
  readonly modelTasks: readonly { readonly id: string; readonly prompt: string }[]
  readonly schedule: readonly AgentScheduleEntry[]
  readonly capabilityManifests: Readonly<Record<'A' | 'B' | 'C', CapabilityManifest>>
  readonly resourcePolicy: ResourcePolicy
  readonly retryPolicy: AgentRetryPolicy
  readonly ledgerBinding: H1LedgerBindingV2
}

function h1ResourcePolicy(): ResourcePolicy {
  return Object.freeze({
    maxWallTimeMs: 300_000,
    maxTurns: 32,
    maxAttempts: 2,
    concurrency: 1,
    maxInputTokens: 180_000,
    maxOutputTokens: 12_000,
    tokenMeasurementRequired: true,
  })
}

function h1RetryPolicy(): AgentRetryPolicy {
  return Object.freeze({
    maxInfrastructureRetries: 1,
    modelOutcomeRetries: 0,
    retryableReasons: Object.freeze(['provider-transport', 'tool-transport']),
  })
}

function h1Resources() {
  return Object.freeze({
    maxTurns: 32,
    maxInputTokens: 180_000,
    maxOutputTokens: 12_000,
    wallTimeMs: 300_000,
    concurrency: 1,
  })
}

function h1Metrics(finalization: H1FinalizationResultV2) {
  const primary = finalization.commitment.analysis.primary
  const guardrail = finalization.commitment.analysis.guardrail
  return Object.freeze({
    primary: {
      name: primary.metric,
      comparison: primary.comparison,
      trialToTaskAggregation: primary.trialToTaskAggregation,
      mcidAbsoluteReduction: finalization.commitment.thresholds.mcidAbsoluteReduction,
      uncertainty: {
        method: primary.uncertainty.method,
        confidenceLevel: primary.uncertainty.confidenceLevel,
        sidedness: primary.uncertainty.sidedness,
        lowerQuantile: primary.uncertainty.lowerQuantile,
        resamples: primary.uncertainty.resamples,
        seed: primary.uncertainty.seed,
        decisionRule: primary.uncertainty.decisionRule,
      },
    },
    guardrail: {
      name: guardrail.metric,
      trialToTaskAggregation: guardrail.trialToTaskAggregation,
      margin: finalization.commitment.thresholds.taskSuccessNoninferiorityMargin,
      uncertainty: {
        method: guardrail.uncertainty.method,
        confidenceLevel: guardrail.uncertainty.confidenceLevel,
        sidedness: guardrail.uncertainty.sidedness,
        lowerQuantile: guardrail.uncertainty.lowerQuantile,
        resamples: guardrail.uncertainty.resamples,
        seed: guardrail.uncertainty.seed,
        decisionRule: guardrail.uncertainty.decisionRule,
      },
    },
    secondary: ['toolchain-use-rate', 'wall-time'],
  })
}

async function jsonContentRef(value: unknown, sha256: Sha256Port): Promise<ContentRef> {
  return createInlineContentRef(
    canonicalizeEvaluationJson(value),
    'application/json',
    'utf8-bytes-v1',
    sha256,
  )
}

function assertFinalizationReady(finalization: H1FinalizationResultV2): void {
  const readiness = finalization.readiness
  if (readiness.status !== 'READY' || !readiness.runAllowed || readiness.blockers.length !== 0) {
    throw new Error('H1 execution definition requires an internally consistent READY finalization result')
  }
  const recomputed = evaluateH1ReadinessV2(finalization.commitment)
  if (recomputed.status !== 'READY' || !recomputed.runAllowed || recomputed.blockers.length !== 0) {
    throw new Error('H1 execution definition finalization commitment no longer satisfies readiness')
  }
  if (finalization.commitment.status !== 'COMMITTED') {
    throw new Error('H1 execution definition requires a COMMITTED finalization commitment')
  }
  if (finalization.commitment.measurement.truthFingerprint !== TRUTH_FINGERPRINT) {
    throw new Error('H1 execution definition Truth v2 identity drifted')
  }
  if (
    finalization.commitment.hiddenDataset.taskCount !== EXPECTED_TASK_COUNT
    || finalization.modelTasks.length !== EXPECTED_TASK_COUNT
    || finalization.construction.taskCount !== EXPECTED_TASK_COUNT
  ) {
    throw new Error('H1 execution definition requires the finalized 96-task holdout')
  }
}

async function assertModelTaskProjection(
  finalization: H1FinalizationResultV2,
  sha256: Sha256Port,
): Promise<string> {
  const seen = new Set<string>()
  for (const task of finalization.modelTasks) {
    if (Object.keys(task).join(',') !== 'id,prompt') {
      throw new Error('H1 model task projection may contain only id and prompt')
    }
    if (task.id.trim().length === 0 || task.prompt.trim().length === 0) {
      throw new Error('H1 model task projection requires non-empty id and prompt')
    }
    if (seen.has(task.id)) throw new Error(`H1 model task projection contains duplicate id ${task.id}`)
    seen.add(task.id)
  }
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalization.modelTasks))
  if (digest !== finalization.commitment.hiddenDataset.modelTaskProjectionSha256) {
    throw new Error('H1 model task projection hash drifted from the finalized commitment')
  }
  return digest
}

async function assertExactWorkspace(workspace: OrdinaryWorkspace, sha256: Sha256Port): Promise<void> {
  await validateOrdinaryWorkspace(workspace, sha256)
  if (workspace.workspaceSnapshotSha256 !== ORDINARY_WORKSPACE_SHA256) {
    throw new Error('H1 ordinary workspace snapshot identity drifted')
  }
  if (workspace.documentationSha256 !== ORDINARY_DOCUMENTATION_SHA256) {
    throw new Error('H1 ordinary workspace documentation identity drifted')
  }
  if (
    workspace.target.targetFingerprint !== TARGET_FINGERPRINT
    || workspace.target.contractIndexFingerprint !== CONTRACT_INDEX_FINGERPRINT
  ) {
    throw new Error('H1 ordinary workspace target/index identity drifted')
  }
}

export async function createFrozenH1ExecutionDefinitionV2(
  finalization: H1FinalizationResultV2,
  workspace: OrdinaryWorkspace,
  sha256: Sha256Port,
): Promise<FrozenH1ExecutionDefinitionV2> {
  assertFinalizationReady(finalization)
  await assertExactWorkspace(workspace, sha256)
  const taskPromptSha256 = await assertModelTaskProjection(finalization, sha256)

  const provider = finalization.commitment.provider
  if (provider === null || provider.identityReceiptSha256 === null) {
    throw new Error('H1 execution definition requires a finalized managed-gateway provider identity')
  }

  const toolchain = await createFrozenToolchainBroker('0'.repeat(64))
  const capabilityManifests = createFrozenP0CapabilityManifests(workspace, toolchain)
  validateCapabilityManifests(capabilityManifests)

  const taskIds = finalization.modelTasks.map(task => task.id)
  const schedule = await createBalancedAgentSchedule(taskIds, SCHEDULE_SEED, sha256)
  validateBalancedAgentSchedule(schedule, taskIds)
  if (schedule.length !== EXPECTED_SCHEDULE_COUNT) {
    throw new Error(`H1 frozen schedule must contain exactly ${EXPECTED_SCHEDULE_COUNT} entries`)
  }

  const resourcePolicy = h1ResourcePolicy()
  const retryPolicy = h1RetryPolicy()
  const h1CommitmentSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalization.commitment))
  const systemPromptSha256 = await sha256.sha256Utf8(FROZEN_H1_SYSTEM_PROMPT)
  const toolSchemaSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson({
    A: capabilityManifests.A.tools,
    B: capabilityManifests.B.tools,
    C: capabilityManifests.C.tools,
  }))

  const runnerIdentityValue = Object.freeze({
    runner: 'dsh-m2-isolated-runner',
    version: '2',
    executorProtocol: 'closed-ndjson-v1',
    scheduleSeed: SCHEDULE_SEED,
    h1CommitmentSha256,
    datasetCommitmentSha256: finalization.commitment.hiddenDataset.sha256,
    modelTaskProjectionSha256: taskPromptSha256,
    providerIdentityReceiptSha256: provider.identityReceiptSha256,
    measurement: structuredClone(finalization.commitment.measurement),
    prospectiveDesign: structuredClone(finalization.commitment.prospectiveDesign),
    thresholds: structuredClone(finalization.commitment.thresholds),
    analysis: structuredClone(finalization.commitment.analysis),
  })
  const executorIdentityValue = Object.freeze({
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    requestModel: provider.requestModel,
    expectedResponseModel: provider.responseModel,
    adapterVersion: provider.adapterVersion,
    thinking: provider.thinking,
    reasoningEffort: provider.reasoningEffort,
    identityMode: provider.identityMode,
    providerIdentityReceiptSha256: provider.identityReceiptSha256,
  })

  const [runnerIdentity, executorIdentity, manifestA, manifestB, manifestC, resourcePolicyRef, retryPolicyRef] = await Promise.all([
    jsonContentRef(runnerIdentityValue, sha256),
    jsonContentRef(executorIdentityValue, sha256),
    jsonContentRef(capabilityManifests.A, sha256),
    jsonContentRef(capabilityManifests.B, sha256),
    jsonContentRef(capabilityManifests.C, sha256),
    jsonContentRef(resourcePolicy, sha256),
    jsonContentRef(retryPolicy, sha256),
  ])

  const definition: Record<string, unknown> = {
    schema: 'dsh-toolchain-m2-agent-eval-v2',
    recordType: 'definition',
    evaluationId: 'm2-agent-h1-v2',
    phase: 'H1',
    status: 'PREREGISTERED',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: CONTRACT_INDEX_FINGERPRINT,
    },
    model: {
      provider: provider.provider,
      model: provider.requestModel,
      snapshot: `provider-identity-receipt:${provider.identityReceiptSha256}`,
      reasoning: `thinking=${provider.thinking};effort=${provider.reasoningEffort}`,
    },
    harness: {
      runner: 'dsh-m2-isolated-runner',
      version: '2',
      systemPromptSha256,
      taskPromptSha256,
      toolSchemaSha256,
      staticDocsSha256: workspace.documentationSha256,
      networkPolicy: 'provider-only',
    },
    arms: {
      A: { mode: 'memory', ordinaryTools: false, toolchain: false },
      B: { mode: 'conventional-exact-target', ordinaryTools: true, toolchain: false },
      C: {
        mode: 'conventional-exact-target-plus-toolchain',
        ordinaryTools: true,
        toolchain: true,
        toolNames: ['toolchain_contract_search', 'toolchain_contract_inspect'],
      },
    },
    resources: h1Resources(),
    retries: retryPolicy,
    runOrder: {
      seed: SCHEDULE_SEED,
      trialsPerTaskArm: 3,
      schedule,
    },
    metrics: h1Metrics(finalization),
    oracle: {
      version: 'dsh-api-truth-v2',
      sha256: TRUTH_SHA256,
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    },
    dataset: {
      id: 'H1',
      taskCount: finalization.commitment.hiddenDataset.taskCount,
      commitmentSha256: finalization.commitment.hiddenDataset.sha256,
      hiddenUntilRunComplete: true,
    },
    execution: {
      runnerIdentity,
      executorIdentity,
      capabilityManifests: { A: manifestA, B: manifestB, C: manifestC },
      resourcePolicy: resourcePolicyRef,
      retryPolicy: retryPolicyRef,
      isolationPolicy: {
        freshModelSession: true,
        memoryCarryover: false,
        workspaceModes: ['fresh', 'read-only-reset'],
        toolStateReset: true,
        parallelMutableStateShared: false,
        retrySessionPolicy: 'fresh-session-per-attempt',
      },
    },
  }

  const definitionSha256 = await hashEvaluationDefinition(definition, sha256)
  const ledgerBinding: H1LedgerBindingV2 = Object.freeze({
    definitionSha256,
    datasetCommitmentSha256: finalization.commitment.hiddenDataset.sha256,
    providerIdentityReceiptSha256: provider.identityReceiptSha256,
    expectedResponseModel: provider.responseModel,
  })

  return Object.freeze({
    definition,
    definitionSha256,
    modelTasks: Object.freeze(finalization.modelTasks.map(task => Object.freeze({ ...task }))),
    schedule: Object.freeze(schedule.map(entry => Object.freeze({ ...entry }))),
    capabilityManifests: Object.freeze(capabilityManifests),
    resourcePolicy,
    retryPolicy,
    ledgerBinding,
  })
}
