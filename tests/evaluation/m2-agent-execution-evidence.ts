import type { Sha256Port } from '../../src/model/digest.js'

import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'

export type AgentArm = 'A' | 'B' | 'C'

export interface ModelTask {
  id: string
  prompt: string
}

export interface ModelVisibleTool {
  family: 'ordinary' | 'toolchain'
  name: string
  description: string
  inputSchema: unknown
}

export interface OrdinaryEvidenceCapability {
  workspaceSnapshotSha256: string
  roots: string[]
  readOnly: true
  staticDocsSha256: string
  networkPolicy: 'offline' | 'provider-only'
  search: {
    backend: string
    version: string
    maxResults: number
  }
}

export interface CapabilityManifest {
  schema: 'dsh-toolchain-m2-capability-manifest-v1'
  arm: AgentArm
  ordinaryEvidence: OrdinaryEvidenceCapability | null
  tools: ModelVisibleTool[]
}

export interface ModelEnvelope {
  schema: 'dsh-toolchain-m2-model-envelope-v1'
  systemPrompt: string
  task: ModelTask
  staticContext: readonly unknown[]
  tools: readonly ModelVisibleTool[]
}

export interface RunControl {
  schema: 'dsh-toolchain-m2-run-control-v1'
  evaluationId: string
  phase: 'P0' | 'H1'
  taskId: string
  arm: AgentArm
  trial: 1 | 2 | 3
  attempt: number
  targetFingerprint: string
  contractIndexFingerprint: string
  datasetCommitmentSha256: string
  capabilityManifestSha256: string
  resourcePolicySha256: string
  retryPolicySha256: string
  executorIdentitySha256: string
  modelEnvelopeSha256: string
}

export interface ContentRef {
  sha256: string
  mediaType: string
  canonicalization: 'utf8-bytes-v1'
  byteLength: number
  inline: string
}

export interface RunnerToolTraceEntry {
  sequence: number
  family: 'ordinary' | 'toolchain'
  name: string
  startedAt: string
  completedAt: string
  status: 'ok' | 'error'
  request: ContentRef
  response: ContentRef
  targetFingerprint?: string
  contractIndexFingerprint?: string
}

export interface TraceReceipt {
  schema: 'dsh-toolchain-m2-trace-v1'
  runControlSha256: string
  entries: readonly RunnerToolTraceEntry[]
  traceSha256: string
}

export interface IsolationReceipt {
  schema: 'dsh-toolchain-m2-isolation-v1'
  runControlSha256: string
  sessionIdSha256: string
  freshModelSession: true
  memoryCarryover: false
  workspaceMode: 'fresh' | 'read-only-reset'
  workspaceSnapshotSha256: string
  toolStateReset: true
  ordinaryEvidenceSha256: string
  mutableEnvironmentIdSha256: string
  parallelMutableStateShared: false
  retrySessionPolicy: 'fresh-session-per-attempt'
}

export interface ResourcePolicy {
  maxWallTimeMs: number
  maxTurns: number
  maxAttempts: number
  concurrency: number
  maxInputTokens: number
  maxOutputTokens: number
  tokenMeasurementRequired: boolean
}

export interface ResourceObservation {
  wallTimeMs: number
  turns: number
  attempts: number
  inputTokens?: number
  outputTokens?: number
}

export interface ResourceMeasurement {
  wallTime: 'runner'
  turns: 'runner'
  tokens: 'provider-reported' | 'runner' | 'unavailable'
}

export interface ResourceReceipt {
  schema: 'dsh-toolchain-m2-resource-v1'
  runControlSha256: string
  configuredPolicy: ResourcePolicy
  configuredPolicySha256: string
  observed: ResourceObservation
  measurement: ResourceMeasurement
  compliance: 'compliant' | 'non-compliant' | 'unverifiable'
}

type RunControlInput = Omit<RunControl, 'schema'>

