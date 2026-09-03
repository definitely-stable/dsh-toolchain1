import { planEvalBudget } from './budget-plan.mjs'
import { selectEvaluationTasks } from './development-corpus.mjs'

const CANARY_CALL_COUNT = 16

/**
 * @typedef {'canary' | 'dev' | 'release' | 'research'} ModelEvalMode
 * @typedef {{ id: string; domain: string; prompt: string }} EvaluationTask
 * @typedef {{ ordinal: number; taskId: string; arm: 'B' | 'C'; repetition: 1 }} StagedCall
 */

/**
 * @param {{ mode: ModelEvalMode | 'deterministic' | string; tasks: EvaluationTask[] }} input
 */
export function buildStagedSchedule(input) {
  if (input === null || typeof input !== 'object') throw new Error('staged schedule input must be an object')
  if (input.mode === 'deterministic') throw new Error('deterministic mode cannot be used by the staged model runner')

  const plan = planEvalBudget({ mode: input.mode })
  if (plan.expectedModelCalls < CANARY_CALL_COUNT) {
    throw new Error('staged model modes must authorize the exact 16-call canary')
  }

  const selectedTasks = selectEvaluationTasks(input.tasks, plan.taskCount)
  /** @type {StagedCall[]} */
  const calls = []
  let ordinal = 1
  for (const task of selectedTasks) {
    for (const arm of /** @type {const} */ (['B', 'C'])) {
      calls.push(Object.freeze({ ordinal, taskId: task.id, arm, repetition: 1 }))
      ordinal += 1
    }
  }

  if (calls.length !== plan.expectedModelCalls) {
    throw new Error('staged schedule does not match the authorized model-call budget')
  }

  return Object.freeze({
    plan,
    selectedTasks,
    canaryCalls: Object.freeze(calls.slice(0, CANARY_CALL_COUNT)),
    remainderCalls: Object.freeze(calls.slice(CANARY_CALL_COUNT)),
  })
}
