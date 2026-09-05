export const STAGED_REPORT_SCHEMA = 'dsh-toolchain-staged-eval-report-v2'
const TASK_SUCCESS_GUARDRAIL_REASON = 'single-api-claim development oracle does not independently measure end-to-end task completion'
const PRODUCT_TOOL_NAMES = Object.freeze([
  'read_file',
  'search_text',
  'toolchain_contract_search',
  'toolchain_contract_inspect',
])

function armSummary(results, arm) {
  const resolved = results.filter(result => result.call.arm === arm && result.decision !== undefined)
  return Object.freeze({
    resolved: resolved.length,
    apiValid: resolved.filter(result => result.decision.apiValid).length,
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
  for (const pair of byTask.values()) {
    if (pair.B === undefined || pair.C === undefined) continue
    count += 1
    apiValidityDeltaCMinusB += Number(pair.C.apiValid) - Number(pair.B.apiValid)
  }
  return Object.freeze({ count, apiValidityDeltaCMinusB })
}

function productSummary(results, measurementStatus) {
  const resolved = results.filter(result => result.decision !== undefined)
  return Object.freeze({
    interpretable: measurementStatus === 'PASS',
    ...(measurementStatus === 'PASS' ? {} : { blockedBy: 'measurement-health' }),
    resolvedObservations: resolved.length,
    apiValidObservations: resolved.filter(result => result.decision.apiValid).length,
    byArm: Object.freeze({
      B: armSummary(results, 'B'),
      C: armSummary(results, 'C'),
    }),
    pairedTasks: pairedSummary(results),
    taskSuccessGuardrail: Object.freeze({
      measured: false,
      reason: TASK_SUCCESS_GUARDRAIL_REASON,
    }),
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

function emptyByTool() {
  return Object.fromEntries(PRODUCT_TOOL_NAMES.map(name => [name, 0]))
}

function flatCostSummary(results) {
  let attempts = 0
  let infrastructureFailures = 0
  let wallTimeMs = 0
  let inputTokens = 0
  let outputTokens = 0
  let turns = 0
  let providerCompletions = 0
  let toolCalls = 0
  let measurementToolCalls = 0
  let ordinaryCalls = 0
  let toolchainCalls = 0
  const byTool = emptyByTool()

  for (const result of results) {
    attempts += numberOrZero(result.cost.attempts)
    infrastructureFailures += numberOrZero(result.cost.infrastructureFailures)
    wallTimeMs += numberOrZero(result.cost.wallTimeMs)
    inputTokens += numberOrZero(result.cost.usage?.inputTokens)
    outputTokens += numberOrZero(result.cost.usage?.outputTokens)
    turns += numberOrZero(result.cost.usage?.turns)
    providerCompletions += numberOrZero(result.cost.usage?.providerCompletions)
    toolCalls += numberOrZero(result.cost.toolUsage?.calls)
    ordinaryCalls += numberOrZero(result.cost.toolUsage?.ordinaryCalls)
    toolchainCalls += numberOrZero(result.cost.toolUsage?.toolchainCalls)
    const exactMeasurementCalls = numberOrZero(result.cost.toolUsage?.measurementToolCalls)
    measurementToolCalls += exactMeasurementCalls > 0
      ? exactMeasurementCalls
      : numberOrZero(result.cost.toolUsage?.structuredTransportCalls)

    const observedByTool = result.cost.toolUsage?.byTool
    if (observedByTool !== null && typeof observedByTool === 'object' && !Array.isArray(observedByTool)) {
      for (const name of PRODUCT_TOOL_NAMES) byTool[name] += numberOrZero(observedByTool[name])
    }
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
    ordinaryCalls,
    toolchainCalls,
    byTool: Object.freeze({ ...byTool }),
  })
}

function costSummary(results) {
  const bResults = results.filter(result => result.call.arm === 'B')
  const cResults = results.filter(result => result.call.arm === 'C')
  const flat = flatCostSummary(results)
  const eligibleObservations = cResults.length
  const observationsWithUse = cResults.filter(result => numberOrZero(result.cost.toolUsage?.toolchainCalls) > 0).length
  return Object.freeze({
    ...flat,
    byArm: Object.freeze({
      B: flatCostSummary(bResults),
      C: flatCostSummary(cResults),
    }),
    toolchainUse: Object.freeze({
      eligibleObservations,
      observationsWithUse,
      rate: eligibleObservations === 0 ? 0 : observationsWithUse / eligibleObservations,
    }),
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
