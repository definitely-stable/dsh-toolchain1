import { readFile } from 'node:fs/promises'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  canonicalizeEvaluationJson,
  createBalancedAgentSchedule,
  hashEvaluationDefinition,
  validateBalancedAgentSchedule,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  validateCapabilityManifests,
  type CapabilityManifest,
  type ContentRef,
} from './m2-agent-execution-evidence.js'
import { createFrozenP0CapabilityManifests } from './m2-agent-ordinary-broker.js'
import {
  validateOrdinaryWorkspace,
  type OrdinaryWorkspace,
} from './m2-agent-ordinary-workspace.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

const TARGET_FINGERPRINT = 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe'
const CONTRACT_INDEX_FINGERPRINT = 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2'
const ORDINARY_WORKSPACE_SHA256 = 'ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413'
const ORDINARY_DOCUMENTATION_SHA256 = '9325818edcb90fd4ea8d870c6dad3c438cdbc9b72c744d4807b76c2aacc1cacf'
const SCHEDULE_SEED = 'm2-p0-calibration-v1'
const EXPECTED_TASK_IDS = Object.freeze([
  'p0-01',
  'p0-02',
  'p0-03',
  'p0-04',
  'p0-05',
  'p0-06',
  'p0-07',
  'p0-08',
])

export const FROZEN_P0_SYSTEM_PROMPT = `You are evaluating public APIs on one exact installed DeepSeek Harness target. Use only evidence available in this run. Do not use knowledge from newer DSH versions. Keep the answer concise. For every concrete API existence claim, emit one line before the explanation using exactly:
API_CLAIM package=<package-or-*> symbol=<symbol> assertion=<exists|absent>
Use package=* only for a target-wide absence claim. Do not emit an API_CLAIM for vague behavioral statements. Then give a brief plain-language explanation.`

export interface FrozenP0ProviderIdentity {
  provider: 'deepseek'
  requestModel: string
  reviewedSnapshot: string
  expectedResponseModel: string
  expectedSystemFingerprint: string
  thinking: 'enabled' | 'disabled'
  reasoningEffort: 'low' | 'high' | 'max'
  baseUrl: string
  adapterVersion: 'deepseek-chat-v1'
}

export interface P0Task {
  readonly id: string
  readonly domain: string
  readonly intent: string
  readonly prompt: string
  readonly oracleHints: unknown
  readonly successCriteria: readonly string[]
  readonly [key: string]: unknown
}

export interface P0Dataset {
  readonly schema: 'dsh-toolchain-m2-agent-dataset-v1'
  readonly datasetId: 'P0'
  readonly status: 'FROZEN-NON-SCORING'
  readonly purpose: string
  readonly target: {
    readonly package: '@deepseek-ai/dsh'
    readonly version: '0.1.1-rc.2'
    readonly profile: 'web'
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
  }
  readonly taskCount: 8
  readonly tasks: readonly P0Task[]
  readonly policy: Record<string, unknown>
}

export interface P0Oracle {
  readonly schema: 'dsh-toolchain-m2-api-oracle-v1'
  readonly version: 'api-oracle-v1'
  readonly status: 'FROZEN'
  readonly target: {
    readonly package: '@deepseek-ai/dsh'
    readonly version: '0.1.1-rc.2'
    readonly profile: 'web'
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
  }
  readonly classifications: readonly ['VALID', 'INVALID', 'UNKNOWN']
  readonly unknownAutoInvalid: false
  readonly [key: string]: unknown
}

export interface FrozenP0Inputs {
  readonly dataset: P0Dataset
  readonly oracle: P0Oracle
  readonly workspace: OrdinaryWorkspace
  readonly capabilityManifests: {
    readonly A: CapabilityManifest
    readonly B: CapabilityManifest
    readonly C: CapabilityManifest
  }
  readonly schedule: readonly AgentScheduleEntry[]
  readonly definition: Record<string, unknown>
  readonly definitionSha256: string
}

