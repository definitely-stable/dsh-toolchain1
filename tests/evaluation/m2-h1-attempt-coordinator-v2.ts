import { randomUUID } from 'node:crypto'
import {
  mkdir,
  open as openFile,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import { join } from 'node:path'

import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
} from './m2-agent-eval-integrity.js'
import {
  validateContentRef,
  validateIsolationReceipt,
  validateResourceReceipt,
  validateTraceReceipt,
  type ContentRef,
  type IsolationReceipt,
  type RunControl,
  type TraceReceipt,
  type ResourceReceipt,
} from './m2-agent-execution-evidence.js'
import {
  executeProcessAttemptWithEvidence,
  type ProcessAttemptEvidenceInput,
  type ProcessAttemptEvidenceResult,
} from './m2-agent-process-runner.js'
import type {
  H1LedgerBindingV2,
  H1RunLedgerAttemptInputV2,
} from './m2-h1-run-ledger-v2.js'
import {
  beginH1RunStoreAttemptV2,
  commitH1RunStoreAttemptV2,
  inspectH1RunStoreV2,
  type H1PendingAttemptIntentV2,
  type H1RunStoreStateV2,
  type H1RunStoreV2,
} from './m2-h1-run-store-v2.js'

const ATTEMPTS_DIR = 'attempts'
const LEDGER_FILE = 'ledger.json'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const WRAPPER_KEYS = Object.freeze(['schema', 'pendingIntentSha256', 'evidenceSha256', 'result'])
const RESULT_KEYS = Object.freeze(['frozen', 'attempt'])
const FROZEN_KEYS = Object.freeze([
  'capabilityManifest',
  'resourcePolicy',
  'retryPolicy',
  'executorIdentity',
  'modelEnvelope',
  'runControl',
])
const EXECUTION_EVIDENCE_KEYS = Object.freeze([
  'runControl',
  'modelEnvelope',
  'trace',
  'executorIdentity',
  'isolationReceipt',
  'resourceReceipt',
])
const MODEL_ATTEMPT_KEYS = Object.freeze([
  'attempt',
  'startedAt',
  'completedAt',
  'outcome',
  'executionEvidence',
  'rawAnswer',
  'providerMetadata',
  'parsedApiClaims',
  'taskSuccess',
])
const INFRA_ATTEMPT_REQUIRED_KEYS = Object.freeze([
  'attempt',
  'startedAt',
  'completedAt',
  'outcome',
  'executionEvidence',
  'reason',
  'qualityIndependent',
  'detail',
])

export interface H1DurableAttemptEvidenceV2 {
  readonly schema: 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2'
  readonly pendingIntentSha256: string
  readonly evidenceSha256: string
  readonly result: ProcessAttemptEvidenceResult
}

export interface H1DurableAttemptCommitV2 {
  readonly status: 'COMMITTED' | 'RECOVERED'
  readonly evidenceSha256: string
  readonly evidencePath: string
  readonly state: H1RunStoreStateV2
}

export interface H1DurableAttemptInputV2 {
  readonly store: H1RunStoreV2
  readonly binding: H1LedgerBindingV2
  readonly invocationId: string
  readonly attemptInput: ProcessAttemptEvidenceInput
  readonly sha256: Sha256Port
}

export type H1DurableAttemptRecoveryV2 =
  | H1DurableAttemptCommitV2
  | { readonly status: 'RECOVERY_REQUIRED'; readonly state: H1RunStoreStateV2 }
  | { readonly status: 'NO_RECOVERY'; readonly state: H1RunStoreStateV2 }

interface ValidatedTerminalEvidence {
  readonly result: ProcessAttemptEvidenceResult
  readonly ledgerAttempt: H1RunLedgerAttemptInputV2
  readonly evidenceSha256: string
}

const activeCoordinatorStores = new WeakSet<H1RunStoreV2>()

function isErrno(error: unknown, code: string): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === code
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected)
  const unknown = Object.keys(record).filter(key => !expectedSet.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
  const missing = expected.filter(key => !(key in record))
  if (missing.length > 0) throw new Error(`${label} is missing required key(s): ${missing.join(', ')}`)
}

