#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)

export const DEFAULT_HEALTH_THRESHOLDS = Object.freeze({
  minimumFormatComplianceRate: 0.98,
  minimumDecisionResolutionRate: 0.95,
  maximumUnrecoveredInfrastructureRate: 0.02,
  maximumArmResolutionGap: 0.05,
})

/** @typedef {'FORMAT_COMPLIANCE_BELOW_MINIMUM' | 'DECISION_RESOLUTION_BELOW_MINIMUM' | 'UNRECOVERED_INFRASTRUCTURE_RATE_ABOVE_MAXIMUM' | 'ARM_RESOLUTION_GAP_ABOVE_MAXIMUM'} HealthStopReason */

/**
 * @typedef {object} MeasurementHealthObservation
 * @property {'B' | 'C'} arm
 * @property {boolean} formatValid
 * @property {boolean} decisionResolved
 * @property {number} infrastructureFailures
 * @property {number} attemptCount
 * @property {boolean} [hasModelOutcome]
 * @property {boolean} [unrecoveredInfrastructure]
 */

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return Number(value)
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function validateObservation(value, index) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`observation[${index}] must be an object`)
  }
  const record = /** @type {Record<string, unknown>} */ (value)
  if (record.arm !== 'B' && record.arm !== 'C') throw new Error(`observation[${index}] arm must be B or C`)
  const infrastructureFailures = requireNonNegativeInteger(record.infrastructureFailures, `observation[${index}].infrastructureFailures`)
  const attemptCount = requireNonNegativeInteger(record.attemptCount, `observation[${index}].attemptCount`)
  if (attemptCount < infrastructureFailures) {
    throw new Error(`observation[${index}] attemptCount cannot be below infrastructureFailures`)
  }
  const hasModelOutcome = record.hasModelOutcome === undefined
    ? true
    : requireBoolean(record.hasModelOutcome, `observation[${index}].hasModelOutcome`)
  const unrecoveredInfrastructure = record.unrecoveredInfrastructure === undefined
    ? (!hasModelOutcome && infrastructureFailures > 0)
    : requireBoolean(record.unrecoveredInfrastructure, `observation[${index}].unrecoveredInfrastructure`)
  if (unrecoveredInfrastructure && hasModelOutcome) {
    throw new Error(`observation[${index}] cannot have a model outcome and unrecovered infrastructure`)
  }
  return Object.freeze({
    arm: record.arm,
    formatValid: requireBoolean(record.formatValid, `observation[${index}].formatValid`),
    decisionResolved: requireBoolean(record.decisionResolved, `observation[${index}].decisionResolved`),
    infrastructureFailures,
    attemptCount,
    hasModelOutcome,
    unrecoveredInfrastructure,
  })
}

function ratio(numerator, denominator, label) {
  if (denominator <= 0) throw new Error(`${label} denominator must be positive`)
  return numerator / denominator
}

function rounded(value) {
  return Number(value.toFixed(6))
}

function armResolution(observations, arm) {
  const rows = observations.filter(value => value.arm === arm)
  if (rows.length === 0) throw new Error(`measurement health requires at least one ${arm} observation`)
  const resolved = rows.filter(value => value.decisionResolved).length
  return Object.freeze({
    observations: rows.length,
    resolved,
    resolutionRate: rounded(resolved / rows.length),
  })
}

/**
 * @param {{ observations: readonly unknown[]; thresholds?: Partial<typeof DEFAULT_HEALTH_THRESHOLDS> }} input
 */
export function evaluateMeasurementHealth(input) {
  if (input === null || typeof input !== 'object') throw new Error('measurement health input must be an object')
  if (!Array.isArray(input.observations) || input.observations.length === 0) {
    throw new Error('measurement health requires at least one observation')
  }
  const observations = Object.freeze(input.observations.map(validateObservation))
  const thresholds = Object.freeze({ ...DEFAULT_HEALTH_THRESHOLDS, ...(input.thresholds ?? {}) })
  for (const [key, value] of Object.entries(thresholds)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`measurement health threshold ${key} must be a finite rate in 0..1`)
    }
  }

  const modelRows = observations.filter(value => value.hasModelOutcome)
  if (modelRows.length === 0) throw new Error('measurement health requires at least one model-outcome observation')
  const formatValid = modelRows.filter(value => value.formatValid).length
  const resolved = observations.filter(value => value.decisionResolved).length
  const infrastructureFailures = observations.reduce((sum, value) => sum + value.infrastructureFailures, 0)
  const attempts = observations.reduce((sum, value) => sum + value.attemptCount, 0)
  const unrecovered = observations.filter(value => value.unrecoveredInfrastructure).length
  const retryAttempts = Math.max(0, attempts - observations.length)
  const B = armResolution(observations, 'B')
  const C = armResolution(observations, 'C')

  const metrics = Object.freeze({
    scheduledObservations: observations.length,
    modelOutcomeObservations: modelRows.length,
    formatValidObservations: formatValid,
    resolvedDecisionObservations: resolved,
    infrastructureFailures,
    attempts,
    unrecoveredInfrastructureObservations: unrecovered,
    retryAttempts,
    formatComplianceRate: rounded(ratio(formatValid, modelRows.length, 'format compliance')),
    decisionResolutionRate: rounded(ratio(resolved, observations.length, 'decision resolution')),
    unrecoveredInfrastructureRate: rounded(ratio(unrecovered, observations.length, 'unrecovered infrastructure rate')),
    retryAttemptRate: rounded(ratio(retryAttempts, attempts, 'retry attempt rate')),
    resolutionGap: rounded(Math.abs(B.resolutionRate - C.resolutionRate)),
    byArm: Object.freeze({ B, C }),
  })

  /** @type {HealthStopReason[]} */
  const reasons = []
  if (metrics.formatComplianceRate < thresholds.minimumFormatComplianceRate) reasons.push('FORMAT_COMPLIANCE_BELOW_MINIMUM')
  if (metrics.decisionResolutionRate < thresholds.minimumDecisionResolutionRate) reasons.push('DECISION_RESOLUTION_BELOW_MINIMUM')
  if (metrics.unrecoveredInfrastructureRate > thresholds.maximumUnrecoveredInfrastructureRate) {
    reasons.push('UNRECOVERED_INFRASTRUCTURE_RATE_ABOVE_MAXIMUM')
  }
  if (metrics.resolutionGap > thresholds.maximumArmResolutionGap) reasons.push('ARM_RESOLUTION_GAP_ABOVE_MAXIMUM')

  return Object.freeze({
    schema: 'dsh-toolchain-staged-eval-health-v1',
    status: reasons.length === 0 ? 'PASS' : 'STOP',
    thresholds,
    metrics,
    reasons: Object.freeze(reasons),
  })
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--input' || typeof args[1] !== 'string') {
    throw new Error('eval health gate requires --input <json-file>')
  }
  return args[1]
}

export async function main(args = process.argv.slice(2)) {
  const inputPath = parseArguments(args)
  const input = JSON.parse(await readFile(inputPath, 'utf8'))
  const result = evaluateMeasurementHealth(input)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return result
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
