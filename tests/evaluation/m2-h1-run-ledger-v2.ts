import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  validateAgentAttempts,
  validateBalancedAgentSchedule,
  type AgentArm,
  type AgentAttemptRecord,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const EXPECTED_H1_TASK_COUNT = 96
const EXPECTED_H1_SCHEDULE_LENGTH = 864

const LEDGER_KEYS = Object.freeze(['header', 'entries'])
const HEADER_KEYS = Object.freeze([
  'schema',
  'definitionSha256',
  'datasetCommitmentSha256',
  'providerIdentityReceiptSha256',
  'expectedResponseModel',
  'expectedBackendFingerprint',
  'scheduleSha256',
  'scheduleLength',
])
const INFRA_ENTRY_KEYS = Object.freeze([
  'sequence',
  'scheduleIndex',
  'taskId',
  'arm',
  'trial',
  'attempt',
  'outcome',
  'reason',
  'evidenceSha256',
  'previousEntrySha256',
  'entrySha256',
])
const MODEL_ENTRY_KEYS = Object.freeze([
  'sequence',
  'scheduleIndex',
  'taskId',
  'arm',
  'trial',
  'attempt',
  'outcome',
  'evidenceSha256',
  'responseModel',
  'systemFingerprint',
  'previousEntrySha256',
  'entrySha256',
])

export interface H1LedgerBindingV2 {
  readonly definitionSha256: string
  readonly datasetCommitmentSha256: string
  readonly providerIdentityReceiptSha256: string
  readonly expectedResponseModel: string
  readonly expectedBackendFingerprint: string
}

export interface H1RunLedgerHeaderV2 extends H1LedgerBindingV2 {
  readonly schema: 'dsh-toolchain-m2-h1-run-ledger-v2'
  readonly scheduleSha256: string
  readonly scheduleLength: number
}

export interface H1RunLedgerEntryV2 {
  readonly sequence: number
  readonly scheduleIndex: number
  readonly taskId: string
  readonly arm: AgentArm
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly outcome: 'infrastructure-failure' | 'model-outcome'
  readonly reason?: string
  readonly evidenceSha256: string
  readonly responseModel?: string
  readonly systemFingerprint?: string
  readonly previousEntrySha256: string | null
  readonly entrySha256: string
}

export interface H1RunLedgerV2 {
  readonly header: H1RunLedgerHeaderV2
  readonly entries: readonly H1RunLedgerEntryV2[]
}

export type H1RunLedgerResumeV2 =
  | {
      readonly status: 'NEXT'
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly inconclusive: boolean
    }
  | {
      readonly status: 'COMPLETE'
      readonly inconclusive: boolean
    }