const datasetUrl = new URL('../../docs/evaluation/m2/agent-pilot-p0.json', import.meta.url)
const oracleUrl = new URL('../../docs/evaluation/m2/api-oracle-v1.json', import.meta.url)
const workspaceUrl = new URL('./fixtures/m2/rc2-web-v1/ordinary-workspace.json', import.meta.url)

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be non-empty`)
  return value
}

function assertProvider(provider: FrozenP0ProviderIdentity): void {
  if (provider.provider !== 'deepseek') throw new Error('P0 provider must be deepseek')
  requireNonEmptyString(provider.requestModel, 'P0 request model')
  requireNonEmptyString(provider.reviewedSnapshot, 'P0 reviewed snapshot')
  requireNonEmptyString(provider.expectedResponseModel, 'P0 expected response model')
  requireNonEmptyString(provider.expectedSystemFingerprint, 'P0 expected system fingerprint')
  requireNonEmptyString(provider.baseUrl, 'P0 provider baseUrl')
  if (provider.adapterVersion !== 'deepseek-chat-v1') throw new Error('Unsupported P0 provider adapter version')
  if (provider.thinking !== 'enabled' && provider.thinking !== 'disabled') throw new Error('Unsupported P0 thinking mode')
  if (!['low', 'high', 'max'].includes(provider.reasoningEffort)) throw new Error('Unsupported P0 reasoning effort')
  let url: URL
  try {
    url = new URL(provider.baseUrl)
  } catch {
    throw new Error('P0 provider baseUrl must be an absolute URL')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('P0 provider baseUrl must not contain credentials, query or fragment')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('P0 provider baseUrl must use http or https')
  }
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T
}

function assertExactTarget(targetValue: unknown, label: string): void {
  const target = requireRecord(targetValue, label)
  if (target.package !== '@deepseek-ai/dsh') throw new Error(`${label} package drifted`)
  if (target.version !== '0.1.1-rc.2') throw new Error(`${label} version drifted`)
  if (target.profile !== 'web') throw new Error(`${label} profile drifted`)
  if (target.targetFingerprint !== TARGET_FINGERPRINT) throw new Error(`${label} target fingerprint drifted`)
  if (target.contractIndexFingerprint !== CONTRACT_INDEX_FINGERPRINT) {
    throw new Error(`${label} Contract Index fingerprint drifted`)
  }
}

function validateDataset(dataset: P0Dataset): void {
  if (dataset.schema !== 'dsh-toolchain-m2-agent-dataset-v1') throw new Error('P0 dataset schema drifted')
  if (dataset.datasetId !== 'P0') throw new Error('P0 dataset id drifted')
  if (dataset.status !== 'FROZEN-NON-SCORING') throw new Error('P0 dataset status drifted')
  if (dataset.taskCount !== 8 || dataset.tasks.length !== 8) throw new Error('P0 dataset must contain exactly eight tasks')
  assertExactTarget(dataset.target, 'P0 dataset target')

  const ids = dataset.tasks.map(task => requireNonEmptyString(task.id, 'P0 task id'))
  if (new Set(ids).size !== ids.length) throw new Error('P0 dataset task ids must be unique')
  if (canonicalizeEvaluationJson(ids.toSorted()) !== canonicalizeEvaluationJson([...EXPECTED_TASK_IDS].toSorted())) {
    throw new Error('P0 dataset task ids drifted')
  }
  for (const task of dataset.tasks) requireNonEmptyString(task.prompt, `P0 task ${task.id} prompt`)
}

function validateOracle(oracle: P0Oracle): void {
  if (oracle.schema !== 'dsh-toolchain-m2-api-oracle-v1') throw new Error('P0 oracle schema drifted')
  if (oracle.version !== 'api-oracle-v1' || oracle.status !== 'FROZEN') throw new Error('P0 oracle identity drifted')
  assertExactTarget(oracle.target, 'P0 oracle target')
  if (canonicalizeEvaluationJson(oracle.classifications) !== canonicalizeEvaluationJson(['VALID', 'INVALID', 'UNKNOWN'])) {
    throw new Error('P0 oracle classifications drifted')
  }
  if (oracle.unknownAutoInvalid !== false) throw new Error('P0 oracle must keep UNKNOWN distinct from INVALID')
}

function jsonContentRef(value: unknown, sha256 = createNodeSha256Port()): Promise<ContentRef> {
  return createInlineContentRef(
    canonicalizeEvaluationJson(value),
    'application/json',
    'utf8-bytes-v1',
    sha256,
  )
}

function p0Resources() {
  return Object.freeze({
    maxTurns: 12,
    maxInputTokens: 30_000,
    maxOutputTokens: 6_000,
    wallTimeMs: 300_000,
    concurrency: 1,
  })
}

function p0ResourcePolicy() {
  return Object.freeze({
    maxWallTimeMs: 300_000,
    maxTurns: 12,
    maxAttempts: 2,
    concurrency: 1,
    maxInputTokens: 30_000,
    maxOutputTokens: 6_000,
    tokenMeasurementRequired: true,
  })
}

function p0RetryPolicy() {
  return Object.freeze({
    maxInfrastructureRetries: 1,
    modelOutcomeRetries: 0 as const,
    retryableReasons: ['provider-transport', 'tool-transport'] as const,
  })
}

function p0Metrics() {
  return Object.freeze({
    primary: {
      name: 'invalid-api-task-rate',
      comparison: 'C-vs-B',
      trialToTaskAggregation: 'mean-trial-invalid-indicator',
      mcidAbsoluteReduction: null,
      uncertainty: {
        method: 'paired-task-bootstrap',
        confidenceLevel: 0.95,
        resamples: 10_000,
        seed: 'm2-v2-primary',
        decisionRule: 'lower-bound-at-least-mcid',
      },
    },
    guardrail: {
      name: 'task-success-noninferiority',
      trialToTaskAggregation: 'mean-trial-success-indicator',
      margin: null,
      uncertainty: {
        method: 'paired-task-bootstrap',
        confidenceLevel: 0.95,
        resamples: 10_000,
        seed: 'm2-v2-guardrail',
        decisionRule: 'lower-bound-at-least-negative-margin',
      },
    },
    secondary: ['toolchain-use-rate', 'wall-time'],
  })
}

export async function createFrozenP0Inputs(
  provider: FrozenP0ProviderIdentity,
): Promise<FrozenP0Inputs> {
  assertProvider(provider)
  const sha256 = createNodeSha256Port()
  const [dataset, oracle, workspace] = await Promise.all([
    readJson<P0Dataset>(datasetUrl),
    readJson<P0Oracle>(oracleUrl),
    readJson<OrdinaryWorkspace>(workspaceUrl),
  ])
  validateDataset(dataset)
  validateOracle(oracle)
  await validateOrdinaryWorkspace(workspace, sha256)
  if (workspace.workspaceSnapshotSha256 !== ORDINARY_WORKSPACE_SHA256) {
    throw new Error('P0 ordinary workspace identity drifted')
  }
  if (workspace.documentationSha256 !== ORDINARY_DOCUMENTATION_SHA256) {
    throw new Error('P0 ordinary documentation identity drifted')
  }
  if (
    workspace.target.targetFingerprint !== TARGET_FINGERPRINT
    || workspace.target.contractIndexFingerprint !== CONTRACT_INDEX_FINGERPRINT
  ) {
    throw new Error('P0 ordinary workspace target/index drifted')
  }

  const toolchain = await createFrozenToolchainBroker('0'.repeat(64))
  const capabilityManifests = createFrozenP0CapabilityManifests(workspace, toolchain)
  validateCapabilityManifests(capabilityManifests)

  const taskIds = dataset.tasks.map(task => task.id)
  const schedule = await createBalancedAgentSchedule(taskIds, SCHEDULE_SEED, sha256)
  validateBalancedAgentSchedule(schedule, taskIds)

  const modelTasks = dataset.tasks.map(task => ({ id: task.id, prompt: task.prompt }))
  const [systemPromptSha256, taskPromptSha256, toolSchemaSha256, datasetCommitmentSha256, oracleSha256] = await Promise.all([
    sha256.sha256Utf8(FROZEN_P0_SYSTEM_PROMPT),
    sha256.sha256Utf8(canonicalizeEvaluationJson(modelTasks)),
    sha256.sha256Utf8(canonicalizeEvaluationJson({
      A: capabilityManifests.A.tools,
      B: capabilityManifests.B.tools,
      C: capabilityManifests.C.tools,
    })),
    sha256.sha256Utf8(canonicalizeEvaluationJson(dataset)),
    sha256.sha256Utf8(canonicalizeEvaluationJson(oracle)),
  ])

  const retryPolicy = p0RetryPolicy()
  const resourcePolicy = p0ResourcePolicy()
  const runnerIdentityValue = {
    runner: 'dsh-m2-isolated-runner',
    version: '2',
    executorProtocol: 'closed-ndjson-v1',
    scheduleSeed: SCHEDULE_SEED,
  }
  const executorIdentityValue = {
    provider: provider.provider,
    requestModel: provider.requestModel,
    reviewedSnapshot: provider.reviewedSnapshot,
    expectedResponseModel: provider.expectedResponseModel,
    expectedSystemFingerprint: provider.expectedSystemFingerprint,
    thinking: provider.thinking,
    reasoningEffort: provider.reasoningEffort,
    baseUrl: provider.baseUrl,
    adapterVersion: provider.adapterVersion,
  }

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
    evaluationId: 'm2-agent-p0-v2',
    phase: 'P0',
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
      snapshot: provider.reviewedSnapshot,
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
    resources: p0Resources(),
    retries: retryPolicy,
    runOrder: {
      seed: SCHEDULE_SEED,
      trialsPerTaskArm: 3,
      schedule,
    },
    metrics: p0Metrics(),
    oracle: {
      version: 'api-oracle-v1',
      sha256: oracleSha256,
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    },
    dataset: {
      id: 'P0',
      taskCount: dataset.taskCount,
      commitmentSha256: datasetCommitmentSha256,
      hiddenUntilRunComplete: false,
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
  return Object.freeze({
    dataset,
    oracle,
    workspace,
    capabilityManifests,
    schedule,
    definition,
    definitionSha256,
  })
}
