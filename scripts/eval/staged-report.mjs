export const STAGED_REPORT_SCHEMA = 'dsh-toolchain-staged-eval-report-v3'
const TASK_SUCCESS_GUARDRAIL_REASON = 'single-api-claim development oracle does not independently measure end-to-end task completion'
const PRODUCT_TOOL_NAMES = Object.freeze([
  'read_file',
  'search_text',
  'toolchain_contract_search',
  'toolchain_contract_inspect',
])

function roundedRate(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6))
}

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
    const key = `${result.call.taskId}\u0000${result.call.repetition}`
    const existing = byTask.get(key) ?? {}
    existing[result.call.arm] = result.decision
    byTask.set(key, existing)
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

function productEligible(result) {
  if (result.measurement?.hasModelOutcome !== true) return false
  if (result.productOutcome?.kind === 'budget-exhausted') return true
  return result.productOutcome?.kind === 'completed'
    && result.measurement?.measurementAttempted === true
    && result.measurement?.formatValid === true
}

function boundedArmSummary(results, arm, success) {
  const eligible = results.filter(result => result.call.arm === arm && productEligible(result))
  const successful = eligible.filter(success).length
  return Object.freeze({
    eligible: eligible.length,
    successful,
    rate: roundedRate(successful, eligible.length),
  })
}

function boundedCompletionArmSummary(results, arm) {
  const eligible = results.filter(result => result.call.arm === arm && productEligible(result))
  const completed = eligible.filter(result => result.productOutcome?.kind === 'completed').length
  return Object.freeze({
    eligible: eligible.length,
    completed,
    rate: roundedRate(completed, eligible.length),
  })
}

function pairedBoundedSummary(results, success, labels) {
  const pairs = new Map()
  for (const result of results) {
    if (!productEligible(result)) continue
    const key = `${result.call.taskId}\u0000${result.call.repetition}`
    const pair = pairs.get(key) ?? {}
    pair[result.call.arm] = success(result)
    pairs.set(key, pair)
  }

  let count = 0
  let both = 0
  let bOnly = 0
  let cOnly = 0
  let neither = 0
  let bSuccesses = 0
  let cSuccesses = 0
  for (const pair of pairs.values()) {
    if (pair.B === undefined || pair.C === undefined) continue
    count += 1
    bSuccesses += Number(pair.B)
    cSuccesses += Number(pair.C)
    if (pair.B && pair.C) both += 1
    else if (pair.B) bOnly += 1
    else if (pair.C) cOnly += 1
    else neither += 1
  }

  return Object.freeze({
    count,
    [labels.both]: both,
    bOnly,
    cOnly,
    neither,
    rateDeltaCMinusB: count === 0 ? null : Number(((cSuccesses - bSuccesses) / count).toFixed(6)),
  })
}

function boundedCompletionSummary(results) {
  const eligible = results.filter(productEligible)
  const completed = eligible.filter(result => result.productOutcome?.kind === 'completed').length
  return Object.freeze({
    eligibleObservations: eligible.length,
    completedObservations: completed,
    rate: roundedRate(completed, eligible.length),
    byArm: Object.freeze({
      B: boundedCompletionArmSummary(results, 'B'),
      C: boundedCompletionArmSummary(results, 'C'),
    }),
    paired: pairedBoundedSummary(
      results,
      result => result.productOutcome?.kind === 'completed',
      { both: 'bothCompleted' },
    ),
  })
}

function boundedApiSuccessSummary(results) {
  const eligible = results.filter(productEligible)
  const success = result => result.decision?.apiValid === true
  const successful = eligible.filter(success).length
  return Object.freeze({
    eligibleObservations: eligible.length,
    successfulObservations: successful,
    rate: roundedRate(successful, eligible.length),
    byArm: Object.freeze({
      B: boundedArmSummary(results, 'B', success),
      C: boundedArmSummary(results, 'C', success),
    }),
    paired: pairedBoundedSummary(results, success, { both: 'bothSuccess' }),
  })
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
    boundedCompletion: boundedCompletionSummary(results),
    boundedApiSuccess: boundedApiSuccessSummary(results),
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

function exactByTool(toolUsage) {
  const byTool = emptyByTool()
  const observed = toolUsage?.byTool
  if (observed !== null && typeof observed === 'object' && !Array.isArray(observed)) {
    for (const name of PRODUCT_TOOL_NAMES) byTool[name] = numberOrZero(observed[name])
  }
  return Object.freeze({ ...byTool })
}

function measurementToolCalls(toolUsage) {
  const exact = numberOrZero(toolUsage?.measurementToolCalls)
  return exact > 0 ? exact : numberOrZero(toolUsage?.structuredTransportCalls)
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
  let measurementCalls = 0
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
    measurementCalls += measurementToolCalls(result.cost.toolUsage)

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
    measurementToolCalls: measurementCalls,
    ordinaryCalls,
    toolchainCalls,
    byTool: Object.freeze({ ...byTool }),
  })
}