export type H1RunLedgerAttemptInputV2 =
  | {
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly outcome: 'infrastructure-failure'
      readonly reason: string
      readonly evidenceSha256: string
    }
  | {
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly outcome: 'model-outcome'
      readonly evidenceSha256: string
      readonly responseModel: string
      readonly systemFingerprint: string
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

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest`)
  }
  return value
}

function validateBinding(binding: H1LedgerBindingV2): void {
  requireSha256(binding.definitionSha256, 'H1 ledger definition binding')
  requireSha256(binding.datasetCommitmentSha256, 'H1 ledger dataset commitment binding')
  requireSha256(binding.providerIdentityReceiptSha256, 'H1 ledger provider identity receipt binding')
  requireNonEmptyString(binding.expectedResponseModel, 'H1 ledger expected response model')
  requireNonEmptyString(binding.expectedBackendFingerprint, 'H1 ledger expected backend fingerprint')
}

function validateTaskIds(taskIds: readonly string[]): void {
  if (taskIds.length !== EXPECTED_H1_TASK_COUNT) {
    throw new Error(`H1 ledger requires exactly ${EXPECTED_H1_TASK_COUNT} committed task ids`)
  }
  if (new Set(taskIds).size !== taskIds.length || taskIds.some(taskId => taskId.trim().length === 0)) {
    throw new Error('H1 ledger task ids must be unique and non-empty')
  }
}

async function scheduleDigest(
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  sha256: Sha256Port,
): Promise<string> {
  validateTaskIds(taskIds)
  validateBalancedAgentSchedule(schedule, taskIds)
  if (schedule.length !== EXPECTED_H1_SCHEDULE_LENGTH) {
    throw new Error(`H1 ledger schedule must contain exactly ${EXPECTED_H1_SCHEDULE_LENGTH} entries`)
  }
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(schedule))
  return requireSha256(digest, 'H1 ledger schedule hash')
}

function bindingFieldsMatch(header: Record<string, unknown>, binding: H1LedgerBindingV2): void {
  const fields = [
    ['definitionSha256', 'definition'],
    ['datasetCommitmentSha256', 'dataset commitment'],
    ['providerIdentityReceiptSha256', 'provider identity receipt'],
    ['expectedResponseModel', 'response model'],
    ['expectedBackendFingerprint', 'backend fingerprint'],
  ] as const
  for (const [field, label] of fields) {
    if (header[field] !== binding[field]) {
      throw new Error(`H1 ledger ${label} binding drifted`)
    }
  }
}

function entryHashMaterial(entry: Omit<H1RunLedgerEntryV2, 'entrySha256'>): Record<string, unknown> {
  const material: Record<string, unknown> = {
    sequence: entry.sequence,
    scheduleIndex: entry.scheduleIndex,
    taskId: entry.taskId,
    arm: entry.arm,
    trial: entry.trial,
    attempt: entry.attempt,
    outcome: entry.outcome,
    evidenceSha256: entry.evidenceSha256,
    previousEntrySha256: entry.previousEntrySha256,
  }
  if (entry.reason !== undefined) material.reason = entry.reason
  if (entry.responseModel !== undefined) material.responseModel = entry.responseModel
  if (entry.systemFingerprint !== undefined) material.systemFingerprint = entry.systemFingerprint
  return material
}

async function hashEntry(
  entry: Omit<H1RunLedgerEntryV2, 'entrySha256'>,
  sha256: Sha256Port,
): Promise<string> {
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(entryHashMaterial(entry)))
  return requireSha256(digest, 'H1 ledger entry hash')
}

function toAttemptRecord(entry: Pick<
  H1RunLedgerEntryV2,
  'taskId' | 'arm' | 'trial' | 'attempt' | 'outcome' | 'reason'
>): AgentAttemptRecord {
  return entry.outcome === 'infrastructure-failure'
    ? {
        taskId: entry.taskId,
        arm: entry.arm,
        trial: entry.trial,
        attempt: entry.attempt,
        kind: entry.outcome,
        reason: entry.reason,
      }
    : {
        taskId: entry.taskId,
        arm: entry.arm,
        trial: entry.trial,
        attempt: entry.attempt,
        kind: entry.outcome,
      }
}

function requireExpectedTuple(
  record: Record<string, unknown>,
  expected: AgentScheduleEntry,
  scheduleIndex: number,
  attempt: number,
): void {
  if (record.scheduleIndex !== scheduleIndex) {
    throw new Error(`H1 ledger schedule order drifted; expected index ${scheduleIndex}`)
  }
  if (record.taskId !== expected.taskId || record.arm !== expected.arm || record.trial !== expected.trial) {
    throw new Error(`H1 ledger entry does not match the next scheduled run at index ${scheduleIndex}`)
  }
  if (record.attempt !== attempt) {
    throw new Error(`H1 ledger attempts must be contiguous; expected attempt ${attempt}`)
  }
}

export async function createH1RunLedgerV2(
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  sha256: Sha256Port,
): Promise<H1RunLedgerV2> {
  validateBinding(binding)
  const scheduleSha256 = await scheduleDigest(schedule, taskIds, sha256)
  const header = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-run-ledger-v2' as const,
    ...binding,
    scheduleSha256,
    scheduleLength: schedule.length,
  })
  return Object.freeze({ header, entries: Object.freeze([]) })
}

export async function validateH1RunLedgerV2(
  ledgerValue: unknown,
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  retryPolicy: AgentRetryPolicy,
  sha256: Sha256Port,
): Promise<H1RunLedgerResumeV2> {
  validateBinding(binding)
  const expectedScheduleSha256 = await scheduleDigest(schedule, taskIds, sha256)

  const ledger = requireRecord(ledgerValue, 'H1 run ledger')
  assertExactKeys(ledger, LEDGER_KEYS, 'H1 run ledger')
  const header = requireRecord(ledger.header, 'H1 run ledger header')
  assertExactKeys(header, HEADER_KEYS, 'H1 run ledger header')
  if (header.schema !== 'dsh-toolchain-m2-h1-run-ledger-v2') {
    throw new Error('H1 run ledger schema drifted')
  }
  bindingFieldsMatch(header, binding)
  if (header.scheduleLength !== schedule.length || header.scheduleLength !== EXPECTED_H1_SCHEDULE_LENGTH) {
    throw new Error('H1 ledger schedule length binding drifted')
  }
  if (header.scheduleSha256 !== expectedScheduleSha256) {
    throw new Error('H1 ledger schedule binding hash drifted')
  }
  requireSha256(header.scheduleSha256, 'H1 ledger stored schedule hash')

  if (!Array.isArray(ledger.entries)) throw new Error('H1 run ledger entries must be an array')

  const attempts: AgentAttemptRecord[] = []
  let scheduleIndex = 0
  let expectedAttempt = 1
  let previousEntrySha256: string | null = null
  let inconclusive = false

  for (let index = 0; index < ledger.entries.length; index += 1) {
    const record = requireRecord(ledger.entries[index], `H1 ledger entry[${index}]`)
    if (record.outcome === 'infrastructure-failure') {
      assertExactKeys(record, INFRA_ENTRY_KEYS, `H1 ledger entry[${index}]`)
    } else if (record.outcome === 'model-outcome') {
      assertExactKeys(record, MODEL_ENTRY_KEYS, `H1 ledger entry[${index}]`)
    } else {
      throw new Error(`H1 ledger entry[${index}] outcome is invalid`)
    }

    if (record.sequence !== index + 1) {
      throw new Error(`H1 ledger hash chain sequence gap at entry ${index + 1}`)
    }
    if (scheduleIndex >= schedule.length) {
      throw new Error('H1 ledger contains entries after the complete schedule')
    }
    const expected = schedule[scheduleIndex]!
    requireExpectedTuple(record, expected, scheduleIndex, expectedAttempt)

    const evidenceSha256 = requireSha256(record.evidenceSha256, `H1 ledger entry[${index}] evidence hash`)
    if (record.previousEntrySha256 !== previousEntrySha256) {
      throw new Error(`H1 ledger hash chain previous-entry link drifted at sequence ${index + 1}`)
    }
    const storedEntrySha256 = requireSha256(record.entrySha256, `H1 ledger entry[${index}] stored hash`)

    const base = {
      sequence: index + 1,
      scheduleIndex,
      taskId: expected.taskId,
      arm: expected.arm,
      trial: expected.trial,
      attempt: expectedAttempt,
      outcome: record.outcome,
      evidenceSha256,
      previousEntrySha256,
    } as const

    let normalized: Omit<H1RunLedgerEntryV2, 'entrySha256'>
    if (record.outcome === 'model-outcome') {
      const responseModel = requireNonEmptyString(record.responseModel, `H1 ledger entry[${index}] response model`)
      const systemFingerprint = requireNonEmptyString(
        record.systemFingerprint,
        `H1 ledger entry[${index}] system fingerprint`,
      )
      if (responseModel !== binding.expectedResponseModel) {
        throw new Error(`H1 ledger provider response model drifted at sequence ${index + 1}`)
      }
      if (systemFingerprint !== binding.expectedBackendFingerprint) {
        throw new Error(`H1 ledger provider backend fingerprint drifted at sequence ${index + 1}`)
      }
      normalized = { ...base, responseModel, systemFingerprint }
    } else {
      const reason = requireNonEmptyString(record.reason, `H1 ledger entry[${index}] infrastructure reason`)
      if (!retryPolicy.retryableReasons.includes(reason)) {
        throw new Error(`H1 ledger infrastructure failure reason is not retryable: ${reason}`)
      }
      normalized = { ...base, reason }
    }

    const computedEntrySha256 = await hashEntry(normalized, sha256)
    if (storedEntrySha256 !== computedEntrySha256) {
      throw new Error(`H1 ledger hash chain tamper detected at sequence ${index + 1}`)
    }

    attempts.push(toAttemptRecord(normalized))
    previousEntrySha256 = storedEntrySha256

    if (normalized.outcome === 'model-outcome') {
      scheduleIndex += 1
      expectedAttempt = 1
    } else if (normalized.attempt <= retryPolicy.maxInfrastructureRetries) {
      expectedAttempt += 1
    } else {
      inconclusive = true
      scheduleIndex += 1
      expectedAttempt = 1
    }
  }

  validateAgentAttempts(attempts, retryPolicy)

  if (scheduleIndex === schedule.length) {
    return Object.freeze({ status: 'COMPLETE' as const, inconclusive })
  }
  const next = schedule[scheduleIndex]!
  return Object.freeze({
    status: 'NEXT' as const,
    scheduleIndex,
    taskId: next.taskId,
    arm: next.arm,
    trial: next.trial,
    attempt: expectedAttempt,
    inconclusive,
  })
}

export async function appendH1RunLedgerAttemptV2(
  ledger: H1RunLedgerV2,
  binding: H1LedgerBindingV2,
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
  retryPolicy: AgentRetryPolicy,
  attempt: H1RunLedgerAttemptInputV2,
  sha256: Sha256Port,
): Promise<H1RunLedgerV2> {
  const resume = await validateH1RunLedgerV2(ledger, binding, schedule, taskIds, retryPolicy, sha256)
  if (resume.status === 'COMPLETE') {
    throw new Error('H1 ledger schedule is complete; no additional attempt may be appended')
  }
  if (
    attempt.scheduleIndex !== resume.scheduleIndex
    || attempt.taskId !== resume.taskId
    || attempt.arm !== resume.arm
    || attempt.trial !== resume.trial
    || attempt.attempt !== resume.attempt
  ) {
    throw new Error('H1 ledger append must match the exact next scheduled run and attempt')
  }

  requireSha256(attempt.evidenceSha256, 'H1 ledger appended evidence hash')
  if (attempt.outcome === 'model-outcome') {
    if (attempt.responseModel !== binding.expectedResponseModel) {
      throw new Error('H1 ledger provider response model drifted before append')
    }
    if (attempt.systemFingerprint !== binding.expectedBackendFingerprint) {
      throw new Error('H1 ledger provider backend fingerprint drifted before append')
    }
  } else {
    requireNonEmptyString(attempt.reason, 'H1 ledger appended infrastructure reason')
    if (!retryPolicy.retryableReasons.includes(attempt.reason)) {
      throw new Error(`H1 ledger infrastructure failure reason is not retryable: ${attempt.reason}`)
    }
  }

  const existingAttempts = ledger.entries.map(toAttemptRecord)
  const proposedAttempt: AgentAttemptRecord = attempt.outcome === 'infrastructure-failure'
    ? {
        taskId: attempt.taskId,
        arm: attempt.arm,
        trial: attempt.trial,
        attempt: attempt.attempt,
        kind: attempt.outcome,
        reason: attempt.reason,
      }
    : {
        taskId: attempt.taskId,
        arm: attempt.arm,
        trial: attempt.trial,
        attempt: attempt.attempt,
        kind: attempt.outcome,
      }
  validateAgentAttempts([...existingAttempts, proposedAttempt], retryPolicy)

  const previousEntrySha256 = ledger.entries.at(-1)?.entrySha256 ?? null
  const base = {
    sequence: ledger.entries.length + 1,
    scheduleIndex: attempt.scheduleIndex,
    taskId: attempt.taskId,
    arm: attempt.arm,
    trial: attempt.trial,
    attempt: attempt.attempt,
    outcome: attempt.outcome,
    evidenceSha256: attempt.evidenceSha256,
    previousEntrySha256,
  } as const
  const normalized: Omit<H1RunLedgerEntryV2, 'entrySha256'> = attempt.outcome === 'infrastructure-failure'
    ? { ...base, reason: attempt.reason }
    : {
        ...base,
        responseModel: attempt.responseModel,
        systemFingerprint: attempt.systemFingerprint,
      }
  const entrySha256 = await hashEntry(normalized, sha256)
  const entry = Object.freeze({ ...normalized, entrySha256 })

  return Object.freeze({
    header: ledger.header,
    entries: Object.freeze([...ledger.entries, entry]),
  })
}
