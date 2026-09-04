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

function productSummary(results, measurementStatus) {
  const resolved = results.filter(result => result.decision !== undefined)
  return Object.freeze({
    interpretable: measurementStatus === 'PASS',
    ...(measurementStatus === 'PASS' ? {} : { blockedBy: 'measurement-health' }),
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

function transportDiagnostics(results) {
  const counts = new Map()
  let observedTerminalReasons = 0

  for (const result of results) {
    const reason = result.measurement?.terminalTransportReason
    if (typeof reason !== 'string') continue
    observedTerminalReasons += 1
    const current = counts.get(reason) ?? { count: 0, B: 0, C: 0 }
    current.count += 1
    current[result.call.arm] += 1
    counts.set(reason, current)
  }

  const terminalReasons = [...counts.entries()]
    .toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([reason, value]) => Object.freeze({
      reason,
      count: value.count,
      byArm: Object.freeze({ B: value.B, C: value.C }),
    }))

  return Object.freeze({
    observedTerminalReasons,
    missingTerminalReasons: Math.max(0, results.length - observedTerminalReasons),
    terminalReasons: Object.freeze(terminalReasons),
  })
}

function failureDiagnostics(results) {
  const counts = new Map()
  let total = 0

  for (const result of results) {
    const code = result.failure?.code
    if (typeof code !== 'string' || code.length === 0) continue
    total += 1
    const current = counts.get(code) ?? { count: 0, B: 0, C: 0 }
    current.count += 1
    current[result.call.arm] += 1
    counts.set(code, current)
  }

  const byCode = [...counts.entries()]
    .toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([code, value]) => Object.freeze({
      code,
      count: value.count,
      byArm: Object.freeze({ B: value.B, C: value.C }),
    }))

  return Object.freeze({ total, byCode: Object.freeze(byCode) })
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
  let providerCompletions = 0
  let toolCalls = 0
  let measurementToolCalls = 0

  for (const result of results) {
    attempts += numberOrZero(result.cost.attempts)
    infrastructureFailures += numberOrZero(result.cost.infrastructureFailures)
    wallTimeMs += numberOrZero(result.cost.wallTimeMs)
    inputTokens += numberOrZero(result.cost.usage?.inputTokens)
    outputTokens += numberOrZero(result.cost.usage?.outputTokens)
    turns += numberOrZero(result.cost.usage?.turns)
    providerCompletions += numberOrZero(result.cost.usage?.providerCompletions)
    toolCalls += numberOrZero(result.cost.toolUsage?.calls)
    const exactMeasurementCalls = numberOrZero(result.cost.toolUsage?.measurementToolCalls)
    measurementToolCalls += exactMeasurementCalls > 0
      ? exactMeasurementCalls
      : numberOrZero(result.cost.toolUsage?.structuredTransportCalls)
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
    providerCompletions,
    toolCalls,
    measurementToolCalls,
  })
}

export function buildStagedEvaluationReport(run) {
  const results = [...run.canaryResults, ...run.remainderResults]
  return Object.freeze({
    schema: STAGED_REPORT_SCHEMA,
    mode: run.mode,
    measurement: Object.freeze({
      status: run.measurementStatus,
      reasons: Object.freeze([...run.health.reasons]),
      metrics: Object.freeze({ ...run.health.metrics }),
      failureDiagnostics: failureDiagnostics(results),
      transportDiagnostics: transportDiagnostics(results),
    }),
    product: productSummary(results, run.measurementStatus),
    cost: costSummary(results),
    authorization: Object.freeze({ ...run.authorization }),
  })
}
