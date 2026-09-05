import { describe, expect, it } from 'vitest'

import { buildStagedEvaluationReport } from '../../scripts/eval/staged-report.mjs'

const BY_TOOL_ZERO = Object.freeze({
  read_file: 0,
  search_text: 0,
  toolchain_contract_search: 0,
  toolchain_contract_inspect: 0,
})

const TASKS = Object.freeze([
  Object.freeze({
    id: 'task-1',
    domain: 'approval-policy',
    prompt: 'DO_NOT_PERSIST_PROMPT_ALPHA',
    successRule: Object.freeze({
      kind: 'api-exists-any',
      package: '@deepseek-ai/dsh-user-approval',
      symbols: Object.freeze(['ApprovalPolicy']),
    }),
  }),
  Object.freeze({
    id: 'task-2',
    domain: 'tool-schema',
    prompt: 'DO_NOT_PERSIST_PROMPT_BETA',
    successRule: Object.freeze({
      kind: 'api-absent',
      symbols: Object.freeze(['FutureTool']),
      proofScope: Object.freeze({ kind: 'target' }),
    }),
  }),
])

function result(
  arm: 'B' | 'C',
  taskId: string,
  decision?: { apiValid: boolean },
  terminalTransportReason?: string,
  failureCode?: string,
) {
  const cost = arm === 'B'
    ? {
        usage: { inputTokens: 100, outputTokens: 20, turns: 2, providerCompletions: 2 },
        toolUsage: {
          calls: 3,
          ordinaryCalls: 3,
          toolchainCalls: 0,
          byTool: { ...BY_TOOL_ZERO, read_file: 1, search_text: 2 },
          structuredTransportCalls: 1,
          measurementToolCalls: 1,
        },
      }
    : {
        usage: { inputTokens: 120, outputTokens: 30, turns: 3, providerCompletions: 3 },
        toolUsage: {
          calls: 4,
          ordinaryCalls: 2,
          toolchainCalls: 2,
          byTool: {
            ...BY_TOOL_ZERO,
            read_file: 1,
            search_text: 1,
            toolchain_contract_search: 1,
            toolchain_contract_inspect: 1,
          },
          structuredTransportCalls: 1,
          measurementToolCalls: 1,
        },
      }

  return {
    call: { ordinal: taskId === 'task-1' ? (arm === 'B' ? 1 : 2) : (arm === 'B' ? 3 : 4), taskId, arm, repetition: 1 },
    measurement: {
      arm,
      formatValid: decision !== undefined,
      decisionResolved: decision !== undefined,
      infrastructureFailures: 0,
      attemptCount: 1,
      hasModelOutcome: true,
      measurementAttempted: true,
      unrecoveredInfrastructure: false,
      ...(terminalTransportReason === undefined ? {} : { terminalTransportReason }),
    },
    productOutcome: { kind: 'completed' as const },
    ...(decision === undefined ? {} : { decision }),
    ...(failureCode === undefined ? {} : { failure: { code: failureCode, summary: 'test failure' } }),
    cost: {
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 10,
      ...cost,
    },
    // Deliberately unsafe synthetic material: report receipts must never copy it.
    reasoning: 'DO_NOT_PERSIST_CHAIN_OF_THOUGHT',
    rawToolPayload: { secret: 'DO_NOT_PERSIST_RAW_TOOL_PAYLOAD' },
  }
}

function budgetExhaustedB(taskId: string) {
  return {
    call: { ordinal: 3, taskId, arm: 'B' as const, repetition: 1 },
    measurement: {
      arm: 'B' as const,
      formatValid: false,
      decisionResolved: false,
      infrastructureFailures: 0,
      attemptCount: 1,
      hasModelOutcome: true,
      measurementAttempted: false,
      unrecoveredInfrastructure: false,
      terminalTransportReason: 'tool_call_limit',
    },
    productOutcome: { kind: 'budget-exhausted' as const, reason: 'tool_budget_exhausted' as const },
    failure: { code: 'PRODUCT_BUDGET_EXHAUSTED', summary: 'bounded product terminal' },
    cost: {
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 100,
      usage: { inputTokens: 500, outputTokens: 50, turns: 32, providerCompletions: 32 },
      toolUsage: {
        calls: 31,
        ordinaryCalls: 31,
        toolchainCalls: 0,
        byTool: { ...BY_TOOL_ZERO, read_file: 10, search_text: 21 },
        structuredTransportCalls: 0,
        measurementToolCalls: 0,
      },
    },
  }
}

