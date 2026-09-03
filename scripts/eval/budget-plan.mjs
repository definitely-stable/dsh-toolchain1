#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const BC_ARMS = /** @type {const} */ (['B', 'C'])

/** @typedef {'deterministic' | 'canary' | 'dev' | 'release' | 'research'} EvalModeName */
/** @typedef {'implementation-validity' | 'measurement-health' | 'engineering-signal' | 'release-confidence' | 'exploratory-evidence'} ClaimStrength */

/**
 * @typedef {object} EvalModeDefinition
 * @property {EvalModeName} mode
 * @property {number} taskCount
 * @property {readonly ('B' | 'C')[]} arms
 * @property {number} repetitions
 * @property {number} expectedModelCalls
 * @property {number} hardModelCallCap
 * @property {ClaimStrength} claimStrength
 */

/** @type {Readonly<Record<EvalModeName, EvalModeDefinition>>} */
const MODES = Object.freeze({
  deterministic: Object.freeze({
    mode: 'deterministic',
    taskCount: 0,
    arms: Object.freeze([]),
    repetitions: 0,
    expectedModelCalls: 0,
    hardModelCallCap: 0,
    claimStrength: 'implementation-validity',
  }),
  canary: Object.freeze({
    mode: 'canary',
    taskCount: 8,
    arms: BC_ARMS,
    repetitions: 1,
    expectedModelCalls: 16,
    hardModelCallCap: 16,
    claimStrength: 'measurement-health',
  }),
  dev: Object.freeze({
    mode: 'dev',
    taskCount: 20,
    arms: BC_ARMS,
    repetitions: 1,
    expectedModelCalls: 40,
    hardModelCallCap: 40,
    claimStrength: 'engineering-signal',
  }),
  release: Object.freeze({
    mode: 'release',
    taskCount: 32,
    arms: BC_ARMS,
    repetitions: 1,
    expectedModelCalls: 64,
    hardModelCallCap: 64,
    claimStrength: 'release-confidence',
  }),
  research: Object.freeze({
    mode: 'research',
    taskCount: 48,
    arms: BC_ARMS,
    repetitions: 1,
    expectedModelCalls: 96,
    hardModelCallCap: 96,
    claimStrength: 'exploratory-evidence',
  }),
})

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return Number(value)
}

/** @param {unknown} name @returns {EvalModeDefinition} */
export function getEvalMode(name) {
  if (typeof name !== 'string' || !(name in MODES)) throw new Error(`Unknown evaluation mode: ${String(name)}`)
  return MODES[/** @type {EvalModeName} */ (name)]
}

/** @param {{ mode: EvalModeName | string; taskCount?: number; repetitions?: number }} input */
export function planEvalBudget(input) {
  if (input === null || typeof input !== 'object') throw new Error('evaluation budget input must be an object')
  const definition = getEvalMode(input.mode)
  const taskCount = input.taskCount === undefined ? definition.taskCount : requireNonNegativeInteger(input.taskCount, 'taskCount')
  const repetitions = input.repetitions === undefined ? definition.repetitions : requireNonNegativeInteger(input.repetitions, 'repetitions')

  if (definition.mode === 'deterministic') {
    if (taskCount !== 0 || repetitions !== 0) throw new Error('Deterministic mode cannot schedule model work')
  } else if (taskCount < 1 || repetitions < 1) {
    throw new Error('Model evaluation modes require at least one task and one repetition')
  }

  const expectedModelCalls = taskCount * definition.arms.length * repetitions
  if (expectedModelCalls > definition.hardModelCallCap) {
    throw new Error(`Requested evaluation requires ${expectedModelCalls} model calls, above ${definition.mode} hard model-call cap ${definition.hardModelCallCap}`)
  }

  return Object.freeze({
    mode: definition.mode,
    taskCount,
    arms: definition.arms,
    repetitions,
    expectedModelCalls,
    hardModelCallCap: definition.hardModelCallCap,
    remainingCallHeadroom: definition.hardModelCallCap - expectedModelCalls,
    claimStrength: definition.claimStrength,
  })
}

function parseArguments(args) {
  let mode
  let taskCount
  let repetitions
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--mode') { mode = args[index + 1]; index += 1; continue }
    if (argument === '--tasks') { taskCount = Number(args[index + 1]); index += 1; continue }
    if (argument === '--repetitions') { repetitions = Number(args[index + 1]); index += 1; continue }
    throw new Error(`Unknown eval budget argument: ${String(argument)}`)
  }
  if (mode === undefined) throw new Error('eval budget planner requires --mode')
  return { mode, taskCount, repetitions }
}

export function main(args = process.argv.slice(2)) {
  const plan = planEvalBudget(parseArguments(args))
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  return plan
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  try { main() } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
}
