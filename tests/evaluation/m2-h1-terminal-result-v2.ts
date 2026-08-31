import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { Sha256Port } from '../../src/model/digest.js'
import {
  canonicalizeEvaluationJson,
  type AgentRetryPolicy,
  type AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'
import {
  validateContentRef,
  type ContentRef,
  type RunControl,
} from './m2-agent-execution-evidence.js'
import { validateAgentV2ResultAgainstDefinition } from './m2-agent-eval-v2-integrity.js'
import type { ProcessAttemptEvidenceResult } from './m2-agent-process-runner.js'
import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import {
  adjudicateH1ModelOutcomeV2,
  validateH1TaskSuccessRuleV2,
  type H1TaskSuccessRuleV2,
  type H1TaskSuccessV2,
} from './m2-h1-task-adjudication-v2.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  validateH1RunLedgerV2,
  type H1LedgerBindingV2,
  type H1RunLedgerResumeV2,
  type H1RunLedgerV2,
} from './m2-h1-run-ledger-v2.js'
import {
  analyzeH1TerminalObservationsV2,
  type H1TerminalAnalysisV2,
  type H1TerminalObservationV2,
} from './m2-h1-terminal-analysis-v2.js'

const ATTEMPTS_DIR = 'attempts'
const LEDGER_FILE = 'ledger.json'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const WRAPPER_KEYS = Object.freeze(['schema', 'pendingIntentSha256', 'evidenceSha256', 'result'])

export interface H1TerminalRunStoreSnapshotV2 {
  readonly ledger: H1RunLedgerV2
  readonly resume: Extract<H1RunLedgerResumeV2, { readonly status: 'COMPLETE' }>
  readonly evidenceBySha256: ReadonlyMap<string, ProcessAttemptEvidenceResult>
}

