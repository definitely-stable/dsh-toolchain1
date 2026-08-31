import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  analyzeH1TerminalObservationsV2,
  type H1TerminalObservationV2,
} from './m2-h1-terminal-analysis-v2.js'

function completeObservations(input: {
  readonly taskCount: number
  readonly bInvalid: 0 | 1
  readonly cInvalid: 0 | 1
  readonly bSuccess: 'SUCCESS' | 'FAILURE'
  readonly cSuccess: 'SUCCESS' | 'FAILURE'
}): H1TerminalObservationV2[] {
  const values: H1TerminalObservationV2[] = []
  for (let taskIndex = 1; taskIndex <= input.taskCount; taskIndex += 1) {
    const taskId = `h1-terminal-${String(taskIndex).padStart(3, '0')}`
    for (const trial of [1, 2, 3] as const) {
      values.push({
        taskId,
        arm: 'B',
        trial,
        invalidApi: input.bInvalid,
        taskSuccess: input.bSuccess,
        unresolvedApi: false,
      })
      values.push({
        taskId,
        arm: 'C',
        trial,
        invalidApi: input.cInvalid,
        taskSuccess: input.cSuccess,
        unresolvedApi: false,
      })
    }
  }
  return values
}

describe('M2 H1 terminal analysis v2', () => {
  it('returns a deterministic PASS when both preregistered lower-bound rules are met', async () => {
    const sha256 = createNodeSha256Port()
    const observations = completeObservations({
      taskCount: 96,
      bInvalid: 1,
      cInvalid: 0,
      bSuccess: 'SUCCESS',
      cSuccess: 'SUCCESS',
    })

    const first = await analyzeH1TerminalObservationsV2(observations, false, sha256)
    const second = await analyzeH1TerminalObservationsV2(observations, false, sha256)

    expect(second).toEqual(first)
    expect(first.status).toBe('PASS')
    expect(first.taskCount).toBe(96)
    expect(first.primary.estimate).toBe(1)
    expect(first.primary.lowerBound).toBe(1)
    expect(first.primary.decisionPass).toBe(true)
    expect(first.guardrail.estimate).toBe(0)
    expect(first.guardrail.lowerBound).toBe(0)
    expect(first.guardrail.decisionPass).toBe(true)
    expect(first.analysis.resamples).toBe(10_000)
    expect(first.analysis.primarySeed).toBe('m2-v2-primary')
    expect(first.analysis.guardrailSeed).toBe('m2-v2-guardrail')
  })

  it('returns NEEDS-IMPROVEMENT when resolved evidence misses the primary MCID lower bound', async () => {
    const result = await analyzeH1TerminalObservationsV2(completeObservations({
      taskCount: 96,
      bInvalid: 0,
      cInvalid: 0,
      bSuccess: 'SUCCESS',
      cSuccess: 'SUCCESS',
    }), false, createNodeSha256Port())

    expect(result.status).toBe('NEEDS-IMPROVEMENT')
    expect(result.primary.lowerBound).toBe(0)
    expect(result.primary.decisionPass).toBe(false)
    expect(result.guardrail.decisionPass).toBe(true)
  })

  it('returns INCONCLUSIVE rather than scoring unresolved B/C evidence', async () => {
    const observations = completeObservations({
      taskCount: 96,
      bInvalid: 1,
      cInvalid: 0,
      bSuccess: 'SUCCESS',
      cSuccess: 'SUCCESS',
    })
    observations[0] = {
      ...observations[0]!,
      taskSuccess: 'UNKNOWN',
      unresolvedApi: true,
    }

    const result = await analyzeH1TerminalObservationsV2(
      observations,
      false,
      createNodeSha256Port(),
    )

    expect(result.status).toBe('INCONCLUSIVE')
    expect(result.unresolvedDecisionRuns).toBe(1)
    expect(result.primary.decisionPass).toBeNull()
    expect(result.guardrail.decisionPass).toBeNull()
  })

  it('returns INCONCLUSIVE when the completed ledger carries exhausted infrastructure state', async () => {
    const result = await analyzeH1TerminalObservationsV2(completeObservations({
      taskCount: 96,
      bInvalid: 1,
      cInvalid: 0,
      bSuccess: 'SUCCESS',
      cSuccess: 'SUCCESS',
    }), true, createNodeSha256Port())

    expect(result.status).toBe('INCONCLUSIVE')
    expect(result.infrastructureInconclusive).toBe(true)
    expect(result.primary.decisionPass).toBeNull()
  })
})
