import { parseDevelopmentStructuredResult } from './structured-result.mjs'

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

function measurement(call, fields) {
  return Object.freeze({
    arm: call.arm,
    formatValid: fields.formatValid,
    decisionResolved: fields.decisionResolved,
    infrastructureFailures: fields.infrastructureFailures,
    attemptCount: fields.attemptCount,
    hasModelOutcome: fields.hasModelOutcome,
    unrecoveredInfrastructure: fields.unrecoveredInfrastructure,
  })
}

function cost(result, attempts, infrastructureFailures, wallTimeMs) {
  return Object.freeze({
    attempts,
    infrastructureFailures,
    wallTimeMs,
    ...(result.usage === undefined ? {} : { usage: Object.freeze({ ...result.usage }) }),
    ...(result.toolUsage === undefined ? {} : { toolUsage: Object.freeze({ ...result.toolUsage }) }),
  })
}

function failure(code, summary) {
  return Object.freeze({ code, summary })
}

/**
 * @param {{ ordinal: number; taskId: string; arm: 'B'|'C'; repetition: 1 }} call
 * @param {(call: { ordinal: number; taskId: string; arm: 'B'|'C'; repetition: 1 }) => Promise<Record<string, unknown>>} execute
 */
export async function executeStagedCall(call, execute) {
  if (typeof execute !== 'function') throw new Error('staged execution requires an executor function')
  const raw = await execute(call)
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('executor result must be an object')

  const attempts = requirePositiveInteger(raw.attempts, 'attempts')
  const infrastructureFailures = requireNonNegativeInteger(raw.infrastructureFailures, 'infrastructureFailures')
  if (infrastructureFailures > attempts) throw new Error('infrastructureFailures cannot exceed attempts')
  const wallTimeMs = requireNonNegativeNumber(raw.wallTimeMs, 'wallTimeMs')
  const resultCost = cost(raw, attempts, infrastructureFailures, wallTimeMs)

  if (raw.transportStatus === 'infrastructure-failure') {
    return Object.freeze({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: false,
        unrecoveredInfrastructure: true,
      }),
      cost: resultCost,
      failure: failure('UNRECOVERED_INFRASTRUCTURE', 'No model outcome was recovered after the authorized attempts.'),
    })
  }

  if (raw.transportStatus === 'unsupported') {
    return Object.freeze({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        unrecoveredInfrastructure: false,
      }),
      cost: resultCost,
      failure: failure('STRUCTURED_TRANSPORT_UNSUPPORTED', 'Provider did not support the required structured-result transport.'),
    })
  }

  if (raw.transportStatus !== 'ok') throw new Error(`Unknown staged transport status: ${String(raw.transportStatus)}`)

  let decision
  try {
    decision = parseDevelopmentStructuredResult(raw.structuredContent)
  } catch (error) {
    return Object.freeze({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        unrecoveredInfrastructure: false,
      }),
      cost: resultCost,
      failure: failure('STRUCTURED_RESULT_INVALID', error instanceof Error ? error.message : String(error)),
    })
  }

  if (decision.taskId !== call.taskId) {
    return Object.freeze({
      call,
      measurement: measurement(call, {
        formatValid: false,
        decisionResolved: false,
        infrastructureFailures,
        attemptCount: attempts,
        hasModelOutcome: true,
        unrecoveredInfrastructure: false,
      }),
      cost: resultCost,
      failure: failure('STRUCTURED_RESULT_TASK_MISMATCH', `Structured result taskId ${decision.taskId} does not match scheduled task ${call.taskId}.`),
    })
  }

  return Object.freeze({
    call,
    measurement: measurement(call, {
      formatValid: true,
      decisionResolved: true,
      infrastructureFailures,
      attemptCount: attempts,
      hasModelOutcome: true,
      unrecoveredInfrastructure: false,
    }),
    decision,
    cost: resultCost,
  })
}
