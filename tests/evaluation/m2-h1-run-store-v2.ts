import { randomUUID } from 'node:crypto'
import {
  mkdir,
  open as openFile,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises'
import { join } from 'node:path'

import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  appendH1RunLedgerAttemptV2,
  createH1RunLedgerV2,
  validateH1RunLedgerV2,
  type H1LedgerBindingV2,
  type H1RunLedgerAttemptInputV2,
  type H1RunLedgerResumeV2,
  type H1RunLedgerV2,
} from './m2-h1-run-ledger-v2.js'

const LEDGER_FILE = 'ledger.json'
const PENDING_FILE = 'pending-attempt.json'
const LOCK_FILE = 'writer.lock'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const PENDING_KEYS = Object.freeze([
  'schema',
  'invocationId',
  'definitionSha256',
  'datasetCommitmentSha256',
  'providerIdentityReceiptSha256',
  'expectedResponseModel',
  'expectedBackendFingerprint',
  'scheduleSha256',
  'preEntryCount',
  'preTailEntrySha256',
  'scheduleIndex',
  'taskId',
  'arm',
  'trial',
  'attempt',
  'intentSha256',
])
const LOCK_KEYS = Object.freeze(['schema', 'pid', 'ownerNonce'])

export interface H1PendingAttemptIntentV2 {
  readonly schema: 'dsh-toolchain-m2-h1-pending-attempt-v2'
  readonly invocationId: string
  readonly definitionSha256: string
  readonly datasetCommitmentSha256: string
  readonly providerIdentityReceiptSha256: string
  readonly expectedResponseModel: string
  readonly expectedBackendFingerprint: string
  readonly scheduleSha256: string
  readonly preEntryCount: number
  readonly preTailEntrySha256: string | null
  readonly scheduleIndex: number
  readonly taskId: string
  readonly arm: 'A' | 'B' | 'C'
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly intentSha256: string
}

export interface H1RunStoreV2 {
  readonly rootDir: string
}

interface H1RunStoreStateBaseV2 {
  readonly orphanedTempFiles: readonly string[]
  readonly recoveredCommittedIntent: boolean
}

export type H1RunStoreStateV2 =
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'NEXT'
      readonly resume: Extract<H1RunLedgerResumeV2, { readonly status: 'NEXT' }>
    })
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'COMPLETE'
      readonly resume: Extract<H1RunLedgerResumeV2, { readonly status: 'COMPLETE' }>
    })
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'RECOVERY_REQUIRED'
      readonly pending: H1PendingAttemptIntentV2
    })

export interface H1RunStoreOpenResultV2 {
  readonly store: H1RunStoreV2
  readonly state: H1RunStoreStateV2
}

interface WriterLockV2 {
  readonly schema: 'dsh-toolchain-m2-h1-writer-lock-v2'
  readonly pid: number
  readonly ownerNonce: string
}

interface StoreContext {
  readonly store: H1RunStoreV2
  readonly binding: H1LedgerBindingV2
  readonly schedule: readonly AgentScheduleEntry[]
  readonly taskIds: readonly string[]
  readonly retryPolicy: AgentRetryPolicy
  readonly sha256: Sha256Port
  readonly ownerNonce: string
  busy: boolean
  closed: boolean
}

const contexts = new WeakMap<H1RunStoreV2, StoreContext>()

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`)
  }
  return value as number
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest`)
  }
  return value
}

function canonicalPath(rootDir: string, filename: string): string {
  return join(rootDir, filename)
}