function assertInfraAttemptKeys(record: Record<string, unknown>): void {
  const allowed = new Set([...INFRA_ATTEMPT_REQUIRED_KEYS, 'partialOutput'])
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length > 0) throw new Error(`H1 infrastructure attempt contains unknown key(s): ${unknown.join(', ')}`)
  const missing = INFRA_ATTEMPT_REQUIRED_KEYS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw new Error(`H1 infrastructure attempt is missing required key(s): ${missing.join(', ')}`)
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest`)
  }
  return value
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value as number
}

async function withCoordinatorOperation<T>(
  store: H1RunStoreV2,
  operation: () => Promise<T>,
): Promise<T> {
  if (activeCoordinatorStores.has(store)) {
    throw new Error('H1 durable attempt coordinator operation is already in progress for this store')
  }
  activeCoordinatorStores.add(store)
  try {
    return await operation()
  } finally {
    activeCoordinatorStores.delete(store)
  }
}

function evidencePathFor(store: H1RunStoreV2, pendingIntentSha256: string): string {
  return join(store.rootDir, ATTEMPTS_DIR, `${pendingIntentSha256}.json`)
}

async function readCanonicalJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(bytes) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} JSON parse failed: ${detail}`)
  }
  if (canonicalizeEvaluationJson(value) !== bytes) {
    throw new Error(`${label} must use canonical JSON bytes`)
  }
  return value
}

async function atomicWriteCanonicalJson(path: string, value: unknown): Promise<void> {
  const directory = join(path, '..')
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, `.${path.split(/[\\/]/u).at(-1)!}.tmp-${process.pid}-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof openFile>> | undefined
  try {
    handle = await openFile(temporary, 'wx', 0o600)
    await handle.writeFile(canonicalizeEvaluationJson(value), 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function assertStoreBindingBeforeBegin(
  store: H1RunStoreV2,
  binding: H1LedgerBindingV2,
): Promise<void> {
  const value = requireRecord(
    await readCanonicalJson(join(store.rootDir, LEDGER_FILE), 'H1 coordinator canonical ledger'),
    'H1 coordinator canonical ledger',
  )
  const header = requireRecord(value.header, 'H1 coordinator canonical ledger header')
  const fields = [
    ['definitionSha256', binding.definitionSha256, 'definition'],
    ['datasetCommitmentSha256', binding.datasetCommitmentSha256, 'dataset commitment'],
    ['providerIdentityReceiptSha256', binding.providerIdentityReceiptSha256, 'provider identity receipt'],
    ['expectedResponseModel', binding.expectedResponseModel, 'response model'],
    ['expectedBackendFingerprint', binding.expectedBackendFingerprint, 'backend fingerprint'],
  ] as const
  for (const [field, expected, label] of fields) {
    if (header[field] !== expected) throw new Error(`H1 coordinator ${label} binding does not match the store ledger`)
  }
}

function assertExactNextInput(
  state: H1RunStoreStateV2,
  binding: H1LedgerBindingV2,
  input: ProcessAttemptEvidenceInput,
): void {
  if (state.status !== 'NEXT') {
    throw new Error(`H1 durable attempt requires exact NEXT state, got ${state.status}`)
  }
  if (input.identity.phase !== 'H1') throw new Error('H1 durable attempt requires RunControl phase H1')
  if (input.identity.datasetCommitmentSha256 !== binding.datasetCommitmentSha256) {
    throw new Error('H1 durable attempt dataset commitment does not match the frozen binding')
  }
  const next = state.resume
  if (
    input.identity.taskId !== next.taskId
    || input.identity.arm !== next.arm
    || input.identity.trial !== next.trial
    || input.identity.attempt !== next.attempt
  ) {
    throw new Error('H1 durable attempt identity does not match the exact NEXT task/arm/trial/attempt tuple')
  }
  if (input.modelEnvelope.task.id !== input.identity.taskId) {
    throw new Error('H1 durable attempt ModelEnvelope task does not match the exact identity')
  }
  if (input.capabilityManifest.arm !== input.identity.arm) {
    throw new Error('H1 durable attempt capability manifest arm does not match the exact identity')
  }
  if (
    canonicalizeEvaluationJson(input.modelEnvelope.tools)
    !== canonicalizeEvaluationJson(input.capabilityManifest.tools)
  ) {
    throw new Error('H1 durable attempt ModelEnvelope tools drifted from the capability manifest')
  }
}

function assertPendingBinding(
  pending: H1PendingAttemptIntentV2,
  binding: H1LedgerBindingV2,
): void {
  if (
    pending.definitionSha256 !== binding.definitionSha256
    || pending.datasetCommitmentSha256 !== binding.datasetCommitmentSha256
    || pending.providerIdentityReceiptSha256 !== binding.providerIdentityReceiptSha256
    || pending.expectedResponseModel !== binding.expectedResponseModel
    || pending.expectedBackendFingerprint !== binding.expectedBackendFingerprint
  ) {
    throw new Error('H1 durable attempt pending intent binding drifted from the frozen binding')
  }
}

function assertPendingMatchesState(
  state: H1RunStoreStateV2,
  pending: H1PendingAttemptIntentV2,
): void {
  if (state.status !== 'RECOVERY_REQUIRED') {
    throw new Error('H1 terminal evidence requires RECOVERY_REQUIRED pending state')
  }
  if (state.pending.intentSha256 !== pending.intentSha256) {
    throw new Error('H1 terminal evidence pending intent hash does not match the store pending state')
  }
  if (
    state.pending.invocationId !== pending.invocationId
    || state.pending.scheduleIndex !== pending.scheduleIndex
    || state.pending.taskId !== pending.taskId
    || state.pending.arm !== pending.arm
    || state.pending.trial !== pending.trial
    || state.pending.attempt !== pending.attempt
  ) {
    throw new Error('H1 terminal evidence pending tuple does not match the store pending state')
  }
}

async function validateStructuredRef<T>(
  ref: ContentRef,
  label: string,
  sha256: Sha256Port,
): Promise<T> {
  await validateContentRef(ref, sha256)
  let value: unknown
  try {
    value = JSON.parse(ref.inline) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} retained JSON parse failed: ${detail}`)
  }
  if (canonicalizeEvaluationJson(value) !== ref.inline) {
    throw new Error(`${label} retained JSON must use canonical bytes`)
  }
  return value as T
}

