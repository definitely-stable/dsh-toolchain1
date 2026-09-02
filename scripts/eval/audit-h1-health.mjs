#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateMeasurementHealth } from './health-gate.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_PREFIXES = Object.freeze([12, 24, 48, 96])

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return /** @type {Record<string, unknown>} */ (value)
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive safe integer`)
  return Number(value)
}

function scientificStatus(result) {
  if (typeof result.status === 'string') return result.status
  const analysis = result.analysis
  if (analysis !== null && typeof analysis === 'object' && !Array.isArray(analysis)) {
    const status = /** @type {Record<string, unknown>} */ (analysis).status
    if (typeof status === 'string') return status
  }
  throw new Error('H1 result scientific status is missing')
}

function healthObservation(runValue) {
  const run = requireRecord(runValue, 'H1 run')
  if (run.arm !== 'B' && run.arm !== 'C') return null
  const attempts = requireArray(run.attempts, 'H1 run attempts').map((value, index) => requireRecord(value, `H1 attempt[${index}]`))
  const modelAttempts = attempts.filter(value => value.outcome === 'model-outcome')
  if (modelAttempts.length > 1) throw new Error('H1 audit run contains multiple model outcomes')
  const model = modelAttempts[0]
  const infrastructureFailures = attempts.filter(value => value.outcome === 'infrastructure-failure').length
  if (model === undefined) {
    return Object.freeze({
      arm: run.arm,
      hasModelOutcome: false,
      formatValid: false,
      decisionResolved: false,
      infrastructureFailures,
      attemptCount: attempts.length,
    })
  }

  const claims = requireArray(model.parsedApiClaims, 'H1 model parsedApiClaims')
  const explicitFormat = model.formatValid
  const formatValid = typeof explicitFormat === 'boolean' ? explicitFormat : claims.length > 0
  const unresolvedApi = claims.some(value => requireRecord(value, 'H1 parsed API claim').classification === 'UNKNOWN')
  const taskSuccess = model.taskSuccess
  const decisionResolved = !unresolvedApi && (taskSuccess === 'SUCCESS' || taskSuccess === 'FAILURE')
  return Object.freeze({
    arm: run.arm,
    hasModelOutcome: true,
    formatValid,
    decisionResolved,
    infrastructureFailures,
    attemptCount: attempts.length,
  })
}

/**
 * Historical diagnostic only. It never computes a replacement H1 status or product effect.
 * @param {{ result: unknown; prefixes?: readonly number[] }} input
 */
export function auditH1HealthPrefixes(input) {
  const result = requireRecord(input.result, 'H1 terminal result')
  const runs = requireArray(result.runs, 'H1 terminal result runs')
  const requested = input.prefixes ?? [...DEFAULT_PREFIXES, runs.length]
  const prefixes = [...new Set(requested.map((value, index) => requirePositiveInteger(value, `prefix[${index}]`)))].toSorted((left, right) => left - right)
  for (const prefix of prefixes) {
    if (prefix > runs.length) throw new Error(`H1 audit prefix ${prefix} exceeds run count ${runs.length}`)
  }

  const snapshots = prefixes.map(prefix => {
    const observations = runs.slice(0, prefix).map(healthObservation).filter(value => value !== null)
    if (observations.length === 0) {
      return Object.freeze({ prefix, decisionObservations: 0, healthStatus: 'STOP', reasons: Object.freeze(['NO_BC_OBSERVATIONS']), metrics: null })
    }
    const health = evaluateMeasurementHealth({ observations })
    return Object.freeze({
      prefix,
      decisionObservations: observations.length,
      healthStatus: health.status,
      reasons: health.reasons,
      metrics: health.metrics,
    })
  })

  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-prefix-health-audit-v1',
    scientificStatus: scientificStatus(result),
    purpose: 'HISTORICAL_MEASUREMENT_DIAGNOSTIC_ONLY',
    snapshots: Object.freeze(snapshots),
  })
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--result' || typeof args[1] !== 'string') {
    throw new Error('H1 health audit requires --result <h1-result-v2.json>')
  }
  return args[1]
}

export async function main(args = process.argv.slice(2)) {
  const filename = parseArguments(args)
  const result = JSON.parse(await readFile(filename, 'utf8'))
  const audit = auditH1HealthPrefixes({ result })
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`)
  return audit
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