async function readCanonicalJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(bytes) as unknown
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${errorDetail(error)}`)
  }
  if (canonicalizeEvaluationJson(value) !== bytes) {
    throw new Error(`${label} must use canonical JSON bytes`)
  }
  return value
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return false
    throw error
  }
}

async function atomicWriteJson(rootDir: string, filename: string, value: unknown): Promise<void> {
  const target = canonicalPath(rootDir, filename)
  const temporary = canonicalPath(rootDir, `.${filename}.tmp-${process.pid}-${randomUUID()}`)
  let handle: Awaited<ReturnType<typeof openFile>> | undefined
  try {
    handle = await openFile(temporary, 'wx', 0o600)
    await handle.writeFile(canonicalizeEvaluationJson(value), 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, target)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function parseWriterLock(value: unknown): WriterLockV2 {
  const record = requireRecord(value, 'H1 writer lock')
  assertExactKeys(record, LOCK_KEYS, 'H1 writer lock')
  if (record.schema !== 'dsh-toolchain-m2-h1-writer-lock-v2') {
    throw new Error('H1 writer lock schema is unknown; liveness is uncertain')
  }
  const pid = requireInteger(record.pid, 'H1 writer lock pid', 1)
  const ownerNonce = requireNonEmptyString(record.ownerNonce, 'H1 writer lock owner nonce')
  return Object.freeze({ schema: record.schema, pid, ownerNonce })
}

async function readWriterLock(path: string): Promise<WriterLockV2> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`H1 writer lock cannot be trusted: ${errorDetail(error)}`)
  }
  return parseWriterLock(value)
}

function pidLiveness(pid: number): 'alive' | 'dead' | 'uncertain' {
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    if (isErrno(error, 'ESRCH')) return 'dead'
    return 'uncertain'
  }
}

async function createWriterLock(rootDir: string, ownerNonce: string): Promise<void> {
  const lock: WriterLockV2 = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-writer-lock-v2',
    pid: process.pid,
    ownerNonce,
  })
  const handle = await openFile(canonicalPath(rootDir, LOCK_FILE), 'wx', 0o600)
  try {
    await handle.writeFile(canonicalizeEvaluationJson(lock), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function acquireWriterLock(rootDir: string): Promise<string> {
  await mkdir(rootDir, { recursive: true })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ownerNonce = randomUUID()
    try {
      await createWriterLock(rootDir, ownerNonce)
      return ownerNonce
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
    }

    const lockPath = canonicalPath(rootDir, LOCK_FILE)
    let existing: WriterLockV2
    try {
      existing = await readWriterLock(lockPath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw error
    }
    const liveness = pidLiveness(existing.pid)
    if (liveness !== 'dead') {
      throw new Error(`H1 run store writer lock is active or liveness is uncertain for pid ${existing.pid}`)
    }

    const archivePath = canonicalPath(rootDir, `.writer.lock.dead-${randomUUID()}`)
    try {
      await rename(lockPath, archivePath)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue
      throw error
    }
  }
  throw new Error('H1 run store could not acquire a single-writer lock')
}

async function releaseWriterLock(rootDir: string, ownerNonce: string): Promise<void> {
  const lockPath = canonicalPath(rootDir, LOCK_FILE)
  let existing: WriterLockV2
  try {
    existing = await readWriterLock(lockPath)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return
    throw error
  }
  if (existing.pid !== process.pid || existing.ownerNonce !== ownerNonce) {
    throw new Error('H1 run store writer lock ownership changed; refusing to remove it')
  }
  await unlink(lockPath)
}

function requireContext(store: H1RunStoreV2): StoreContext {
  const context = contexts.get(store)
  if (context === undefined || context.closed) {
    throw new Error('H1 run store is closed or unknown')
  }
  return context
}

async function withOperation<T>(store: H1RunStoreV2, operation: (context: StoreContext) => Promise<T>): Promise<T> {
  const context = requireContext(store)
  if (context.busy) throw new Error('H1 run store operation is already in progress')
  context.busy = true
  try {
    return await operation(context)
  } finally {
    context.busy = false
  }
}

async function orphanedTempFiles(rootDir: string): Promise<readonly string[]> {
  const names = await readdir(rootDir)
  return Object.freeze(names
    .filter(name => name.startsWith(`.${LEDGER_FILE}.tmp-`) || name.startsWith(`.${PENDING_FILE}.tmp-`))
    .toSorted())
}

async function readValidatedLedger(context: StoreContext): Promise<{
  readonly ledger: H1RunLedgerV2
  readonly resume: H1RunLedgerResumeV2
}> {
  const value = await readCanonicalJson(canonicalPath(context.store.rootDir, LEDGER_FILE), 'H1 run ledger')
  const resume = await validateH1RunLedgerV2(
    value,
    context.binding,
    context.schedule,
    context.taskIds,
    context.retryPolicy,
    context.sha256,
  )
  return Object.freeze({ ledger: value as H1RunLedgerV2, resume })
}

function pendingHashMaterial(pending: Omit<H1PendingAttemptIntentV2, 'intentSha256'>): Record<string, unknown> {
  return {
    schema: pending.schema,
    invocationId: pending.invocationId,
    definitionSha256: pending.definitionSha256,
    datasetCommitmentSha256: pending.datasetCommitmentSha256,
    providerIdentityReceiptSha256: pending.providerIdentityReceiptSha256,
    expectedResponseModel: pending.expectedResponseModel,
    expectedBackendFingerprint: pending.expectedBackendFingerprint,
    scheduleSha256: pending.scheduleSha256,
    preEntryCount: pending.preEntryCount,
    preTailEntrySha256: pending.preTailEntrySha256,
    scheduleIndex: pending.scheduleIndex,
    taskId: pending.taskId,
    arm: pending.arm,
    trial: pending.trial,
    attempt: pending.attempt,
  }
}

async function parsePendingIntent(
  value: unknown,
  context: StoreContext,
  scheduleSha256: string,
): Promise<H1PendingAttemptIntentV2> {
  const record = requireRecord(value, 'H1 pending attempt intent')
  assertExactKeys(record, PENDING_KEYS, 'H1 pending attempt intent')
  if (record.schema !== 'dsh-toolchain-m2-h1-pending-attempt-v2') {
    throw new Error('H1 pending attempt intent schema drifted')
  }
  const arm = record.arm
  if (arm !== 'A' && arm !== 'B' && arm !== 'C') throw new Error('H1 pending attempt arm is invalid')
  const trial = record.trial
  if (trial !== 1 && trial !== 2 && trial !== 3) throw new Error('H1 pending attempt trial is invalid')
  const preTailEntrySha256 = record.preTailEntrySha256 === null
    ? null
    : requireSha256(record.preTailEntrySha256, 'H1 pending attempt pre-tail hash')
  const material = Object.freeze({
    schema: record.schema,
    invocationId: requireNonEmptyString(record.invocationId, 'H1 pending attempt invocation id'),
    definitionSha256: requireSha256(record.definitionSha256, 'H1 pending attempt definition binding'),
    datasetCommitmentSha256: requireSha256(record.datasetCommitmentSha256, 'H1 pending attempt dataset binding'),
    providerIdentityReceiptSha256: requireSha256(record.providerIdentityReceiptSha256, 'H1 pending attempt provider binding'),
    expectedResponseModel: requireNonEmptyString(record.expectedResponseModel, 'H1 pending attempt response model'),
    expectedBackendFingerprint: requireNonEmptyString(record.expectedBackendFingerprint, 'H1 pending attempt backend fingerprint'),
    scheduleSha256: requireSha256(record.scheduleSha256, 'H1 pending attempt schedule binding'),
    preEntryCount: requireInteger(record.preEntryCount, 'H1 pending attempt pre-entry count'),
    preTailEntrySha256,
    scheduleIndex: requireInteger(record.scheduleIndex, 'H1 pending attempt schedule index'),
    taskId: requireNonEmptyString(record.taskId, 'H1 pending attempt task id'),
    arm,
    trial,
    attempt: requireInteger(record.attempt, 'H1 pending attempt number', 1),
  })

  if (
    material.definitionSha256 !== context.binding.definitionSha256
    || material.datasetCommitmentSha256 !== context.binding.datasetCommitmentSha256
    || material.providerIdentityReceiptSha256 !== context.binding.providerIdentityReceiptSha256
    || material.expectedResponseModel !== context.binding.expectedResponseModel
    || material.expectedBackendFingerprint !== context.binding.expectedBackendFingerprint
    || material.scheduleSha256 !== scheduleSha256
  ) {
    throw new Error('H1 pending attempt binding drifted from the validated ledger/store identity')
  }

  const intentSha256 = requireSha256(record.intentSha256, 'H1 pending attempt stored hash')
  const computed = requireSha256(
    await context.sha256.sha256Utf8(canonicalizeEvaluationJson(pendingHashMaterial(material))),
    'H1 pending attempt computed hash',
  )
  if (intentSha256 !== computed) throw new Error('H1 pending attempt hash tamper detected')
  return Object.freeze({ ...material, intentSha256 })
}

async function readPendingIntent(
  context: StoreContext,
  scheduleSha256: string,
): Promise<H1PendingAttemptIntentV2 | undefined> {
  const path = canonicalPath(context.store.rootDir, PENDING_FILE)
  let value: unknown
  try {
    value = await readCanonicalJson(path, 'H1 pending attempt intent')
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
  return parsePendingIntent(value, context, scheduleSha256)
}

function tailHash(ledger: H1RunLedgerV2): string | null {
  return ledger.entries.length === 0 ? null : ledger.entries[ledger.entries.length - 1]!.entrySha256
}

function resumeMatchesPending(
  resume: H1RunLedgerResumeV2,
  pending: H1PendingAttemptIntentV2,
): boolean {
  return resume.status === 'NEXT'
    && resume.scheduleIndex === pending.scheduleIndex
    && resume.taskId === pending.taskId
    && resume.arm === pending.arm
    && resume.trial === pending.trial
    && resume.attempt === pending.attempt
}

function terminalEntryMatchesPending(ledger: H1RunLedgerV2, pending: H1PendingAttemptIntentV2): boolean {
  if (ledger.entries.length !== pending.preEntryCount + 1) return false
  const entry = ledger.entries[pending.preEntryCount]
  return entry !== undefined
    && entry.scheduleIndex === pending.scheduleIndex
    && entry.taskId === pending.taskId
    && entry.arm === pending.arm
    && entry.trial === pending.trial
    && entry.attempt === pending.attempt
    && entry.previousEntrySha256 === pending.preTailEntrySha256
}

function stateFromResume(
  resume: H1RunLedgerResumeV2,
  orphaned: readonly string[],
  recoveredCommittedIntent: boolean,
): H1RunStoreStateV2 {
  return resume.status === 'NEXT'
    ? Object.freeze({
        status: 'NEXT' as const,
        resume,
        orphanedTempFiles: orphaned,
        recoveredCommittedIntent,
      })
    : Object.freeze({
        status: 'COMPLETE' as const,
        resume,
        orphanedTempFiles: orphaned,
        recoveredCommittedIntent,
      })
}

async function inspectContext(context: StoreContext): Promise<H1RunStoreStateV2> {
  const { ledger, resume } = await readValidatedLedger(context)
  const orphaned = await orphanedTempFiles(context.store.rootDir)
  const pending = await readPendingIntent(context, ledger.header.scheduleSha256)
  if (pending === undefined) return stateFromResume(resume, orphaned, false)

  if (ledger.entries.length === pending.preEntryCount && tailHash(ledger) === pending.preTailEntrySha256) {
    if (!resumeMatchesPending(resume, pending)) {
      throw new Error('H1 pending attempt does not match the exact pre-ledger resume tuple')
    }
    return Object.freeze({
      status: 'RECOVERY_REQUIRED' as const,
      pending,
      orphanedTempFiles: orphaned,
      recoveredCommittedIntent: false,
    })
  }

  if (terminalEntryMatchesPending(ledger, pending)) {
    await unlink(canonicalPath(context.store.rootDir, PENDING_FILE))
    return stateFromResume(resume, orphaned, true)
  }

  throw new Error('H1 pending attempt and canonical ledger mismatch; refusing automatic recovery or replay')
}

function makeContext(
  rootDir: string,
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  retryPolicy: AgentRetryPolicy,
  sha256: Sha256Port,
  ownerNonce: string,
): StoreContext {
  const store = Object.freeze({ rootDir })
  const context: StoreContext = {
    store,
    binding,
    schedule,
    taskIds,
    retryPolicy,
    sha256,
    ownerNonce,
    busy: false,
    closed: false,
  }
  contexts.set(store, context)
  return context
}

async function cleanupFailedOpen(rootDir: string, ownerNonce: string, error: unknown): Promise<never> {
  try {
    await releaseWriterLock(rootDir, ownerNonce)
  } catch (releaseError) {
    throw new AggregateError([error, releaseError], 'H1 run store failed and its writer lock could not be released')
  }
  throw error
}

export async function createH1RunStoreV2(
  rootDir: string,
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  retryPolicy: AgentRetryPolicy,
  sha256: Sha256Port,
): Promise<H1RunStoreOpenResultV2> {
  const ownerNonce = await acquireWriterLock(rootDir)
  try {
    if (await fileExists(canonicalPath(rootDir, LEDGER_FILE))) {
      throw new Error('H1 run store canonical ledger already exists')
    }
    if (await fileExists(canonicalPath(rootDir, PENDING_FILE))) {
      throw new Error('H1 run store pending attempt already exists without a canonical ledger')
    }
    const ledger = await createH1RunLedgerV2(binding, schedule, taskIds, sha256)
    await atomicWriteJson(rootDir, LEDGER_FILE, ledger)
    const context = makeContext(rootDir, binding, schedule, taskIds, retryPolicy, sha256, ownerNonce)
    const state = await inspectContext(context)
    return Object.freeze({ store: context.store, state })
  } catch (error) {
    return cleanupFailedOpen(rootDir, ownerNonce, error)
  }
}

export async function openH1RunStoreV2(
  rootDir: string,
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  retryPolicy: AgentRetryPolicy,
  sha256: Sha256Port,
): Promise<H1RunStoreOpenResultV2> {
  const ownerNonce = await acquireWriterLock(rootDir)
  try {
    const context = makeContext(rootDir, binding, schedule, taskIds, retryPolicy, sha256, ownerNonce)
    const state = await inspectContext(context)
    return Object.freeze({ store: context.store, state })
  } catch (error) {
    return cleanupFailedOpen(rootDir, ownerNonce, error)
  }
}

export async function inspectH1RunStoreV2(store: H1RunStoreV2): Promise<H1RunStoreStateV2> {
  return withOperation(store, inspectContext)
}

export async function beginH1RunStoreAttemptV2(
  store: H1RunStoreV2,
  invocationId: string,
): Promise<H1PendingAttemptIntentV2> {
  return withOperation(store, async context => {
    requireNonEmptyString(invocationId, 'H1 run store invocation id')
    const state = await inspectContext(context)
    if (state.status === 'RECOVERY_REQUIRED') {
      throw new Error('H1 run store has a pending recovery; automatic replay is prohibited')
    }
    if (state.status === 'COMPLETE') throw new Error('H1 run store schedule is already complete')

    const { ledger, resume } = await readValidatedLedger(context)
    if (resume.status !== 'NEXT') throw new Error('H1 run store has no next attempt')
    const material = Object.freeze({
      schema: 'dsh-toolchain-m2-h1-pending-attempt-v2' as const,
      invocationId,
      definitionSha256: context.binding.definitionSha256,
      datasetCommitmentSha256: context.binding.datasetCommitmentSha256,
      providerIdentityReceiptSha256: context.binding.providerIdentityReceiptSha256,
      expectedResponseModel: context.binding.expectedResponseModel,
      expectedBackendFingerprint: context.binding.expectedBackendFingerprint,
      scheduleSha256: ledger.header.scheduleSha256,
      preEntryCount: ledger.entries.length,
      preTailEntrySha256: tailHash(ledger),
      scheduleIndex: resume.scheduleIndex,
      taskId: resume.taskId,
      arm: resume.arm,
      trial: resume.trial,
      attempt: resume.attempt,
    })
    const intentSha256 = requireSha256(
      await context.sha256.sha256Utf8(canonicalizeEvaluationJson(pendingHashMaterial(material))),
      'H1 pending attempt hash',
    )
    const pending = Object.freeze({ ...material, intentSha256 })
    await atomicWriteJson(context.store.rootDir, PENDING_FILE, pending)
    return pending
  })
}

function attemptMatchesPending(attempt: H1RunLedgerAttemptInputV2, pending: H1PendingAttemptIntentV2): boolean {
  return attempt.scheduleIndex === pending.scheduleIndex
    && attempt.taskId === pending.taskId
    && attempt.arm === pending.arm
    && attempt.trial === pending.trial
    && attempt.attempt === pending.attempt
}

export async function commitH1RunStoreAttemptV2(
  store: H1RunStoreV2,
  invocationId: string,
  attempt: H1RunLedgerAttemptInputV2,
): Promise<H1RunStoreStateV2> {
  return withOperation(store, async context => {
    const state = await inspectContext(context)
    if (state.status !== 'RECOVERY_REQUIRED') {
      throw new Error('H1 run store commit requires exactly one durable pending attempt')
    }
    if (state.pending.invocationId !== invocationId) {
      throw new Error('H1 run store pending invocation does not match the commit invocation')
    }
    if (!attemptMatchesPending(attempt, state.pending)) {
      throw new Error('H1 run store terminal attempt does not match the durable pending tuple')
    }

    const { ledger } = await readValidatedLedger(context)
    const appended = await appendH1RunLedgerAttemptV2(
      ledger,
      context.binding,
      context.schedule,
      context.taskIds,
      context.retryPolicy,
      attempt,
      context.sha256,
    )
    await atomicWriteJson(context.store.rootDir, LEDGER_FILE, appended)
    await readValidatedLedger(context)
    await unlink(canonicalPath(context.store.rootDir, PENDING_FILE))
    return inspectContext(context)
  })
}

export async function closeH1RunStoreV2(store: H1RunStoreV2): Promise<void> {
  const context = contexts.get(store)
  if (context === undefined || context.closed) return
  if (context.busy) throw new Error('H1 run store cannot close while an operation is in progress')
  context.busy = true
  try {
    await releaseWriterLock(context.store.rootDir, context.ownerNonce)
    context.closed = true
  } finally {
    context.busy = false
  }
}