async function validateTerminalResult(
  value: unknown,
  pending: H1PendingAttemptIntentV2,
  binding: H1LedgerBindingV2,
  sha256: Sha256Port,
): Promise<ValidatedTerminalEvidence> {
  const resultRecord = requireRecord(value, 'H1 durable terminal result')
  assertExactKeys(resultRecord, RESULT_KEYS, 'H1 durable terminal result')
  const frozen = requireRecord(resultRecord.frozen, 'H1 durable terminal frozen evidence')
  assertExactKeys(frozen, FROZEN_KEYS, 'H1 durable terminal frozen evidence')
  const attempt = requireRecord(resultRecord.attempt, 'H1 durable terminal attempt')
  if (attempt.outcome === 'model-outcome') {
    assertExactKeys(attempt, MODEL_ATTEMPT_KEYS, 'H1 model attempt')
  } else if (attempt.outcome === 'infrastructure-failure') {
    assertInfraAttemptKeys(attempt)
  } else {
    throw new Error(`H1 durable terminal attempt outcome is invalid: ${String(attempt.outcome)}`)
  }

  const frozenCapabilityManifest = frozen.capabilityManifest as ContentRef
  const frozenResourcePolicy = frozen.resourcePolicy as ContentRef
  const frozenRetryPolicy = frozen.retryPolicy as ContentRef
  const frozenExecutorIdentity = frozen.executorIdentity as ContentRef
  const frozenModelEnvelope = frozen.modelEnvelope as ContentRef
  const frozenRunControl = frozen.runControl as ContentRef
  for (const [ref, label] of [
    [frozenCapabilityManifest, 'capability manifest'],
    [frozenResourcePolicy, 'resource policy'],
    [frozenRetryPolicy, 'retry policy'],
    [frozenExecutorIdentity, 'executor identity'],
    [frozenModelEnvelope, 'model envelope'],
  ] as const) {
    await validateStructuredRef(ref, `H1 ${label}`, sha256)
  }
  const runControl = await validateStructuredRef<RunControl>(frozenRunControl, 'H1 RunControl', sha256)
  if (runControl.schema !== 'dsh-toolchain-m2-run-control-v1' || runControl.phase !== 'H1') {
    throw new Error('H1 durable terminal RunControl must be the H1 runner-owned schema')
  }
  if (
    runControl.taskId !== pending.taskId
    || runControl.arm !== pending.arm
    || runControl.trial !== pending.trial
    || runControl.attempt !== pending.attempt
    || runControl.datasetCommitmentSha256 !== binding.datasetCommitmentSha256
  ) {
    throw new Error('H1 durable terminal RunControl identity does not match the pending tuple/binding')
  }
  if (
    runControl.capabilityManifestSha256 !== frozenCapabilityManifest.sha256
    || runControl.resourcePolicySha256 !== frozenResourcePolicy.sha256
    || runControl.retryPolicySha256 !== frozenRetryPolicy.sha256
    || runControl.executorIdentitySha256 !== frozenExecutorIdentity.sha256
    || runControl.modelEnvelopeSha256 !== frozenModelEnvelope.sha256
  ) {
    throw new Error('H1 durable terminal RunControl evidence hash binding drifted')
  }

  const execution = requireRecord(attempt.executionEvidence, 'H1 durable execution evidence')
  assertExactKeys(execution, EXECUTION_EVIDENCE_KEYS, 'H1 durable execution evidence')
  const executionRunControl = execution.runControl as ContentRef
  const executionModelEnvelope = execution.modelEnvelope as ContentRef
  const executionTrace = execution.trace as ContentRef
  const executionExecutorIdentity = execution.executorIdentity as ContentRef
  const executionIsolation = execution.isolationReceipt as ContentRef
  const executionResource = execution.resourceReceipt as ContentRef

  for (const [ref, label] of [
    [executionRunControl, 'execution RunControl'],
    [executionModelEnvelope, 'execution model envelope'],
    [executionExecutorIdentity, 'execution executor identity'],
  ] as const) {
    await validateStructuredRef(ref, `H1 ${label}`, sha256)
  }
  if (
    executionRunControl.sha256 !== frozenRunControl.sha256
    || executionModelEnvelope.sha256 !== frozenModelEnvelope.sha256
    || executionExecutorIdentity.sha256 !== frozenExecutorIdentity.sha256
  ) {
    throw new Error('H1 durable execution evidence does not bind the frozen runner-owned refs')
  }

  const trace = await validateStructuredRef<TraceReceipt>(executionTrace, 'H1 trace receipt', sha256)
  await validateTraceReceipt(trace, pending.arm, sha256)
  const isolation = await validateStructuredRef<IsolationReceipt>(executionIsolation, 'H1 isolation receipt', sha256)
  validateIsolationReceipt(isolation)
  const resource = await validateStructuredRef<ResourceReceipt>(executionResource, 'H1 resource receipt', sha256)
  await validateResourceReceipt(resource, sha256)
  for (const [receiptRunControl, label] of [
    [trace.runControlSha256, 'trace'],
    [isolation.runControlSha256, 'isolation'],
    [resource.runControlSha256, 'resource'],
  ] as const) {
    if (receiptRunControl !== frozenRunControl.sha256) {
      throw new Error(`H1 ${label} receipt does not bind the exact RunControl`)
    }
  }

  const attemptNumber = requirePositiveInteger(attempt.attempt, 'H1 terminal attempt number')
  if (attemptNumber !== pending.attempt) throw new Error('H1 terminal attempt number drifted from pending intent')
  requireNonEmptyString(attempt.startedAt, 'H1 terminal startedAt')
  requireNonEmptyString(attempt.completedAt, 'H1 terminal completedAt')

  let ledgerAttempt: H1RunLedgerAttemptInputV2
  if (attempt.outcome === 'model-outcome') {
    await validateContentRef(attempt.rawAnswer as ContentRef, sha256)
    const providerMetadata = await validateStructuredRef<Record<string, unknown>>(
      attempt.providerMetadata as ContentRef,
      'H1 provider metadata',
      sha256,
    )
    const responseModel = requireNonEmptyString(providerMetadata.responseModel, 'H1 provider response model')
    const systemFingerprint = requireNonEmptyString(
      providerMetadata.systemFingerprint,
      'H1 provider backend fingerprint',
    )
    if (responseModel !== binding.expectedResponseModel) {
      throw new Error('H1 provider response model drifted from the frozen binding')
    }
    if (systemFingerprint !== binding.expectedBackendFingerprint) {
      throw new Error('H1 provider backend fingerprint drifted from the frozen binding')
    }
    if (!Array.isArray(attempt.parsedApiClaims)) throw new Error('H1 model attempt parsedApiClaims must be an array')
    if (attempt.taskSuccess !== 'SUCCESS' && attempt.taskSuccess !== 'FAILURE' && attempt.taskSuccess !== 'UNKNOWN') {
      throw new Error('H1 model attempt taskSuccess is invalid')
    }
    ledgerAttempt = {
      scheduleIndex: pending.scheduleIndex,
      taskId: pending.taskId,
      arm: pending.arm,
      trial: pending.trial,
      attempt: pending.attempt,
      outcome: 'model-outcome',
      evidenceSha256: '',
      responseModel,
      systemFingerprint,
    }
  } else {
    if (
      attempt.reason !== 'provider-transport'
      && attempt.reason !== 'tool-transport'
      && attempt.reason !== 'runner-infrastructure'
    ) {
      throw new Error(`H1 infrastructure failure reason is invalid: ${String(attempt.reason)}`)
    }
    if (attempt.qualityIndependent !== true) {
      throw new Error('H1 infrastructure failure must remain quality-independent')
    }
    requireNonEmptyString(attempt.detail, 'H1 infrastructure failure detail')
    if (attempt.partialOutput !== undefined) {
      await validateStructuredRef(attempt.partialOutput as ContentRef, 'H1 infrastructure retained output', sha256)
    }
    ledgerAttempt = {
      scheduleIndex: pending.scheduleIndex,
      taskId: pending.taskId,
      arm: pending.arm,
      trial: pending.trial,
      attempt: pending.attempt,
      outcome: 'infrastructure-failure',
      reason: attempt.reason,
      evidenceSha256: '',
    }
  }

  const result = value as ProcessAttemptEvidenceResult
  const evidenceSha256 = requireSha256(
    await sha256.sha256Utf8(canonicalizeEvaluationJson(result)),
    'H1 durable terminal evidence hash',
  )
  return Object.freeze({
    result,
    evidenceSha256,
    ledgerAttempt: Object.freeze({ ...ledgerAttempt, evidenceSha256 }),
  })
}