function unrecoveredC(taskId: string) {
  return {
    call: { ordinal: 4, taskId, arm: 'C' as const, repetition: 1 },
    measurement: {
      arm: 'C' as const,
      formatValid: false,
      decisionResolved: false,
      infrastructureFailures: 2,
      attemptCount: 2,
      hasModelOutcome: false,
      measurementAttempted: false,
      unrecoveredInfrastructure: true,
    },
    failure: { code: 'UNRECOVERED_INFRASTRUCTURE', summary: 'test failure' },
    cost: {
      attempts: 2,
      infrastructureFailures: 2,
      wallTimeMs: 20,
      usage: { inputTokens: 0, outputTokens: 0, turns: 0, providerCompletions: 0 },
      toolUsage: {
        calls: 0,
        ordinaryCalls: 0,
        toolchainCalls: 0,
        byTool: { ...BY_TOOL_ZERO },
        structuredTransportCalls: 0,
        measurementToolCalls: 0,
      },
    },
  }
}

function run(status: 'PASS' | 'STOP') {
  const canaryResults = [
    result('B', 'task-1', { apiValid: true }),
    result('C', 'task-1', { apiValid: true }),
    result('B', 'task-2', { apiValid: false }),
    status === 'PASS'
      ? result('C', 'task-2', { apiValid: true })
      : result('C', 'task-2', undefined, 'structured_measurement_invalid', 'STRUCTURED_RESULT_INVALID'),
  ]
  return {
    mode: 'dev',
    measurementStatus: status,
    schedule: { selectedTasks: TASKS },
    canaryResults,
    remainderResults: [],
    health: {
      status,
      reasons: status === 'STOP' ? ['FORMAT_COMPLIANCE_BELOW_MINIMUM'] : [],
      metrics: {
        scheduledObservations: 4,
        modelOutcomeObservations: 4,
        measurementAttemptObservations: 4,
        formatComplianceRate: status === 'STOP' ? 0.75 : 1,
      },
    },
    authorization: {
      plannedCalls: 40,
      canaryCalls: 16,
      remainderPlanned: 24,
      remainderAuthorized: status === 'STOP' ? 0 : 24,
      executedCalls: 4,
    },
  }
}

