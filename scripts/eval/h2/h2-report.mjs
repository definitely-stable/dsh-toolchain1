import { H2_POLICY, H2_STRATA } from './h2-config.mjs'
import { assertReceiptSanitized } from './h2-telemetry.mjs'
import { decideH2Outcome, computePairedOutcomes } from './h2-statistics.mjs'

export const H2_REPORT_SCHEMA = 'dsh-toolchain-h2-report-v1'

const RESOLVED_TERMINALS = new Set(['COMPLETED', 'RESOURCE_EXHAUSTED', 'REFUSAL'])

/**
 * Builds the terminal H2 product report from sanitized per-observation
 * receipts. The report is the only public artifact of a scoring run and
 * carries no hidden task content.
 */
export function buildH2Report({ runId, receipts, policy = H2_POLICY, generatedAt }) {
  if (!Array.isArray(receipts)) throw new Error('H2 report requires an array of observation receipts')
  for (const receipt of receipts) assertReceiptSanitized(receipt)

  const byArm = { B: [], C: [] }
  for (const receipt of receipts) {
    if (receipt.arm !== 'B' && receipt.arm !== 'C') throw new Error(`unknown arm in receipt: ${String(receipt.arm)}`)
    byArm[receipt.arm].push(receipt)
  }

  const taskIds = [...new Set(receipts.map(receipt => receipt.taskId))].sort()
  const pairs = taskIds.map(taskId => {
    const b = byArm.B.find(receipt => receipt.taskId === taskId)
    const c = byArm.C.find(receipt => receipt.taskId === taskId)
    const resolved = b !== undefined && c !== undefined
      && b.identityDrift === false && c.identityDrift === false
      && RESOLVED_TERMINALS.has(b.terminalReason) && RESOLVED_TERMINALS.has(c.terminalReason)
    return {
      taskId,
      resolved,
      bSuccess: b?.success === true,
      cSuccess: c?.success === true,
    }
  })

  const infrastructureFailures = receipts.filter(receipt => receipt.terminalReason === 'INFRASTRUCTURE_FAILURE' || receipt.terminalReason === 'CANCELLED')
  const identityDrifts = receipts.filter(receipt => receipt.identityDrift === true)
  const expectedPairs = policy.taskCount
  const allPairsPresent = pairs.length === expectedPairs
  for (const pair of pairs) {
    if (!pair.resolved) pair.resolved = false
  }
  const allResolved = allPairsPresent
    && pairs.every(pair => pair.resolved)
    && receipts.length === policy.scoringObservations

  const decision = decideH2Outcome({
    pairs: allResolved ? pairs.map(pair => ({ bSuccess: pair.bSuccess, cSuccess: pair.cSuccess, resolved: true })) : pairs,
    allResolved,
  })

  const primary = allResolved
    ? {
        ...computePairedOutcomes(pairs.map(pair => ({ bSuccess: pair.bSuccess, cSuccess: pair.cSuccess, resolved: true }))),
        test: policy.statistics.test,
        alpha: policy.statistics.alpha,
        mcid: policy.statistics.minimumDelta,
        pValue: decision.pValue,
      }
    : {
        test: policy.statistics.test,
        alpha: policy.statistics.alpha,
        mcid: policy.statistics.minimumDelta,
        computed: false,
      }

  return Object.freeze({
    schema: H2_REPORT_SCHEMA,
    runId,
    generatedAt,
    policy: Object.freeze({
      taskCount: policy.taskCount,
      scoringObservations: policy.scoringObservations,
      model: policy.model,
      resource: policy.resource,
      statistics: policy.statistics,
    }),
    status: allResolved ? decision.outcome : 'STOPPED_INVALID',
    outcomeReason: decision.reason,
    measurement: Object.freeze({
      expectedObservations: policy.scoringObservations,
      executedObservations: receipts.length,
      pairedTasks: pairs.length,
      allResolved,
      infrastructureFailures: infrastructureFailures.length,
      modelIdentityDrift: identityDrifts.length,
      stoppedEarly: !allResolved,
    }),
    decision: Object.freeze({
      outcome: decision.outcome,
      reason: decision.reason,
      contingency: decision.contingency,
      ...(decision.pValue === undefined ? {} : { pValue: decision.pValue }),
      ...(decision.delta === undefined ? {} : { delta: decision.delta }),
    }),
    primary,
    secondary: buildSecondary(byArm),
    pairTable: Object.freeze(pairs.map(pair => Object.freeze({ taskId: pair.taskId, resolved: pair.resolved, bSuccess: pair.bSuccess, cSuccess: pair.cSuccess }))),
    strata: Object.freeze(H2_STRATA.slice()),
  })
}