export interface H1TerminalResultBuildV2 {
  readonly result: Record<string, unknown>
  readonly analysis: H1TerminalAnalysisV2
  readonly observations: readonly H1TerminalObservationV2[]
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

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256 digest`)
  }
  return value
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected)
  const unknown = Object.keys(record).filter(key => !expectedSet.has(key))
  const missing = expected.filter(key => !(key in record))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
  if (missing.length > 0) throw new Error(`${label} is missing required key(s): ${missing.join(', ')}`)
}

async function readCanonicalJson(path: string, label: string): Promise<unknown> {
  const bytes = await readFile(path, 'utf8')
  let value: unknown
  try {
    value = JSON.parse(bytes) as unknown
  } catch (error) {
    throw new Error(`${label} JSON parse failed`, { cause: error })
  }
  if (canonicalizeEvaluationJson(value) !== bytes) throw new Error(`${label} must use canonical JSON bytes`)
  return value
}

function parseStructuredRef<T>(ref: ContentRef, label: string): T {
  let value: unknown
  try {
    value = JSON.parse(ref.inline) as unknown
  } catch (error) {
    throw new Error(`${label} retained JSON parse failed`, { cause: error })
  }
  if (canonicalizeEvaluationJson(value) !== ref.inline) throw new Error(`${label} retained JSON is not canonical`)
  return value as T
}

async function readEvidenceWrappers(
  rootDir: string,
  sha256: Sha256Port,
): Promise<ReadonlyMap<string, ProcessAttemptEvidenceResult>> {
  const directory = join(rootDir, ATTEMPTS_DIR)
  let names: readonly string[]
  try {
    names = (await readdir(directory)).filter(name => name.endsWith('.json')).toSorted()
  } catch (error) {
    if (isErrno(error, 'ENOENT')) throw new Error('H1 terminal run-store is missing durable attempt evidence directory')
    throw error
  }

  const byHash = new Map<string, ProcessAttemptEvidenceResult>()
  for (const name of names) {
    const wrapper = requireRecord(
      await readCanonicalJson(join(directory, name), `H1 durable attempt evidence ${name}`),
      `H1 durable attempt evidence ${name}`,
    )
    assertExactKeys(wrapper, WRAPPER_KEYS, `H1 durable attempt evidence ${name}`)
    if (wrapper.schema !== 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2') {
      throw new Error(`H1 durable attempt evidence ${name} schema drifted`)
    }
    const pendingIntentSha256 = requireSha256(
      wrapper.pendingIntentSha256,
      `H1 durable attempt evidence ${name} pending intent hash`,
    )
    if (name !== `${pendingIntentSha256}.json`) {
      throw new Error(`H1 durable attempt evidence filename does not match pending intent hash: ${name}`)
    }
    const storedHash = requireSha256(wrapper.evidenceSha256, `H1 durable attempt evidence ${name} hash`)
    const result = requireRecord(wrapper.result, `H1 durable attempt evidence ${name} result`) as unknown as ProcessAttemptEvidenceResult
    const computedHash = await sha256.sha256Utf8(canonicalizeEvaluationJson(result))
    if (storedHash !== computedHash) throw new Error(`H1 durable attempt evidence hash drifted: ${name}`)
    if (byHash.has(storedHash)) throw new Error(`H1 durable attempt evidence hash is duplicated: ${storedHash}`)
    byHash.set(storedHash, result)
  }
  return byHash
}

export async function readCompletedH1RunStoreV2(input: {
  readonly rootDir: string
  readonly binding: H1LedgerBindingV2
  readonly schedule: readonly AgentScheduleEntry[]
  readonly taskIds: readonly string[]
  readonly retryPolicy: AgentRetryPolicy
  readonly sha256: Sha256Port
}): Promise<H1TerminalRunStoreSnapshotV2> {
  const ledgerValue = await readCanonicalJson(join(input.rootDir, LEDGER_FILE), 'H1 terminal canonical ledger')
  const resume = await validateH1RunLedgerV2(
    ledgerValue,
    input.binding,
    input.schedule,
    input.taskIds,
    input.retryPolicy,
    input.sha256,
  )
  if (resume.status !== 'COMPLETE') {
    throw new Error(`H1 terminal adjudication requires a COMPLETE durable ledger, got ${resume.status}`)
  }
  const ledger = ledgerValue as H1RunLedgerV2
  const evidenceBySha256 = await readEvidenceWrappers(input.rootDir, input.sha256)
  const referenced = new Set(ledger.entries.map(entry => entry.evidenceSha256))
  if (referenced.size !== ledger.entries.length) {
    throw new Error('H1 terminal ledger contains duplicate durable evidence references')
  }
  if (evidenceBySha256.size !== referenced.size) {
    throw new Error(
      `H1 terminal durable evidence cardinality ${evidenceBySha256.size} does not match ledger ${referenced.size}`,
    )
  }
  for (const evidenceSha256 of referenced) {
    if (!evidenceBySha256.has(evidenceSha256)) {
      throw new Error(`H1 terminal ledger references missing durable evidence ${evidenceSha256}`)
    }
  }
  for (const evidenceSha256 of evidenceBySha256.keys()) {
    if (!referenced.has(evidenceSha256)) {
      throw new Error(`H1 terminal run-store contains unreferenced durable evidence ${evidenceSha256}`)
    }
  }
  return Object.freeze({ ledger, resume, evidenceBySha256 })
}

export function reAdjudicateH1ModelAttemptV2(
  rule: H1TaskSuccessRuleV2,
  rawAnswer: string,
  storedClaims: readonly unknown[],
  storedTaskSuccess: H1TaskSuccessV2,
  truth: ApiTruthUniverseV2,
): ReturnType<typeof adjudicateH1ModelOutcomeV2> {
  const fresh = adjudicateH1ModelOutcomeV2(rule, rawAnswer, truth)
  if (
    canonicalizeEvaluationJson(fresh.parsedApiClaims) !== canonicalizeEvaluationJson(storedClaims)
    || fresh.taskSuccess !== storedTaskSuccess
  ) {
    throw new Error('H1 terminal fresh adjudication drifted from persisted model-outcome adjudication')
  }
  return fresh
}

function taskRulesFromDataset(
  hiddenDataset: unknown,
  expectedTaskIds: readonly string[],
): ReadonlyMap<string, H1TaskSuccessRuleV2> {
  const dataset = requireRecord(hiddenDataset, 'H1 terminal hidden dataset')
  const tasks = requireArray(dataset.tasks, 'H1 terminal hidden dataset tasks')
  const rules = new Map<string, H1TaskSuccessRuleV2>()
  for (let index = 0; index < tasks.length; index += 1) {
    const task = requireRecord(tasks[index], `H1 terminal hidden task[${index}]`)
    const id = requireString(task.id, `H1 terminal hidden task[${index}].id`)
    if (rules.has(id)) throw new Error(`H1 terminal hidden dataset contains duplicate task ${id}`)
    rules.set(id, validateH1TaskSuccessRuleV2(task.successRule))
  }
  if (rules.size !== expectedTaskIds.length) {
    throw new Error('H1 terminal hidden task-rule count drifted from the frozen model task projection')
  }
  for (const taskId of expectedTaskIds) {
    if (!rules.has(taskId)) throw new Error(`H1 terminal hidden dataset is missing frozen task ${taskId}`)
  }
  return rules
}

async function assertAttemptIdentity(
  result: ProcessAttemptEvidenceResult,
  expected: H1RunLedgerV2['entries'][number],
  sha256: Sha256Port,
): Promise<void> {
  const attempt = result.attempt
  if (attempt.attempt !== expected.attempt || attempt.outcome !== expected.outcome) {
    throw new Error('H1 terminal durable attempt tuple drifted from canonical ledger')
  }
  const runControlRef = attempt.executionEvidence.runControl
  await validateContentRef(runControlRef, sha256)
  const control = parseStructuredRef<RunControl>(runControlRef, 'H1 terminal RunControl')
  if (
    control.schema !== 'dsh-toolchain-m2-run-control-v1'
    || control.phase !== 'H1'
    || control.taskId !== expected.taskId
    || control.arm !== expected.arm
    || control.trial !== expected.trial
    || control.attempt !== expected.attempt
  ) {
    throw new Error('H1 terminal durable RunControl identity drifted from canonical ledger')
  }
}

async function buildRunsAndObservations(input: {
  readonly frozen: FrozenH1ExecutionDefinitionV2
  readonly hiddenDataset: unknown
  readonly truth: ApiTruthUniverseV2
  readonly snapshot: H1TerminalRunStoreSnapshotV2
  readonly sha256: Sha256Port
}): Promise<{
  readonly runs: readonly Record<string, unknown>[]
  readonly observations: readonly H1TerminalObservationV2[]
}> {
  const taskIds = input.frozen.modelTasks.map(task => task.id)
  const rules = taskRulesFromDataset(input.hiddenDataset, taskIds)
  const oracle = requireRecord(input.frozen.definition.oracle, 'H1 terminal frozen oracle')
  const oracleSha256 = requireSha256(oracle.sha256, 'H1 terminal frozen Truth v2 SHA')
  if (input.truth.fingerprint !== `dsh-api-truth-v2:${oracleSha256}`) {
    throw new Error('H1 terminal rebuilt Truth v2 fingerprint drifted from frozen oracle')
  }

  const entriesByScheduleIndex = new Map<number, H1RunLedgerV2['entries'][number][]>()
  for (const entry of input.snapshot.ledger.entries) {
    const group = entriesByScheduleIndex.get(entry.scheduleIndex) ?? []
    group.push(entry)
    entriesByScheduleIndex.set(entry.scheduleIndex, group)
  }

  const runs: Record<string, unknown>[] = []
  const observations: H1TerminalObservationV2[] = []
  for (let scheduleIndex = 0; scheduleIndex < input.frozen.schedule.length; scheduleIndex += 1) {
    const scheduled = input.frozen.schedule[scheduleIndex]!
    const entries = entriesByScheduleIndex.get(scheduleIndex) ?? []
    if (entries.length === 0) throw new Error(`H1 COMPLETE ledger is missing schedule index ${scheduleIndex}`)
    const attempts: Record<string, unknown>[] = []
    let modelObservation: H1TerminalObservationV2 | undefined

    for (const entry of entries) {
      const result = input.snapshot.evidenceBySha256.get(entry.evidenceSha256)
      if (result === undefined) throw new Error(`H1 terminal durable evidence disappeared for ${entry.evidenceSha256}`)
      await assertAttemptIdentity(result, entry, input.sha256)
      const attempt = result.attempt
      if (attempt.outcome === 'model-outcome') {
        await validateContentRef(attempt.rawAnswer, input.sha256)
        const rule = rules.get(entry.taskId)!
        const fresh = reAdjudicateH1ModelAttemptV2(
          rule,
          attempt.rawAnswer.inline,
          attempt.parsedApiClaims,
          attempt.taskSuccess,
          input.truth,
        )
        const unresolvedApi = fresh.parsedApiClaims.some(claim => claim.classification === 'UNKNOWN')
        modelObservation = Object.freeze({
          taskId: scheduled.taskId,
          arm: scheduled.arm,
          trial: scheduled.trial,
          invalidApi: fresh.parsedApiClaims.some(claim => claim.classification === 'INVALID') ? 1 : 0,
          taskSuccess: fresh.taskSuccess,
          unresolvedApi,
        })
        attempts.push(Object.freeze({
          ...structuredClone(attempt),
          parsedApiClaims: structuredClone(fresh.parsedApiClaims),
          taskSuccess: fresh.taskSuccess,
        }))
      } else {
        attempts.push(Object.freeze(structuredClone(attempt) as Record<string, unknown>))
      }
    }

    runs.push(Object.freeze({
      taskId: scheduled.taskId,
      arm: scheduled.arm,
      trial: scheduled.trial,
      attempts: Object.freeze(attempts),
    }))
    observations.push(modelObservation ?? Object.freeze({
      taskId: scheduled.taskId,
      arm: scheduled.arm,
      trial: scheduled.trial,
      invalidApi: null,
      taskSuccess: null,
      unresolvedApi: scheduled.arm === 'B' || scheduled.arm === 'C',
    }))
  }
  return Object.freeze({ runs: Object.freeze(runs), observations: Object.freeze(observations) })
}

function requireIsoTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('H1 terminal executedAt must be a canonical ISO timestamp')
  }
  return value
}

export async function buildH1TerminalResultV2(input: {
  readonly frozen: FrozenH1ExecutionDefinitionV2
  readonly hiddenDataset: unknown
  readonly truth: ApiTruthUniverseV2
  readonly snapshot: H1TerminalRunStoreSnapshotV2
  readonly executedAt: string
  readonly sha256: Sha256Port
}): Promise<H1TerminalResultBuildV2> {
  const built = await buildRunsAndObservations(input)
  const analysis = await analyzeH1TerminalObservationsV2(
    built.observations,
    input.snapshot.resume.inconclusive,
    input.sha256,
  )
  const result: Record<string, unknown> = {
    ...structuredClone(input.frozen.definition),
    recordType: 'result',
    status: analysis.status,
    definitionSha256: input.frozen.definitionSha256,
    executedAt: requireIsoTimestamp(input.executedAt),
    runs: built.runs,
  }
  await validateAgentV2ResultAgainstDefinition(input.frozen.definition, result, input.sha256)
  return Object.freeze({
    result: Object.freeze(result),
    analysis,
    observations: built.observations,
  })
}