describe('staged evaluation report', () => {
  it('publishes report-v3 bounded product metrics without regressing cost/tool telemetry', () => {
    const report = buildStagedEvaluationReport(run('PASS'))

    expect(report.schema).toBe('dsh-toolchain-staged-eval-report-v3')
    expect(report.measurement).toMatchObject({
      status: 'PASS',
      reasons: [],
      failureDiagnostics: { total: 0, byCode: [] },
    })
    expect(report.product).toMatchObject({
      interpretable: true,
      resolvedObservations: 4,
      apiValidObservations: 3,
      byArm: {
        B: { resolved: 2, apiValid: 1 },
        C: { resolved: 2, apiValid: 2 },
      },
      pairedTasks: { count: 2, apiValidityDeltaCMinusB: 1 },
      boundedCompletion: {
        eligibleObservations: 4,
        completedObservations: 4,
        rate: 1,
        byArm: {
          B: { eligible: 2, completed: 2, rate: 1 },
          C: { eligible: 2, completed: 2, rate: 1 },
        },
        paired: { count: 2, bothCompleted: 2, bOnly: 0, cOnly: 0, neither: 0, rateDeltaCMinusB: 0 },
      },
      boundedApiSuccess: {
        eligibleObservations: 4,
        successfulObservations: 3,
        rate: 0.75,
        byArm: {
          B: { eligible: 2, successful: 1, rate: 0.5 },
          C: { eligible: 2, successful: 2, rate: 1 },
        },
        paired: { count: 2, bothSuccess: 1, bOnly: 0, cOnly: 1, neither: 0, rateDeltaCMinusB: 0.5 },
      },
      taskSuccessGuardrail: { measured: false },
    })
    expect(report.cost).toMatchObject({
      modelCalls: 4,
      attempts: 4,
      inputTokens: 440,
      outputTokens: 100,
      toolCalls: 14,
      ordinaryCalls: 10,
      toolchainCalls: 4,
      byArm: {
        B: { modelCalls: 2, inputTokens: 200, ordinaryCalls: 6, toolchainCalls: 0 },
        C: { modelCalls: 2, inputTokens: 240, ordinaryCalls: 4, toolchainCalls: 4 },
      },
      toolchainUse: { eligibleObservations: 2, observationsWithUse: 2, rate: 1 },
    })
  })

  it('retains bounded budget exhaustion instead of complete-case censoring', () => {
    const staged = run('PASS')
    staged.canaryResults[2] = budgetExhaustedB('task-2')
    const report = buildStagedEvaluationReport(staged)

    expect(report.product.pairedTasks).toEqual({ count: 1, apiValidityDeltaCMinusB: 0 })
    expect(report.product.boundedCompletion).toMatchObject({
      byArm: {
        B: { eligible: 2, completed: 1, rate: 0.5 },
        C: { eligible: 2, completed: 2, rate: 1 },
      },
      paired: { count: 2, bothCompleted: 1, bOnly: 0, cOnly: 1, neither: 0, rateDeltaCMinusB: 0.5 },
    })
    expect(report.product.boundedApiSuccess).toMatchObject({
      byArm: {
        B: { eligible: 2, successful: 1, rate: 0.5 },
        C: { eligible: 2, successful: 2, rate: 1 },
      },
      paired: { count: 2, bothSuccess: 1, bOnly: 0, cOnly: 1, neither: 0, rateDeltaCMinusB: 0.5 },
    })
    expect(report.observations.find(value => value.taskId === 'task-2' && value.arm === 'B')).toMatchObject({
      ordinal: 3,
      taskId: 'task-2',
      arm: 'B',
      repetition: 1,
      domain: 'tool-schema',
      oracleKind: 'api-absent',
      hasModelOutcome: true,
      measurementAttempted: false,
      productOutcome: { kind: 'budget-exhausted', reason: 'tool_budget_exhausted' },
      terminalReason: 'tool_call_limit',
      failureCode: 'PRODUCT_BUDGET_EXHAUSTED',
      cost: {
        inputTokens: 500,
        outputTokens: 50,
        turns: 32,
        providerCompletions: 32,
        toolCalls: 31,
        ordinaryCalls: 31,
        toolchainCalls: 0,
      },
    })
  })

  it('persists only safe operational observation receipts, never prompts, reasoning or raw tool payloads', () => {
    const report = buildStagedEvaluationReport(run('PASS'))
    expect(report.observations.map(value => value.ordinal)).toEqual([1, 2, 3, 4])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('DO_NOT_PERSIST_PROMPT_ALPHA')
    expect(serialized).not.toContain('DO_NOT_PERSIST_PROMPT_BETA')
    expect(serialized).not.toContain('DO_NOT_PERSIST_CHAIN_OF_THOUGHT')
    expect(serialized).not.toContain('DO_NOT_PERSIST_RAW_TOOL_PAYLOAD')
    expect(serialized).not.toContain('rawToolPayload')
    expect(serialized).not.toContain('reasoning')
  })

  it('keeps STOP reports non-interpretable and excludes unrecovered C infrastructure from agent-use/product denominators', () => {
    const staged = run('STOP')
    staged.canaryResults[3] = unrecoveredC('task-2')
    const report = buildStagedEvaluationReport(staged)

    expect(report.product).toMatchObject({ interpretable: false, blockedBy: 'measurement-health' })
    expect(report.cost.byArm.C).toMatchObject({ modelCalls: 2, attempts: 3, infrastructureFailures: 2 })
    expect(report.cost.toolchainUse).toEqual({ eligibleObservations: 1, observationsWithUse: 1, rate: 1 })
    expect(report.product.boundedCompletion.byArm.C.eligible).toBe(1)
    expect(report.product.boundedApiSuccess.byArm.C.eligible).toBe(1)
    expect(Object.isFrozen(report)).toBe(true)
  })
})
