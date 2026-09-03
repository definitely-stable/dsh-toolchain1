import { evaluateMeasurementHealth } from './health-gate.mjs'
import { executeStagedCall } from './staged-execution.mjs'
import { buildStagedSchedule } from './staged-schedule.mjs'

function taskMap(tasks) {
  const byId = new Map()
  for (const task of tasks) {
    if (task === null || typeof task !== 'object' || typeof task.id !== 'string' || task.id.trim().length === 0) {
      throw new Error('staged evaluation tasks require non-empty string ids')
    }
    if (byId.has(task.id)) throw new Error(`duplicate staged evaluation task id: ${task.id}`)
    byId.set(task.id, task)
  }
  return byId
}

async function executeCalls(calls, tasksById, execute) {
  const results = []
  for (const call of calls) {
    const task = tasksById.get(call.taskId)
    if (task === undefined) throw new Error(`staged schedule references missing task ${call.taskId}`)
    results.push(await executeStagedCall(call, task, execute))
  }
  return Object.freeze(results)
}

function authorization(schedule, remainderAuthorized, executedCalls) {
  return Object.freeze({
    plannedCalls: schedule.plan.expectedModelCalls,
    canaryCalls: schedule.canaryCalls.length,
    remainderPlanned: schedule.remainderCalls.length,
    remainderAuthorized,
    executedCalls,
  })
}

/**
 * The first 16 scheduled calls are the only continuation gate. An unhealthy
 * canary permanently denies the remainder for this run; there is no manual or
 * post-hoc path in this orchestrator that can turn STOP back into PASS.
 *
 * @param {{ mode: 'canary'|'dev'|'release'|'research'; tasks: Array<{id:string,domain:string,prompt:string,successRule:Readonly<Record<string, unknown>>}>; execute: Function }} input
 */
export async function runStagedEvaluation(input) {
  if (input === null || typeof input !== 'object') throw new Error('staged evaluation input must be an object')
  const tasksById = taskMap(input.tasks)
  const schedule = buildStagedSchedule({ mode: input.mode, tasks: input.tasks })
  const canaryResults = await executeCalls(schedule.canaryCalls, tasksById, input.execute)
  const health = evaluateMeasurementHealth({
    observations: canaryResults.map(result => result.measurement),
  })

  if (health.status === 'STOP') {
    return Object.freeze({
      mode: schedule.plan.mode,
      measurementStatus: 'STOP',
      schedule,
      canaryResults,
      remainderResults: Object.freeze([]),
      health,
      authorization: authorization(schedule, 0, canaryResults.length),
    })
  }

  const remainderResults = await executeCalls(schedule.remainderCalls, tasksById, input.execute)
  return Object.freeze({
    mode: schedule.plan.mode,
    measurementStatus: 'PASS',
    schedule,
    canaryResults,
    remainderResults,
    health,
    authorization: authorization(
      schedule,
      schedule.remainderCalls.length,
      canaryResults.length + remainderResults.length,
    ),
  })
}
