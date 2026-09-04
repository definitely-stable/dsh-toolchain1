import { describe, expect, it } from 'vitest'

import { buildStagedEvaluationReport } from '../../scripts/eval/staged-report.mjs'

function result(
  arm: 'B' | 'C',
  taskId: string,
  decision?: { apiValid: boolean; taskSuccess: boolean },
  terminalTransportReason?: string,
  failureCode?: string,
) {
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
    ...(decision === undefined ? {} : {
      decision: {
        schema: 'dsh-toolchain-staged-eval-result-v1',
        taskId,
        ...decision,
        claims: [],
      },
    }),
    ...(failureCode === undefined ? {} : { failure: { code: failureCode, summary: 'test failure' } }),
    cost: {
      attempts: 1,
      infrastructureFailures: 0,
      wallTimeMs: 10,
      usage: { inputTokens: 100, outputTokens: 20, turns: 2, providerCompletions: 2 },
      toolUsage: { calls: 3, structuredTransportCalls: 1 },
    },
  }
}

function run(status: 'PASS' | 'STOP') {
  const canaryResults = [
    result('B', 'task-1', { apiValid: true, taskSuccess: false }),
    result('C', 'task-1', { apiValid: true, taskSuccess: true }),
    result('B', 'task-2', { apiValid: false, taskSuccess: false }),
    status === 'PASS'
      ? result('C', 'task-2', { apiValid: true, taskSuccess: false })
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
  it('separates measurement, product and cost evidence and computes paired C-minus-B deltas only from resolved pairs', () => {
    const report = buildStagedEvaluationReport(run('PASS'))

    expect(report.schema).toBe('dsh-toolchain-staged-eval-report-v1')
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
    expect(report.product).toMatchObject({
      interpretable: true,
      resolvedObservations: 4,
      apiValidObservations: 3,
      taskSuccessObservations: 1,
      byArm: {
        B: { resolved: 2, apiValid: 1, taskSuccess: 0 },
        C: { resolved: 2, apiValid: 2, taskSuccess: 1 },
      },
      pairedTasks: {
        count: 2,
        apiValidityDeltaCMinusB: 1,
        taskSuccessDeltaCMinusB: 1,
      },
    })
    expect(report.cost).toEqual({
      modelCalls: 4,
      attempts: 4,
      retries: 0,
      infrastructureFailures: 0,
      wallTimeMs: 40,
      inputTokens: 400,
      outputTokens: 80,
      turns: 8,
      providerCompletions: 8,
      toolCalls: 12,
      measurementToolCalls: 4,
    })
  })

  it('makes STOP reports explicitly non-interpretable and aggregates failure codes by arm', () => {
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
    })
    expect(report.product.pairedTasks).toEqual({
      count: 1,
      apiValidityDeltaCMinusB: 0,
      taskSuccessDeltaCMinusB: 1,
    })
    expect(Object.isFrozen(report)).toBe(true)
  })
})
