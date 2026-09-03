import { evaluateMeasurementHealth } from './health-gate.mjs'
import { executeStagedCall } from './staged-execution.mjs'
import { buildStagedSchedule } from './staged-schedule.mjs'

async function executeCalls(calls, execute) {
  const results = []
  for (const call of calls) results.push(await executeStagedCall(call, execute))
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
 * @param {{ mode: 'canary'|'dev'|'release'|'research'; tasks: Array<{id:string,domain:string,prompt:string}>; execute: Function }} input
 */
export async function runStagedEvaluation(input) {
  if (input === null || typeof input !== 'object') throw new Error('staged evaluation input must be an object')
  const schedule = buildStagedSchedule({ mode: input.mode, tasks: input.tasks })
  const canaryResults = await executeCalls(schedule.canaryCalls, input.execute)
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

  const remainderResults = await executeCalls(schedule.remainderCalls, input.execute)
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