function costSummary(results) {
  const bResults = results.filter(result => result.call.arm === 'B')
  const cResults = results.filter(result => result.call.arm === 'C')
  const eligibleCResults = cResults.filter(result => result.measurement?.hasModelOutcome === true)
  const flat = flatCostSummary(results)
  const eligibleObservations = eligibleCResults.length
  const observationsWithUse = eligibleCResults.filter(result => numberOrZero(result.cost.toolUsage?.toolchainCalls) > 0).length
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

function taskMetadata(run, results) {
  const tasks = run.schedule?.selectedTasks
  if (!Array.isArray(tasks)) throw new Error('staged report v3 requires schedule.selectedTasks for safe observation receipts')
  const byId = new Map()
  for (const task of tasks) {
    if (task === null || typeof task !== 'object' || Array.isArray(task)) throw new Error('staged report task metadata must be objects')
    if (typeof task.id !== 'string' || task.id.length === 0) throw new Error('staged report task metadata requires task id')
    if (typeof task.domain !== 'string' || task.domain.length === 0) throw new Error(`staged report task ${task.id} requires domain`)
    const kind = task.successRule?.kind
    if (kind !== 'api-exists-any' && kind !== 'api-absent') throw new Error(`staged report task ${task.id} requires a supported oracle kind`)
    byId.set(task.id, Object.freeze({ domain: task.domain, oracleKind: kind }))
  }
  for (const result of results) {
    if (!byId.has(result.call.taskId)) throw new Error(`staged report result references unscheduled task ${result.call.taskId}`)
  }
  return byId
}

function observationCost(result) {
  return Object.freeze({
    attempts: numberOrZero(result.cost.attempts),
    infrastructureFailures: numberOrZero(result.cost.infrastructureFailures),
    wallTimeMs: numberOrZero(result.cost.wallTimeMs),
    inputTokens: numberOrZero(result.cost.usage?.inputTokens),
    outputTokens: numberOrZero(result.cost.usage?.outputTokens),
    turns: numberOrZero(result.cost.usage?.turns),
    providerCompletions: numberOrZero(result.cost.usage?.providerCompletions),
    toolCalls: numberOrZero(result.cost.toolUsage?.calls),
    measurementToolCalls: measurementToolCalls(result.cost.toolUsage),
    ordinaryCalls: numberOrZero(result.cost.toolUsage?.ordinaryCalls),
    toolchainCalls: numberOrZero(result.cost.toolUsage?.toolchainCalls),
    byTool: exactByTool(result.cost.toolUsage),
  })
}

function safeObservations(run, results) {
  const metadata = taskMetadata(run, results)
  return Object.freeze(results
    .toSorted((left, right) => left.call.ordinal - right.call.ordinal)
    .map(result => {
      const task = metadata.get(result.call.taskId)
      return Object.freeze({
        ordinal: result.call.ordinal,
        taskId: result.call.taskId,
        arm: result.call.arm,
        repetition: result.call.repetition,
        domain: task.domain,
        oracleKind: task.oracleKind,
        hasModelOutcome: result.measurement?.hasModelOutcome === true,
        measurementAttempted: result.measurement?.measurementAttempted === true,
        ...(result.productOutcome === undefined ? {} : { productOutcome: Object.freeze({ ...result.productOutcome }) }),
        ...(typeof result.measurement?.terminalTransportReason === 'string'
          ? { terminalReason: result.measurement.terminalTransportReason }
          : {}),
        ...(typeof result.failure?.code === 'string' ? { failureCode: result.failure.code } : {}),
        ...(result.decision === undefined ? {} : { apiValid: result.decision.apiValid === true }),
        cost: observationCost(result),
      })
    }))
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
      ...(run.health.diagnostics === undefined ? {} : { diagnostics: Object.freeze({ ...run.health.diagnostics }) }),
      failureDiagnostics: failureDiagnostics(results),
      transportDiagnostics: transportDiagnostics(results),
    }),
    product: productSummary(results, run.measurementStatus),
    cost: costSummary(results),
    observations: safeObservations(run, results),
    authorization: Object.freeze({ ...run.authorization }),
  })
}
