import type { Sha256Port } from '../../src/model/digest.js'

export type AgentArm = 'A' | 'B' | 'C'

export interface AgentScheduleEntry {
  readonly taskId: string
  readonly trial: 1 | 2 | 3
  readonly arm: AgentArm
}

export type AgentAttemptKind = 'infrastructure-failure' | 'model-outcome'

export interface AgentAttemptRecord {
  readonly taskId: string
  readonly arm: AgentArm
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly kind: AgentAttemptKind
  readonly reason?: string
}

export interface AgentRetryPolicy {
  readonly maxInfrastructureRetries: number
  readonly modelOutcomeRetries: 0
  readonly retryableReasons: readonly string[]
}

export interface AgentHoldoutCommitmentState {
  readonly status: string
  readonly runAllowed: boolean
  readonly commitmentSha256: string | null
  readonly taskCount: number | null
  readonly prerequisites: {
    readonly p0Completed: boolean
    readonly mcidFrozen: boolean
    readonly noninferiorityMarginFrozen: boolean
    readonly taskSetHashCommitted: boolean
  }
}

type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | {
  readonly [key: string]: CanonicalJson
}

type AgentResultStatus = 'CALIBRATED' | 'PASS' | 'NEEDS-IMPROVEMENT' | 'INCONCLUSIVE'

