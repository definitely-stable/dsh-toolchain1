import { describe, expect, it } from 'vitest'

import { analyzeTerminalEvidence, parseArguments } from '../../scripts/post-analyze-m2-h1.mjs'

const TASK_COUNT = 96

function contentRef(value: unknown): Record<string, unknown> {
  return { inline: JSON.stringify(value) }
}

function modelAttempt(input: {
  invalid?: boolean
  taskSuccess?: 'SUCCESS' | 'FAILURE' | 'UNKNOWN'
  toolchain?: 'none' | 'search' | 'search-inspect' | 'error'
} = {}): Record<string, unknown> {
  const entries: Record<string, unknown>[] = []
  if (input.toolchain === 'search' || input.toolchain === 'search-inspect' || input.toolchain === 'error') {
    entries.push({ family: 'toolchain', name: 'toolchain_contract_search', status: input.toolchain === 'error' ? 'error' : 'ok' })
  }
  if (input.toolchain === 'search-inspect') {
    entries.push({ family: 'toolchain', name: 'toolchain_contract_inspect', status: 'ok' })
  }
  return {
    outcome: 'model-outcome',
    parsedApiClaims: [{ classification: input.invalid ? 'INVALID' : 'VALID' }],
    taskSuccess: input.taskSuccess ?? 'SUCCESS',
    executionEvidence: {
      trace: contentRef({ entries }),
      resourceReceipt: contentRef({
        observed: {
          wallTimeMs: 100,
          turns: entries.length + 1,
          inputTokens: 200,
          outputTokens: 50,
        },
      }),
    },
  }
}

function fixture(input: {
  status: 'PASS' | 'NEEDS-IMPROVEMENT' | 'INCONCLUSIVE'
  cToolchain?: 'none' | 'search' | 'search-inspect' | 'error'
}): {
  result: Record<string, unknown>
  analysisArtifact: Record<string, unknown>
  hiddenDataset: Record<string, unknown>
} {
  const tasks = Array.from({ length: TASK_COUNT }, (_, index) => ({
    id: `h1-${String(index + 1).padStart(3, '0')}`,
    domain: `domain-${Math.floor(index / 12) + 1}`,
    successRule: { kind: index < 72 ? 'api-exists-any' : 'api-absent' },
  }))
  const runs: Record<string, unknown>[] = []
  for (const task of tasks) {
    for (const arm of ['A', 'B', 'C'] as const) {
      for (const trial of [1, 2, 3] as const) {
        runs.push({
          taskId: task.id,
          arm,
          trial,
          attempts: [modelAttempt({
            invalid: arm === 'B',
            toolchain: arm === 'C' ? (input.cToolchain ?? 'search-inspect') : 'none',
          })],
        })
      }
    }
  }
  const primaryPass = input.status === 'PASS'
  const guardrailPass = input.status !== 'INCONCLUSIVE'
  return {
    hiddenDataset: { tasks },
    result: { status: input.status, runs },
    analysisArtifact: {
      resultSha256: 'a'.repeat(64),
      analysisSha256: 'b'.repeat(64),
      analysis: {
        status: input.status,
        primary: {
          estimate: input.status === 'INCONCLUSIVE' ? null : 1,
          lowerBound: input.status === 'INCONCLUSIVE' ? null : 1,
          upperBound: input.status === 'INCONCLUSIVE' ? null : 1,
          threshold: 0.1,
          decisionPass: input.status === 'INCONCLUSIVE' ? null : primaryPass,
        },
        guardrail: {
          estimate: input.status === 'INCONCLUSIVE' ? null : 0,
          lowerBound: input.status === 'INCONCLUSIVE' ? null : 0,
          upperBound: input.status === 'INCONCLUSIVE' ? null : 0,
          threshold: -0.05,
          decisionPass: input.status === 'INCONCLUSIVE' ? null : guardrailPass,
        },
      },
    },
  }
}

describe('M2 H1 post-analysis', () => {
  it('keeps confirmatory PASS immutable while producing task/domain/tool diagnostics', () => {
    const analyzed = analyzeTerminalEvidence(fixture({ status: 'PASS', cToolchain: 'search-inspect' }))

    expect(analyzed.exploratoryOnly).toBe(true)
    expect(analyzed.confirmatoryDecision.status).toBe('PASS')
    expect(analyzed.taskCount).toBe(96)
    expect(analyzed.runCount).toBe(864)
    expect(analyzed.taskDiagnostics).toHaveLength(96)
    expect(Object.keys(analyzed.byDomain)).toHaveLength(8)
    expect(analyzed.taskDiagnostics[0]?.primaryEffect).toBe(1)
    expect(analyzed.taskDiagnostics[0]?.guardrailEffect).toBe(0)
    expect(analyzed.cToolchain.usedTrialRate).toBe(1)
    expect(analyzed.cToolchain.inspectRateAmongUsed).toBe(1)
    expect(analyzed.recommendation.nextAction).toBe('ADVANCE_M2')
  })

  it('routes a NEEDS-IMPROVEMENT result with low C adoption to tool-selection work', () => {
    const analyzed = analyzeTerminalEvidence(fixture({ status: 'NEEDS-IMPROVEMENT', cToolchain: 'none' }))

    expect(analyzed.confirmatoryDecision.status).toBe('NEEDS-IMPROVEMENT')
    expect(analyzed.cToolchain.usedTrialRate).toBe(0)
    expect(analyzed.recommendation.nextAction).toBe('OPEN_SEPARATE_IMPROVEMENT_SLICE')
    expect(analyzed.recommendation.recommendedEngineeringSlice).toBe('TOOL_SELECTION_AND_AFFORDANCE')
    expect(analyzed.failureModes.C).toEqual({ SUCCESS: 288 })
  })

  it('never turns INCONCLUSIVE into a product-tuning recommendation', () => {
    const analyzed = analyzeTerminalEvidence(fixture({ status: 'INCONCLUSIVE', cToolchain: 'search-inspect' }))

    expect(analyzed.confirmatoryDecision.status).toBe('INCONCLUSIVE')
    expect(analyzed.recommendation.nextAction).toBe('RESOLVE_PREREGISTERED_RECOVERY_PATH')
    expect(analyzed.recommendation.recommendedEngineeringSlice).toBe('EVALUATION_RECOVERY')
  })

  it('rejects incomplete CLI identity', () => {
    expect(() => parseArguments(['--terminal-dir', 'a', '--output-dir', 'b', '--terminal-run-id', 'abc']))
      .toThrow(/numeric/u)
    expect(() => parseArguments(['--terminal-dir', 'a'])).toThrow(/requires/u)
  })
})
