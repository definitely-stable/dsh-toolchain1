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

type CanonicalJson = null | boolean | number | string | readonly CanonicalJson[] | {
  readonly [key: string]: CanonicalJson
}

const AGENT_ARMS: readonly AgentArm[] = ['A', 'B', 'C']
const TRIALS = [1, 2, 3] as const

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