const AGENT_ARMS: readonly AgentArm[] = ['A', 'B', 'C']
const TRIALS = [1, 2, 3] as const
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RESULT_ONLY_FIELDS = new Set(['definitionSha256', 'executedAt', 'runs'])
const AGENT_RESULT_STATUSES: readonly AgentResultStatus[] = [
  'CALIBRATED',
  'PASS',
  'NEEDS-IMPROVEMENT',
  'INCONCLUSIVE',
]

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeCanonicalJson(value: unknown, path = '$'): CanonicalJson {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number is not canonical JSON at ${path}`)
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCanonicalJson(item, `${path}[${index}]`))
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const normalized: Record<string, CanonicalJson> = {}
    for (const key of Object.keys(record).toSorted(compareCodePoints)) {
      const item = record[key]
      if (item === undefined) throw new Error(`Undefined value is not canonical JSON at ${path}.${key}`)
      normalized[key] = normalizeCanonicalJson(item, `${path}.${key}`)
    }
    return normalized
  }

  throw new Error(`Unsupported canonical JSON value at ${path}`)
}

export function canonicalizeEvaluationJson(value: unknown): string {
  return JSON.stringify(normalizeCanonicalJson(value))
}

export async function hashEvaluationDefinition(
  definition: unknown,
  sha256: Sha256Port,
): Promise<string> {
  return sha256.sha256Utf8(canonicalizeEvaluationJson(definition))
}

export function assertAgentHoldoutCommitted(commitment: AgentHoldoutCommitmentState): void {
  if (commitment.status !== 'COMMITTED') {
    throw new Error(`H1 holdout is not committed: ${commitment.status}`)
  }
  if (commitment.runAllowed !== true) {
    throw new Error('H1 holdout runAllowed must be true after commitment')
  }
  if (commitment.commitmentSha256 === null || !SHA256_PATTERN.test(commitment.commitmentSha256)) {
    throw new Error('H1 holdout commitmentSha256 must be an exact lowercase SHA-256 digest')
  }
  if (commitment.taskCount === null || !Number.isInteger(commitment.taskCount) || commitment.taskCount < 1) {
    throw new Error('H1 holdout taskCount must be a positive integer')
  }
  if (
    !commitment.prerequisites.p0Completed
    || !commitment.prerequisites.mcidFrozen
    || !commitment.prerequisites.noninferiorityMarginFrozen
    || !commitment.prerequisites.taskSetHashCommitted
  ) {
    throw new Error('H1 holdout prerequisite set is incomplete')
  }
}

function assertTaskIds(taskIds: readonly string[]): void {
  if (taskIds.length === 0) throw new Error('Agent schedule requires at least one task')
  const seen = new Set<string>()
  for (const taskId of taskIds) {
    if (taskId.trim().length === 0) throw new Error('Agent schedule task ids must be non-empty')
    if (seen.has(taskId)) throw new Error(`Agent schedule task id is duplicated: ${taskId}`)
    seen.add(taskId)
  }
}

export async function createBalancedAgentSchedule(
  taskIds: readonly string[],
  seed: string,
  sha256: Sha256Port,
): Promise<readonly AgentScheduleEntry[]> {
  assertTaskIds(taskIds)
  if (seed.length === 0) throw new Error('Agent schedule seed must be non-empty')

  const candidates: AgentScheduleEntry[] = []
  for (const taskId of taskIds) {
    for (const trial of TRIALS) {
      for (const arm of AGENT_ARMS) candidates.push({ taskId, trial, arm })
    }
  }

  const keyed = await Promise.all(candidates.map(async entry => ({
    entry,
    key: await sha256.sha256Utf8(`${seed}\u0000${entry.taskId}\u0000${entry.trial}\u0000${entry.arm}`),
  })))

  return keyed
    .toSorted((left, right) => compareCodePoints(left.key, right.key)
      || compareCodePoints(left.entry.taskId, right.entry.taskId)
      || left.entry.trial - right.entry.trial
      || compareCodePoints(left.entry.arm, right.entry.arm))
    .map(item => item.entry)
}

export function validateBalancedAgentSchedule(
  schedule: readonly AgentScheduleEntry[],
  taskIds: readonly string[],
): void {
  assertTaskIds(taskIds)
  const expected = new Set<string>()
  for (const taskId of taskIds) {
    for (const trial of TRIALS) {
      for (const arm of AGENT_ARMS) expected.add(`${taskId}\u0000${trial}\u0000${arm}`)
    }
  }

  if (schedule.length !== expected.size) {
    throw new Error(`Agent schedule length ${schedule.length} does not match required ${expected.size}`)
  }

  const observed = new Set<string>()
  for (const entry of schedule) {
    if (!taskIds.includes(entry.taskId)) throw new Error(`Agent schedule has unknown task ${entry.taskId}`)
    if (!TRIALS.includes(entry.trial)) throw new Error(`Agent schedule has invalid trial ${entry.trial}`)
    if (!AGENT_ARMS.includes(entry.arm)) throw new Error(`Agent schedule has invalid arm ${entry.arm}`)
    const key = `${entry.taskId}\u0000${entry.trial}\u0000${entry.arm}`
    if (observed.has(key)) throw new Error(`Agent schedule has duplicate entry ${key}`)
    observed.add(key)
  }

  for (const key of expected) {
    if (!observed.has(key)) throw new Error(`Agent schedule is missing required entry ${key}`)
  }
}

function attemptGroupKey(attempt: AgentAttemptRecord): string {
  return `${attempt.taskId}\u0000${attempt.arm}\u0000${attempt.trial}`
}

function validateRetryPolicy(policy: AgentRetryPolicy): void {
  if (!Number.isInteger(policy.maxInfrastructureRetries) || policy.maxInfrastructureRetries < 0) {
    throw new Error('maxInfrastructureRetries must be a non-negative integer')
  }
  if (policy.modelOutcomeRetries !== 0) throw new Error('Model outcome retries must remain zero')
  if (policy.retryableReasons.length === 0 || new Set(policy.retryableReasons).size !== policy.retryableReasons.length) {
    throw new Error('Retryable infrastructure reasons must be non-empty and unique')
  }
}

export function validateAgentAttempts(
  attempts: readonly AgentAttemptRecord[],
  policy: AgentRetryPolicy,
): void {
  validateRetryPolicy(policy)
  const groups = new Map<string, AgentAttemptRecord[]>()

  for (const attempt of attempts) {
    if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
      throw new Error('Agent attempt numbers must be positive integers')
    }
    const key = attemptGroupKey(attempt)
    const group = groups.get(key) ?? []
    group.push(attempt)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const ordered = group.toSorted((left, right) => left.attempt - right.attempt)
    let infrastructureFailures = 0
    let modelOutcomes = 0

    for (let index = 0; index < ordered.length; index += 1) {
      const attempt = ordered[index]!
      const expectedAttempt = index + 1
      if (attempt.attempt !== expectedAttempt) {
        throw new Error(`Agent attempts must be contiguous from 1; expected ${expectedAttempt}, got ${attempt.attempt}`)
      }

      if (attempt.kind === 'model-outcome') {
        modelOutcomes += 1
        if (modelOutcomes > 1 || index !== ordered.length - 1) {
          throw new Error('Model outcome may occur exactly once and may never be retried')
        }
        if (attempt.reason !== undefined) throw new Error('Model outcome must not carry an infrastructure retry reason')
        continue
      }

      infrastructureFailures += 1
      if (attempt.reason === undefined || !policy.retryableReasons.includes(attempt.reason)) {
        throw new Error(`Infrastructure failure reason is not retryable: ${attempt.reason ?? '<missing>'}`)
      }
      if (infrastructureFailures > policy.maxInfrastructureRetries) {
        throw new Error(
          `Infrastructure retry budget exceeded: ${infrastructureFailures} > ${policy.maxInfrastructureRetries}`,
        )
      }
    }
  }
}

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

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function parseArm(value: unknown, label: string): AgentArm {
  if (value !== 'A' && value !== 'B' && value !== 'C') throw new Error(`${label} must be A, B or C`)
  return value
}

function parseTrial(value: unknown, label: string): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) throw new Error(`${label} must be trial 1, 2 or 3`)
  return value
}

function parseResultStatus(value: unknown): AgentResultStatus {
  if (typeof value !== 'string' || !AGENT_RESULT_STATUSES.includes(value as AgentResultStatus)) {
    throw new Error('Agent evaluation result status must be a terminal result status')
  }
  return value as AgentResultStatus
}

function parseScheduleEntry(value: unknown, label: string): AgentScheduleEntry {
  const record = requireRecord(value, label)
  return {
    taskId: requireString(record.taskId, `${label}.taskId`),
    trial: parseTrial(record.trial, `${label}.trial`),
    arm: parseArm(record.arm, `${label}.arm`),
  }
}

function parseRetryPolicy(value: unknown): AgentRetryPolicy {
  const record = requireRecord(value, 'Agent evaluation retries')
  const maxInfrastructureRetries = record.maxInfrastructureRetries
  if (!Number.isInteger(maxInfrastructureRetries) || typeof maxInfrastructureRetries !== 'number' || maxInfrastructureRetries < 0) {
    throw new Error('maxInfrastructureRetries must be a non-negative integer')
  }
  if (record.modelOutcomeRetries !== 0) throw new Error('Model outcome retries must remain zero')
  const retryableReasons = requireArray(record.retryableReasons, 'retryableReasons')
    .map((reason, index) => requireString(reason, `retryableReasons[${index}]`))
  return { maxInfrastructureRetries, modelOutcomeRetries: 0, retryableReasons }
}

function bindingProjection(record: Record<string, unknown>): Record<string, unknown> {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'recordType' || key === 'status' || RESULT_ONLY_FIELDS.has(key)) continue
    projection[key] = value
  }
  return projection
}

function parseResultAttempts(
  run: Record<string, unknown>,
  taskId: string,
  arm: AgentArm,
  trial: 1 | 2 | 3,
  runIndex: number,
): readonly AgentAttemptRecord[] {
  const rawAttempts = requireArray(run.attempts, `Agent result runs[${runIndex}].attempts`)
  if (rawAttempts.length === 0) throw new Error(`Agent result runs[${runIndex}] must record at least one attempt`)
  return rawAttempts.map((value, attemptIndex) => {
    const attempt = requireRecord(value, `Agent result runs[${runIndex}].attempts[${attemptIndex}]`)
    const attemptNumber = requirePositiveInteger(
      attempt.attempt,
      `Agent result runs[${runIndex}].attempts[${attemptIndex}].attempt`,
    )
    const outcome = attempt.outcome
    if (outcome !== 'model-outcome' && outcome !== 'infrastructure-failure') {
      throw new Error(`Agent result runs[${runIndex}].attempts[${attemptIndex}].outcome is invalid`)
    }
    const reason = attempt.reason === undefined
      ? undefined
      : requireString(attempt.reason, `Agent result runs[${runIndex}].attempts[${attemptIndex}].reason`)
    return {
      taskId,
      arm,
      trial,
      attempt: attemptNumber,
      kind: outcome,
      ...(reason === undefined ? {} : { reason }),
    }
  })
}

function assertResolvedDecisionRun(
  run: Record<string, unknown>,
  arm: AgentArm,
  runIndex: number,
  status: AgentResultStatus,
): void {
  if (status === 'INCONCLUSIVE') return

  const rawAttempts = requireArray(run.attempts, `Agent result runs[${runIndex}].attempts`)
  const modelOutcomes = rawAttempts
    .map((attempt, attemptIndex) => requireRecord(
      attempt,
      `Agent result runs[${runIndex}].attempts[${attemptIndex}]`,
    ))
    .filter(attempt => attempt.outcome === 'model-outcome')
  if (modelOutcomes.length !== 1) {
    throw new Error(
      `Agent result status ${status} requires exactly one model outcome for every scheduled run; use INCONCLUSIVE when execution evidence is incomplete`,
    )
  }

  if (arm === 'A') return
  const outcome = modelOutcomes[0]!
  if (outcome.taskSuccess !== 'SUCCESS' && outcome.taskSuccess !== 'FAILURE') {
    throw new Error(
      `Agent result status ${status} requires resolved B/C task success; UNKNOWN requires INCONCLUSIVE`,
    )
  }
  const claims = requireArray(outcome.parsedApiClaims, `Agent result runs[${runIndex}] B/C parsed API claims`)
  for (let claimIndex = 0; claimIndex < claims.length; claimIndex += 1) {
    const claim = requireRecord(claims[claimIndex], `Agent result runs[${runIndex}] API claim[${claimIndex}]`)
    if (claim.classification === 'UNKNOWN') {
      throw new Error(
        `Agent result status ${status} cannot contain unresolved B/C API claims; UNKNOWN requires INCONCLUSIVE`,
      )
    }
    if (claim.classification !== 'VALID' && claim.classification !== 'INVALID') {
      throw new Error(`Agent result runs[${runIndex}] API claim[${claimIndex}] has invalid classification`)
    }
  }
}

export async function validateAgentResultAgainstDefinition(
  definition: unknown,
  result: unknown,
  sha256: Sha256Port,
): Promise<void> {
  const definitionRecord = requireRecord(definition, 'Agent evaluation definition')
  const resultRecord = requireRecord(result, 'Agent evaluation result')
  if (definitionRecord.recordType !== 'definition') {
    throw new Error('Agent evaluation definition recordType must be definition')
  }
  if (resultRecord.recordType !== 'result') {
    throw new Error('Agent evaluation result recordType must be result')
  }
  const resultStatus = parseResultStatus(resultRecord.status)

  const expectedHash = await hashEvaluationDefinition(definitionRecord, sha256)
  if (resultRecord.definitionSha256 !== expectedHash) {
    throw new Error(`Agent result definition hash mismatch: expected ${expectedHash}`)
  }

  if (
    canonicalizeEvaluationJson(bindingProjection(resultRecord))
    !== canonicalizeEvaluationJson(bindingProjection(definitionRecord))
  ) {
    throw new Error('Agent result preregistration fields do not match the frozen definition')
  }

  const runOrder = requireRecord(definitionRecord.runOrder, 'Agent evaluation definition runOrder')
  const rawSchedule = requireArray(runOrder.schedule, 'Agent evaluation definition runOrder.schedule')
  const schedule = rawSchedule.map((entry, index) => parseScheduleEntry(entry, `Agent schedule[${index}]`))
  const taskIds = [...new Set(schedule.map(entry => entry.taskId))]
  validateBalancedAgentSchedule(schedule, taskIds)

  const dataset = requireRecord(definitionRecord.dataset, 'Agent evaluation definition dataset')
  const taskCount = requirePositiveInteger(dataset.taskCount, 'Agent evaluation definition dataset.taskCount')
  if (taskCount !== taskIds.length) {
    throw new Error(`Agent schedule task count ${taskIds.length} does not match dataset.taskCount ${taskCount}`)
  }

  const rawRuns = requireArray(resultRecord.runs, 'Agent evaluation result runs')
  if (rawRuns.length !== schedule.length) {
    throw new Error(`Agent result schedule coverage ${rawRuns.length} does not match frozen schedule ${schedule.length}`)
  }

  const attempts: AgentAttemptRecord[] = []
  for (let index = 0; index < schedule.length; index += 1) {
    const expected = schedule[index]!
    const run = requireRecord(rawRuns[index], `Agent result runs[${index}]`)
    const taskId = requireString(run.taskId, `Agent result runs[${index}].taskId`)
    const arm = parseArm(run.arm, `Agent result runs[${index}].arm`)
    const trial = parseTrial(run.trial, `Agent result runs[${index}].trial`)
    if (taskId !== expected.taskId || arm !== expected.arm || trial !== expected.trial) {
      throw new Error(
        `Agent result schedule mismatch at index ${index}: expected ${expected.taskId}/${expected.trial}/${expected.arm}, got ${taskId}/${trial}/${arm}`,
      )
    }
    assertResolvedDecisionRun(run, arm, index, resultStatus)
    attempts.push(...parseResultAttempts(run, taskId, arm, trial, index))
  }

  validateAgentAttempts(attempts, parseRetryPolicy(definitionRecord.retries))
}