function wrapperFor(
  pending: H1PendingAttemptIntentV2,
  terminal: ValidatedTerminalEvidence,
): H1DurableAttemptEvidenceV2 {
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2' as const,
    pendingIntentSha256: pending.intentSha256,
    evidenceSha256: terminal.evidenceSha256,
    result: terminal.result,
  })
}

async function readDurableEvidence(
  path: string,
  pending: H1PendingAttemptIntentV2,
  binding: H1LedgerBindingV2,
  sha256: Sha256Port,
): Promise<ValidatedTerminalEvidence> {
  const wrapper = requireRecord(await readCanonicalJson(path, 'H1 durable attempt evidence'), 'H1 durable attempt evidence')
  assertExactKeys(wrapper, WRAPPER_KEYS, 'H1 durable attempt evidence')
  if (wrapper.schema !== 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2') {
    throw new Error('H1 durable attempt evidence schema drifted')
  }
  if (wrapper.pendingIntentSha256 !== pending.intentSha256) {
    throw new Error('H1 durable attempt evidence pending intent binding drifted')
  }
  const storedHash = requireSha256(wrapper.evidenceSha256, 'H1 durable attempt evidence stored hash')
  const validated = await validateTerminalResult(wrapper.result, pending, binding, sha256)
  if (storedHash !== validated.evidenceSha256) {
    throw new Error('H1 durable attempt evidence hash tamper detected')
  }
  return validated
}

