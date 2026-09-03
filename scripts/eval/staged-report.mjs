export const STAGED_REPORT_SCHEMA = 'dsh-toolchain-staged-eval-report-v1'

function armSummary(results, arm) {
  const resolved = results.filter(result => result.call.arm === arm && result.decision !== undefined)
  return Object.freeze({
    resolved: resolved.length,
    apiValid: resolved.filter(result => result.decision.apiValid).length,
    taskSuccess: resolved.filter(result => result.decision.taskSuccess).length,
  })
}

function pairedSummary(results) {
  const byTask = new Map()
  for (const result of results) {
    if (result.decision === undefined) continue
    const existing = byTask.get(result.call.taskId) ?? {}
    existing[result.call.arm] = result.decision
    byTask.set(result.call.taskId, existing)
  }

  let count = 0
  let apiValidityDeltaCMinusB = 0
  let taskSuccessDeltaCMinusB = 0
  for (const pair of byTask.values()) {
    if (pair.B === undefined || pair.C === undefined) continue
    count += 1
    apiValidityDeltaCMinusB += Number(pair.C.apiValid) - Number(pair.B.apiValid)
    taskSuccessDeltaCMinusB += Number(pair.C.taskSuccess) - Number(pair.B.taskSuccess)
  }
  return Object.freeze({ count, apiValidityDeltaCMinusB, taskSuccessDeltaCMinusB })
}

function productSummary(results) {
  const resolved = results.filter(result => result.decision !== undefined)
  return Object.freeze({
    resolvedObservations: resolved.length,
    apiValidObservations: resolved.filter(result => result.decision.apiValid).length,
    taskSuccessObservations: resolved.filter(result => result.decision.taskSuccess).length,
    byArm: Object.freeze({
      B: armSummary(results, 'B'),
      C: armSummary(results, 'C'),
    }),
    pairedTasks: pairedSummary(results),
  })
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function costSummary(results) {
  let attempts = 0
  let infrastructureFailures = 0
  let wallTimeMs = 0
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let toolCalls = 0

  for (const result of results) {
    attempts += numberOrZero(result.cost.attempts)
    infrastructureFailures += numberOrZero(result.cost.infrastructureFailures)
    wallTimeMs += numberOrZero(result.cost.wallTimeMs)
    inputTokens += numberOrZero(result.cost.usage?.inputTokens)
    outputTokens += numberOrZero(result.cost.usage?.outputTokens)
    turns += numberOrZero(result.cost.usage?.turns)
    toolCalls += numberOrZero(result.cost.toolUsage?.calls)
  }

  return Object.freeze({
    modelCalls: results.length,
    attempts,
    retries: Math.max(0, attempts - results.length),
    infrastructureFailures,
    wallTimeMs,
    inputTokens,
    outputTokens,
    turns,
    toolCalls,
  })
}

/** @param {Record<string, any>} run */
export function buildStagedEvaluationReport(run) {
  const results = [...run.canaryResults, ...run.remainderResults]
  return Object.freeze({
    schema: STAGED_REPORT_SCHEMA,
    mode: run.mode,
    measurement: Object.freeze({
      status: run.measurementStatus,
      reasons: Object.freeze([...run.health.reasons]),
      metrics: Object.freeze({ ...run.health.metrics }),
    }),
    product: productSummary(results),
    cost: costSummary(results),
    authorization: Object.freeze({ ...run.authorization }),
  })
}