function buildSecondary(byArm) {
  const summarize = arm => {
    const rows = byArm[arm]
    const sum = selector => rows.reduce((total, receipt) => total + selector(receipt), 0)
    const mean = selector => (rows.length === 0 ? 0 : sum(selector) / rows.length)
    const graderPasses = rows.filter(receipt => receipt.grader?.status === 'pass').length
    return Object.freeze({
      observations: rows.length,
      successes: rows.filter(receipt => receipt.success === true).length,
      budgetExhaustions: rows.filter(receipt => receipt.budgetExhausted === true).length,
      // Independent-oracle and termination diagnostics. Product success requires a
      // gradeable workspace, no budget exhaustion and a passing grader, so an arm can
      // lose on resources while its workspaces are correct. Without these fields the
      // published summary can only be read as "the arm wrote worse code", which is not
      // what the run measured — see the H2 terminal outcome document.
      graderPasses,
      graderFailures: rows.length - graderPasses,
      graderPassButBudgetExhausted: rows.filter(receipt => receipt.grader?.status === 'pass' && receipt.budgetExhausted === true).length,
      terminalReasonCounts: countTerminalReasons(rows),
      observationsUsingToolchain: rows.filter(receipt => (receipt.tools?.toolchainToolCalls ?? 0) > 0).length,
      inputTokens: sum(receipt => receipt.usage.inputTokens),
      outputTokens: sum(receipt => receipt.usage.outputTokens),
      totalTokens: sum(receipt => receipt.usage.totalTokens),
      cachedInputTokens: sum(receipt => receipt.usage.cachedInputTokens),
      providerCompletions: sum(receipt => receipt.usage.providerCompletions),
      wallTimeMs: sum(receipt => receipt.timing.wallTimeMs),
      agentSteps: sum(receipt => receipt.timing.agentSteps),
      totalToolCalls: sum(receipt => receipt.tools.totalToolCalls),
      ordinaryToolCalls: sum(receipt => receipt.tools.ordinaryToolCalls),
      toolchainToolCalls: sum(receipt => receipt.tools.toolchainToolCalls),
      meanInputTokens: mean(receipt => receipt.usage.inputTokens),
      meanOutputTokens: mean(receipt => receipt.usage.outputTokens),
      meanTotalTokens: mean(receipt => receipt.usage.totalTokens),
      meanWallTimeMs: mean(receipt => receipt.timing.wallTimeMs),
      meanTotalToolCalls: mean(receipt => receipt.tools.totalToolCalls),
      perTool: aggregatePerTool(rows),
    })
  }
  return Object.freeze({ B: summarize('B'), C: summarize('C'), cost: Object.freeze({ note: 'Tokens are provider-billed usage; no composite score is derived.' }) })
}

/**
 * Terminal reasons are a closed set in practice but not in the type system, so the
 * histogram is built from the observed values in a stable key order. That keeps the
 * report byte-reproducible for the same receipts rather than dependent on their order.
 */
function countTerminalReasons(rows) {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const receipt of rows) {
    const reason = String(receipt.terminalReason)
    counts[reason] = (counts[reason] ?? 0) + 1
  }
  /** @type {Record<string, number>} */
  const sorted = {}
  for (const reason of Object.keys(counts).sort()) sorted[reason] = counts[reason]
  return Object.freeze(sorted)
}

function aggregatePerTool(rows) {
  /** @type {Record<string, number>} */
  const totals = {}
  for (const receipt of rows) {
    for (const [name, count] of Object.entries(receipt.tools?.perTool ?? {})) {
      totals[name] = (totals[name] ?? 0) + count
    }
  }
  /** @type {Record<string, number>} */
  const sorted = {}
  for (const name of Object.keys(totals).sort()) sorted[name] = totals[name]
  return Object.freeze(sorted)
}