async function persistTerminalEvidenceInternal(
  store: H1RunStoreV2,
  binding: H1LedgerBindingV2,
  pending: H1PendingAttemptIntentV2,
  result: ProcessAttemptEvidenceResult,
  sha256: Sha256Port,
): Promise<{ readonly evidenceSha256: string; readonly evidencePath: string; readonly ledgerAttempt: H1RunLedgerAttemptInputV2 }> {
  assertPendingBinding(pending, binding)
  const state = await inspectH1RunStoreV2(store)
  assertPendingMatchesState(state, pending)
  const terminal = await validateTerminalResult(result, pending, binding, sha256)
  const wrapper = wrapperFor(pending, terminal)
  const path = evidencePathFor(store, pending.intentSha256)

  try {
    const existing = await readDurableEvidence(path, pending, binding, sha256)
    if (
      existing.evidenceSha256 !== terminal.evidenceSha256
      || canonicalizeEvaluationJson(existing.result) !== canonicalizeEvaluationJson(terminal.result)
    ) {
      throw new Error('H1 durable attempt evidence path already contains conflicting terminal evidence')
    }
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
    await atomicWriteCanonicalJson(path, wrapper)
    const persisted = await readDurableEvidence(path, pending, binding, sha256)
    if (persisted.evidenceSha256 !== terminal.evidenceSha256) {
      throw new Error('H1 durable attempt evidence changed during atomic persistence')
    }
  }

  return Object.freeze({
    evidenceSha256: terminal.evidenceSha256,
    evidencePath: path,
    ledgerAttempt: terminal.ledgerAttempt,
  })
}

