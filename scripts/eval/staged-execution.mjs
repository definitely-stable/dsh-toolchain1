import { adjudicateDevelopmentClaim } from './staged-adjudication.mjs'
import { parseDevelopmentStructuredResult } from './structured-result.mjs'

const TERMINAL_REASON_PATTERN = /^[a-z0-9_-]{1,64}$/u

/**
 * @typedef {{ ordinal: number; taskId: string; arm: 'B'|'C'; repetition: 1 }} StagedCall
 * @typedef {{ id: string; domain: string; prompt: string; successRule: Readonly<Record<string, unknown>> }} StagedTask
 * @typedef {{ arm: 'B'|'C'; formatValid: boolean; decisionResolved: boolean; infrastructureFailures: number; attemptCount: number; hasModelOutcome: boolean; measurementAttempted: boolean; unrecoveredInfrastructure: boolean; terminalTransportReason?: string }} StagedMeasurement
 * @typedef {{ attempts: number; infrastructureFailures: number; wallTimeMs: number; usage?: Readonly<Record<string, unknown>>; toolUsage?: Readonly<Record<string, unknown>> }} StagedCost
 * @typedef {{ code: string; summary: string }} StagedFailure
 * @typedef {{ apiValid: boolean }} StagedDecision
 * @typedef {{ kind: 'completed' } | { kind: 'budget-exhausted'; reason: 'tool_budget_exhausted' }} StagedProductOutcome
 * @typedef {{ call: StagedCall; measurement: StagedMeasurement; cost: StagedCost; productOutcome?: StagedProductOutcome; decision?: StagedDecision; failure?: StagedFailure }} StagedExecutionResult
 */

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`)
  return Number(value)
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return Number(value)
}

function requireNonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`)
  return value
}

function optionalTerminalTransportReason(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !TERMINAL_REASON_PATTERN.test(value)) {
    throw new Error('terminalTransportReason must use the closed staged transport reason format')
  }
  return value
}

/** @returns {Readonly<StagedMeasurement>} */
function measurement(call, fields) {
  return Object.freeze({
    arm: call.arm,
    formatValid: fields.formatValid,
    decisionResolved: fields.decisionResolved,
    infrastructureFailures: fields.infrastructureFailures,
    attemptCount: fields.attemptCount,
    hasModelOutcome: fields.hasModelOutcome,
    measurementAttempted: fields.measurementAttempted,
    unrecoveredInfrastructure: fields.unrecoveredInfrastructure,
    ...(fields.terminalTransportReason === undefined ? {} : { terminalTransportReason: fields.terminalTransportReason }),
  })
}

/** @returns {Readonly<StagedCost>} */
function cost(result, attempts, infrastructureFailures, wallTimeMs) {
  return Object.freeze({
    attempts,
    infrastructureFailures,
    wallTimeMs,
    ...(result.usage === undefined ? {} : { usage: Object.freeze({ ...result.usage }) }),
    ...(result.toolUsage === undefined ? {} : { toolUsage: Object.freeze({ ...result.toolUsage }) }),
  })
}

/** @returns {Readonly<StagedFailure>} */
function failure(code, summary) {
  return Object.freeze({ code, summary })
}

/** @param {StagedExecutionResult} value @returns {Readonly<StagedExecutionResult>} */
function freezeResult(value) {
  return Object.freeze(value)
}

/**
 * @param {StagedCall} call
 * @param {StagedTask} task
 * @param {(call: StagedCall, task: StagedTask) => Promise<Record<string, unknown>>} execute
 * @returns {Promise<Readonly<StagedExecutionResult>>}
 */
