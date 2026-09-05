import { describe, expect, it } from 'vitest'

import { buildStagedEvaluationReport } from '../../scripts/eval/staged-report.mjs'

const BY_TOOL_ZERO = Object.freeze({
  read_file: 0,
  search_text: 0,
  toolchain_contract_search: 0,
  toolchain_contract_inspect: 0,
})

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
    call: { ordinal: 1, taskId, arm, repetition: 1 },
    measurement: {
      arm,
      formatValid: decision !== undefined,
      decisionResolved: decision !== undefined,
      infrastructureFailures: 0,
      attemptCount: 1,
      hasModelOutcome: true,
      unrecoveredInfrastructure: false,
      ...(terminalTransportReason === undefined ? {} : { terminalTransportReason }),
    },
    ...(decision === undefined ? {} : { decision }),
    ...(failureCode === undefined ? {} : { failure: { code: failureCode, summary: 'test failure' } }),
    cost: {
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 10,
      ...cost,
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
    canaryResults,
    remainderResults: [],
    health: {
      status,
      reasons: status === 'STOP' ? ['FORMAT_COMPLIANCE_BELOW_MINIMUM'] : [],
      metrics: { scheduledObservations: 4, formatComplianceRate: status === 'STOP' ? 0.75 : 1 },
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
  it('reports API validity honestly with per-arm cost and actual Toolchain use', () => {
    const report = buildStagedEvaluationReport(run('PASS'))

    expect(report.schema).toBe('dsh-toolchain-staged-eval-report-v2')
    expect(report.measurement).toMatchObject({
      status: 'PASS',
      reasons: [],
      failureDiagnostics: { total: 0, byCode: [] },
      transportDiagnostics: {
        observedTerminalReasons: 0,
        missingTerminalReasons: 4,
        terminalReasons: [],
      },
    })
    expect(report.product).toEqual({
      interpretable: true,
      resolvedObservations: 4,
      apiValidObservations: 3,
      byArm: {
        B: { resolved: 2, apiValid: 1 },
        C: { resolved: 2, apiValid: 2 },
      },
      pairedTasks: {
        count: 2,
        apiValidityDeltaCMinusB: 1,
      },
      taskSuccessGuardrail: {
        measured: false,
        reason: 'single-api-claim development oracle does not independently measure end-to-end task completion',
      },
    })
    expect(report.cost).toEqual({
      modelCalls: 4,
      attempts: 4,
      retries: 0,
      infrastructureFailures: 0,
      wallTimeMs: 40,
      inputTokens: 440,
      outputTokens: 100,
      turns: 10,
      providerCompletions: 10,
      toolCalls: 14,
      measurementToolCalls: 4,
      ordinaryCalls: 10,
      toolchainCalls: 4,
      byTool: {
        read_file: 4,
        search_text: 6,
        toolchain_contract_search: 2,
        toolchain_contract_inspect: 2,
      },
      byArm: {
        B: {
          modelCalls: 2,
          attempts: 2,
          retries: 0,
          infrastructureFailures: 0,
          wallTimeMs: 20,
          inputTokens: 200,
          outputTokens: 40,
          turns: 4,
          providerCompletions: 4,
          toolCalls: 6,
          measurementToolCalls: 2,
          ordinaryCalls: 6,
          toolchainCalls: 0,
          byTool: {
            read_file: 2,
            search_text: 4,
            toolchain_contract_search: 0,
            toolchain_contract_inspect: 0,
          },
        },
        C: {
          modelCalls: 2,
          attempts: 2,
          retries: 0,
          infrastructureFailures: 0,
          wallTimeMs: 20,
          inputTokens: 240,
          outputTokens: 60,
          turns: 6,
          providerCompletions: 6,
          toolCalls: 8,
          measurementToolCalls: 2,
          ordinaryCalls: 4,
          toolchainCalls: 4,
          byTool: {
            read_file: 2,
            search_text: 2,
            toolchain_contract_search: 2,
            toolchain_contract_inspect: 2,
          },
        },
      },
      toolchainUse: {
        eligibleObservations: 2,
        observationsWithUse: 2,
        rate: 1,
      },
    })
  })

  it('keeps STOP reports non-interpretable while preserving executed-arm telemetry', () => {
    const report = buildStagedEvaluationReport(run('STOP'))

    expect(report.measurement).toMatchObject({
      status: 'STOP',
      reasons: ['FORMAT_COMPLIANCE_BELOW_MINIMUM'],
      failureDiagnostics: {
        total: 1,
        byCode: [{
          code: 'STRUCTURED_RESULT_INVALID',
          count: 1,
          byArm: { B: 0, C: 1 },
        }],
      },
      transportDiagnostics: {
        observedTerminalReasons: 1,
        missingTerminalReasons: 3,
        terminalReasons: [{
          reason: 'structured_measurement_invalid',
          count: 1,
          byArm: { B: 0, C: 1 },
        }],
      },
    })
    expect(report.authorization).toMatchObject({ remainderAuthorized: 0 })
    expect(report.product).toMatchObject({
      interpretable: false,
      blockedBy: 'measurement-health',
      resolvedObservations: 3,
      taskSuccessGuardrail: { measured: false },
    })
    expect(report.product.pairedTasks).toEqual({
      count: 1,
      apiValidityDeltaCMinusB: 0,
    })
    expect(report.cost.toolchainUse).toEqual({
      eligibleObservations: 2,
      observationsWithUse: 2,
      rate: 1,
    })
    expect(Object.isFrozen(report)).toBe(true)
  })
})