export async function persistH1TerminalAttemptEvidenceV2(
  store: H1RunStoreV2,
  binding: H1LedgerBindingV2,
  pending: H1PendingAttemptIntentV2,
  result: ProcessAttemptEvidenceResult,
  sha256: Sha256Port,
): Promise<{ readonly evidenceSha256: string; readonly evidencePath: string }> {
  return withCoordinatorOperation(store, async () => {
    const persisted = await persistTerminalEvidenceInternal(store, binding, pending, result, sha256)
    return Object.freeze({
      evidenceSha256: persisted.evidenceSha256,
      evidencePath: persisted.evidencePath,
    })
  })
}

export async function executeH1DurableAttemptV2(
  input: H1DurableAttemptInputV2,
): Promise<H1DurableAttemptCommitV2> {
  return withCoordinatorOperation(input.store, async () => {
    await assertStoreBindingBeforeBegin(input.store, input.binding)
    const before = await inspectH1RunStoreV2(input.store)
    assertExactNextInput(before, input.binding, input.attemptInput)

    const pending = await beginH1RunStoreAttemptV2(input.store, input.invocationId)
    assertPendingBinding(pending, input.binding)
    const result = await executeProcessAttemptWithEvidence(input.attemptInput)
    const persisted = await persistTerminalEvidenceInternal(
      input.store,
      input.binding,
      pending,
      result,
      input.sha256,
    )
    const state = await commitH1RunStoreAttemptV2(
      input.store,
      pending.invocationId,
      persisted.ledgerAttempt,
    )
    return Object.freeze({
      status: 'COMMITTED' as const,
      evidenceSha256: persisted.evidenceSha256,
      evidencePath: persisted.evidencePath,
      state,
    })
  })
}

export async function recoverH1DurableAttemptV2(
  store: H1RunStoreV2,
  binding: H1LedgerBindingV2,
  sha256: Sha256Port,
): Promise<H1DurableAttemptRecoveryV2> {
  return withCoordinatorOperation(store, async () => {
    await assertStoreBindingBeforeBegin(store, binding)
    const state = await inspectH1RunStoreV2(store)
    if (state.status !== 'RECOVERY_REQUIRED') {
      return Object.freeze({ status: 'NO_RECOVERY' as const, state })
    }
    assertPendingBinding(state.pending, binding)
    const path = evidencePathFor(store, state.pending.intentSha256)
    let terminal: ValidatedTerminalEvidence
    try {
      terminal = await readDurableEvidence(path, state.pending, binding, sha256)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return Object.freeze({ status: 'RECOVERY_REQUIRED' as const, state })
      }
      throw error
    }
    const committed = await commitH1RunStoreAttemptV2(
      store,
      state.pending.invocationId,
      terminal.ledgerAttempt,
    )
    return Object.freeze({
      status: 'RECOVERED' as const,
      evidenceSha256: terminal.evidenceSha256,
      evidencePath: path,
      state: committed,
    })
  })
}