const TOOLCHAIN_SEARCH = 'toolchain_contract_search'
const TOOLCHAIN_INSPECT = 'toolchain_contract_inspect'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const EXECUTOR_OUTCOME_FIELDS = new Set(['outcome', 'finalAnswer', 'providerMetadata'])
const PROVIDER_METADATA_FIELDS = new Set([
  'completionId',
  'finishReason',
  'responseModel',
  'systemFingerprint',
  'inputTokens',
  'outputTokens',
])

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty`)
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertManifestArm(manifest: CapabilityManifest, expected: AgentArm): void {
  if (manifest.arm !== expected) {
    throw new Error(`Capability manifest ${expected} must declare arm ${expected}`)
  }
}

function assertNoToolchainTools(manifest: CapabilityManifest): void {
  if (manifest.tools.some(tool => tool.family === 'toolchain')) {
    throw new Error(`Capability manifest ${manifest.arm} must not expose Toolchain tools`)
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeEvaluationJson(left) === canonicalizeEvaluationJson(right)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function traceProjection(receipt: Omit<TraceReceipt, 'traceSha256'>): string {
  return canonicalizeEvaluationJson(receipt)
}

function validateResourcePolicy(policy: ResourcePolicy): void {
  assertPositiveInteger(policy.maxWallTimeMs, 'maxWallTimeMs')
  assertPositiveInteger(policy.maxTurns, 'maxTurns')
  assertPositiveInteger(policy.maxAttempts, 'maxAttempts')
  assertPositiveInteger(policy.concurrency, 'concurrency')
  assertPositiveInteger(policy.maxInputTokens, 'maxInputTokens')
  assertPositiveInteger(policy.maxOutputTokens, 'maxOutputTokens')
}

function computeResourceCompliance(
  policy: ResourcePolicy,
  observed: ResourceObservation,
  measurement: ResourceMeasurement,
): ResourceReceipt['compliance'] {
  if (
    observed.wallTimeMs > policy.maxWallTimeMs
    || observed.turns > policy.maxTurns
    || observed.attempts > policy.maxAttempts
    || (observed.inputTokens !== undefined && observed.inputTokens > policy.maxInputTokens)
    || (observed.outputTokens !== undefined && observed.outputTokens > policy.maxOutputTokens)
  ) {
    return 'non-compliant'
  }

  if (
    policy.tokenMeasurementRequired
    && (
      measurement.tokens === 'unavailable'
      || observed.inputTokens === undefined
      || observed.outputTokens === undefined
    )
  ) {
    return 'unverifiable'
  }

  return 'compliant'
}

export function createModelTask(source: { id: string; prompt: string; [key: string]: unknown }): ModelTask {
  assertNonEmpty(source.id, 'Model task id')
  assertNonEmpty(source.prompt, 'Model task prompt')
  return { id: source.id, prompt: source.prompt }
}

export function createModelEnvelope(input: {
  systemPrompt: string
  task: ModelTask
  staticContext: readonly unknown[]
  capabilityManifest: CapabilityManifest
}): ModelEnvelope {
  assertNonEmpty(input.systemPrompt, 'Model system prompt')
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: input.systemPrompt,
    task: { id: input.task.id, prompt: input.task.prompt },
    staticContext: structuredClone(input.staticContext),
    tools: structuredClone(input.capabilityManifest.tools),
  }
}

export function createRunControl(input: RunControlInput): RunControl {
  assertNonEmpty(input.evaluationId, 'RunControl evaluationId')
  assertNonEmpty(input.taskId, 'RunControl taskId')
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('RunControl attempt must be a positive integer')
  }
  return { schema: 'dsh-toolchain-m2-run-control-v1', ...input }
}

export async function hashCapabilityManifest(
  manifest: CapabilityManifest,
  sha256: Sha256Port,
): Promise<string> {
  return sha256.sha256Utf8(canonicalizeEvaluationJson(manifest))
}

export function validateCapabilityManifests(manifests: {
  A: CapabilityManifest
  B: CapabilityManifest
  C: CapabilityManifest
}): void {
  const { A, B, C } = manifests
  assertManifestArm(A, 'A')
  assertManifestArm(B, 'B')
  assertManifestArm(C, 'C')

  if (A.ordinaryEvidence !== null || A.tools.length !== 0) {
    throw new Error('Capability manifest A must expose no exact-target evidence or tools')
  }

  if (B.ordinaryEvidence === null || C.ordinaryEvidence === null) {
    throw new Error('Capability manifests B and C require ordinary exact-target evidence')
  }
  assertNoToolchainTools(B)

  if (!canonicalEqual(B.ordinaryEvidence, C.ordinaryEvidence)) {
    throw new Error('Capability manifest C ordinary evidence must equal B exactly')
  }

  if (C.tools.length !== B.tools.length + 2) {
    throw new Error('Capability manifest C must equal B plus exactly two Toolchain tools')
  }

  for (let index = 0; index < B.tools.length; index += 1) {
    if (!canonicalEqual(B.tools[index], C.tools[index])) {
      throw new Error('Capability manifest C ordinary tool surface must equal B exactly')
    }
  }

  const toolchain = C.tools.slice(B.tools.length)
  if (
    toolchain[0]?.family !== 'toolchain'
    || toolchain[0].name !== TOOLCHAIN_SEARCH
    || toolchain[1]?.family !== 'toolchain'
    || toolchain[1].name !== TOOLCHAIN_INSPECT
  ) {
    throw new Error('Capability manifest C must add exactly Toolchain search and inspect')
  }
}

export function validateExecutorModelOutcome(value: unknown): void {
  const record = requireRecord(value, 'Executor model outcome')
  const keys = Object.keys(record)
  for (const key of keys) {
    if (!EXECUTOR_OUTCOME_FIELDS.has(key)) {
      throw new Error(`Executor model outcome field ${key} is runner-owned or unsupported`)
    }
  }
  if (record.outcome !== 'model-outcome') throw new Error('Executor may return only a terminal model outcome')
  if (typeof record.finalAnswer !== 'string') throw new Error('Executor finalAnswer must be a string')

  const metadata = requireRecord(record.providerMetadata, 'Executor providerMetadata')
  for (const key of Object.keys(metadata)) {
    if (!PROVIDER_METADATA_FIELDS.has(key)) {
      throw new Error(`Executor provider metadata field ${key} is unsupported`)
    }
  }
  if (typeof metadata.completionId !== 'string' || metadata.completionId.length === 0) {
    throw new Error('Executor providerMetadata.completionId must be non-empty')
  }
  if (typeof metadata.finishReason !== 'string' || metadata.finishReason.length === 0) {
    throw new Error('Executor providerMetadata.finishReason must be non-empty')
  }
  for (const field of ['responseModel', 'systemFingerprint'] as const) {
    const identity = metadata[field]
    if (identity !== undefined && (typeof identity !== 'string' || identity.length === 0)) {
      throw new Error(`Executor providerMetadata.${field} must be non-empty when present`)
    }
  }
  for (const field of ['inputTokens', 'outputTokens'] as const) {
    const count = metadata[field]
    if (count !== undefined && (!Number.isInteger(count) || typeof count !== 'number' || count < 0)) {
      throw new Error(`Executor providerMetadata.${field} must be a non-negative integer when present`)
    }
  }
}

export async function createInlineContentRef(
  inline: string,
  mediaType: string,
  canonicalization: 'utf8-bytes-v1',
  sha256: Sha256Port,
): Promise<ContentRef> {
  assertNonEmpty(mediaType, 'ContentRef mediaType')
  return {
    sha256: await sha256.sha256Utf8(inline),
    mediaType,
    canonicalization,
    byteLength: utf8ByteLength(inline),
    inline,
  }
}

export async function validateContentRef(ref: ContentRef, sha256: Sha256Port): Promise<void> {
  assertSha256(ref.sha256, 'ContentRef sha256')
  assertNonEmpty(ref.mediaType, 'ContentRef mediaType')
  if (ref.canonicalization !== 'utf8-bytes-v1') {
    throw new Error(`Unsupported ContentRef canonicalization: ${ref.canonicalization}`)
  }
  const byteLength = utf8ByteLength(ref.inline)
  if (ref.byteLength !== byteLength) {
    throw new Error(`ContentRef byte length mismatch: ${ref.byteLength} != ${byteLength}`)
  }
  const digest = await sha256.sha256Utf8(ref.inline)
  if (ref.sha256 !== digest) throw new Error('ContentRef hash does not match retained bytes')
}

export async function createTraceReceipt(
  runControlSha256: string,
  entries: readonly RunnerToolTraceEntry[],
  sha256: Sha256Port,
): Promise<TraceReceipt> {
  assertSha256(runControlSha256, 'Trace runControlSha256')
  const receipt = {
    schema: 'dsh-toolchain-m2-trace-v1' as const,
    runControlSha256,
    entries: structuredClone(entries),
  }
  return {
    ...receipt,
    traceSha256: await sha256.sha256Utf8(traceProjection(receipt)),
  }
}

export async function validateTraceReceipt(
  receipt: TraceReceipt,
  arm: AgentArm,
  sha256: Sha256Port,
): Promise<void> {
  assertSha256(receipt.runControlSha256, 'Trace runControlSha256')
  assertSha256(receipt.traceSha256, 'Trace traceSha256')
  const expectedTrace = await sha256.sha256Utf8(traceProjection({
    schema: receipt.schema,
    runControlSha256: receipt.runControlSha256,
    entries: receipt.entries,
  }))
  if (expectedTrace !== receipt.traceSha256) throw new Error('Trace hash does not match runner-owned entries')

  if (arm === 'A' && receipt.entries.length !== 0) throw new Error('Arm A must not use tools')

  for (let index = 0; index < receipt.entries.length; index += 1) {
    const entry = receipt.entries[index]!
    if (entry.sequence !== index + 1) throw new Error('Runner trace sequence must be contiguous from 1')
    assertNonEmpty(entry.name, 'Runner trace tool name')
    await validateContentRef(entry.request, sha256)
    await validateContentRef(entry.response, sha256)

    if (arm === 'B' && entry.family === 'toolchain') {
      throw new Error('Arm B must not use Toolchain tools')
    }
    if (
      arm === 'C'
      && entry.family === 'toolchain'
      && entry.name !== TOOLCHAIN_SEARCH
      && entry.name !== TOOLCHAIN_INSPECT
    ) {
      throw new Error('Arm C Toolchain calls are limited to production search and inspect')
    }
  }
}

export function validateIsolationReceipt(receipt: IsolationReceipt): void {
  assertSha256(receipt.runControlSha256, 'Isolation runControlSha256')
  assertSha256(receipt.sessionIdSha256, 'Isolation sessionIdSha256')
  assertSha256(receipt.workspaceSnapshotSha256, 'Isolation workspaceSnapshotSha256')
  assertSha256(receipt.ordinaryEvidenceSha256, 'Isolation ordinaryEvidenceSha256')
  assertSha256(receipt.mutableEnvironmentIdSha256, 'Isolation mutableEnvironmentIdSha256')

  if (receipt.freshModelSession !== true) throw new Error('Isolation requires a fresh model session')
  if (receipt.memoryCarryover !== false) throw new Error('Isolation forbids model memory carry-over')
  if (receipt.workspaceMode !== 'fresh' && receipt.workspaceMode !== 'read-only-reset') {
    throw new Error('Isolation workspace must be fresh or read-only-reset')
  }
  if (receipt.toolStateReset !== true) throw new Error('Isolation requires tool-state reset')
  if (receipt.parallelMutableStateShared !== false) throw new Error('Isolation forbids shared parallel mutable state')
  if (receipt.retrySessionPolicy !== 'fresh-session-per-attempt') {
    throw new Error('Isolation requires a fresh model session for every retry attempt')
  }
}

export async function createResourceReceipt(
  runControlSha256: string,
  policy: ResourcePolicy,
  observed: ResourceObservation,
  measurement: ResourceMeasurement,
  sha256: Sha256Port,
): Promise<ResourceReceipt> {
  assertSha256(runControlSha256, 'Resource runControlSha256')
  validateResourcePolicy(policy)
  const configuredPolicy = structuredClone(policy)
  return {
    schema: 'dsh-toolchain-m2-resource-v1',
    runControlSha256,
    configuredPolicy,
    configuredPolicySha256: await sha256.sha256Utf8(canonicalizeEvaluationJson(configuredPolicy)),
    observed: structuredClone(observed),
    measurement: structuredClone(measurement),
    compliance: computeResourceCompliance(policy, observed, measurement),
  }
}

export async function validateResourceReceipt(
  receipt: ResourceReceipt,
  sha256: Sha256Port,
): Promise<void> {
  assertSha256(receipt.runControlSha256, 'Resource runControlSha256')
  assertSha256(receipt.configuredPolicySha256, 'Resource configuredPolicySha256')
  validateResourcePolicy(receipt.configuredPolicy)
  const expectedPolicyHash = await sha256.sha256Utf8(canonicalizeEvaluationJson(receipt.configuredPolicy))
  if (receipt.configuredPolicySha256 !== expectedPolicyHash) {
    throw new Error('Resource configured policy hash mismatch')
  }
  const expectedCompliance = computeResourceCompliance(
    receipt.configuredPolicy,
    receipt.observed,
    receipt.measurement,
  )
  if (receipt.compliance !== expectedCompliance) {
    throw new Error(`Resource compliance mismatch: ${receipt.compliance} != ${expectedCompliance}`)
  }
}