export async function executeStagedCall(call, task, execute) {
  if (typeof execute !== 'function') throw new Error('staged execution requires an executor function')
  if (task === null || typeof task !== 'object' || task.id !== call.taskId) {
    throw new Error(`staged execution task invariant failed for ${call.taskId}`)
  }
  const raw = await execute(call, task)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('executor result must be an object')

  const attempts = requirePositiveInteger(raw.attempts, 'attempts')
  const infrastructureFailures = requireNonNegativeInteger(raw.infrastructureFailures, 'infrastructureFailures')
  if (infrastructureFailures > attempts) throw new Error('infrastructureFailures cannot exceed attempts')
  const wallTimeMs = requireNonNegativeNumber(raw.wallTimeMs, 'wallTimeMs')
  const resultCost = cost(raw, attempts, infrastructureFailures, wallTimeMs)

  if (raw.transportStatus === 'infrastructure-failure') {
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: false,
        measurementAttempted: false,
        unrecoveredInfrastructure: true,
      }),
      cost: resultCost,
      failure: failure('UNRECOVERED_INFRASTRUCTURE', 'No model outcome was recovered after the authorized attempts.'),
    })
  }

  const terminalTransportReason = optionalTerminalTransportReason(raw.terminalTransportReason)

  if (raw.transportStatus === 'product-terminal') {
    if (raw.productTerminalReason !== 'tool_budget_exhausted') {
      throw new Error(`Unknown staged product terminal reason: ${String(raw.productTerminalReason)}`)
    }
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        measurementAttempted: false,
        unrecoveredInfrastructure: false,
        terminalTransportReason,
      }),
      productOutcome: Object.freeze({ kind: 'budget-exhausted', reason: 'tool_budget_exhausted' }),
      cost: resultCost,
      failure: failure('PRODUCT_BUDGET_EXHAUSTED', 'Product exploration exhausted the frozen tool-call budget before measurement finalization.'),
    })
  }

  if (raw.transportStatus === 'unsupported') {
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        measurementAttempted: true,
        unrecoveredInfrastructure: false,
        terminalTransportReason,
      }),
      productOutcome: Object.freeze({ kind: 'completed' }),
      cost: resultCost,
      failure: failure('STRUCTURED_TRANSPORT_UNSUPPORTED', 'Provider did not support the required structured-result transport.'),
    })
  }

  if (raw.transportStatus !== 'ok') throw new Error(`Unknown staged transport status: ${String(raw.transportStatus)}`)

  let structured
  try {
    structured = parseDevelopmentStructuredResult(raw.structuredContent)
  } catch (error) {
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        measurementAttempted: true,
        unrecoveredInfrastructure: false,
        terminalTransportReason,
      }),
      productOutcome: Object.freeze({ kind: 'completed' }),
      cost: resultCost,
      failure: failure('STRUCTURED_RESULT_INVALID', error instanceof Error ? error.message : String(error)),
    })
  }

  if (structured.taskId !== call.taskId) {
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        measurementAttempted: true,
        unrecoveredInfrastructure: false,
        terminalTransportReason,
      }),
      productOutcome: Object.freeze({ kind: 'completed' }),
      cost: resultCost,
      failure: failure('STRUCTURED_RESULT_TASK_MISMATCH', `Structured result taskId ${structured.taskId} does not match scheduled task ${call.taskId}.`),
    })
  }

  const adjudicated = adjudicateDevelopmentClaim(task, structured)
  if (adjudicated.status === 'unresolved') {
    return freezeResult({
      call,
      measurement: measurement(call, {
        formatValid: true,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        measurementAttempted: true,
        unrecoveredInfrastructure: false,
        terminalTransportReason,
      }),
      productOutcome: Object.freeze({ kind: 'completed' }),
      cost: resultCost,
      failure: failure(
        'TASK_ADJUDICATION_UNRESOLVED',
        `Structured claim could not be resolved against the deterministic task oracle: ${adjudicated.reason}.`,
      ),
    })
  }

  return freezeResult({
    call,
    measurement: measurement(call, {
      formatValid: true,
      decisionResolved: true,
      infrastructureFailures,
      attemptCount: attempts,
      hasModelOutcome: true,
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
      terminalTransportReason,
    }),
    productOutcome: Object.freeze({ kind: 'completed' }),
    decision: adjudicated.decision,
    cost: resultCost,
  })
}
