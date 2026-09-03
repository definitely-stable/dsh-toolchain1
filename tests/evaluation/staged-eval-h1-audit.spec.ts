import { describe, expect, it } from 'vitest'

import { auditH1HealthPrefixes } from '../../scripts/eval/audit-h1-health.mjs'

type FixtureAttempt =
  | { outcome: 'infrastructure-failure' }
  | { outcome: 'model-outcome'; parsedApiClaims: Array<{ classification: 'UNKNOWN' }>; taskSuccess: 'SUCCESS' | 'UNKNOWN' }

function modelAttempt(input: { formatValid?: boolean; decisionResolved?: boolean; infrastructureFailures?: number } = {}): FixtureAttempt[] {
  const formatValid = input.formatValid ?? true
  const decisionResolved = input.decisionResolved ?? true
  const attempts: FixtureAttempt[] = Array.from(
    { length: input.infrastructureFailures ?? 0 },
    () => ({ outcome: 'infrastructure-failure' as const }),
  )
  attempts.push({
    outcome: 'model-outcome',
    parsedApiClaims: formatValid ? [] : [{ classification: 'UNKNOWN' }],
    taskSuccess: decisionResolved ? 'SUCCESS' : 'UNKNOWN',
  })
  return attempts
}

let nextTaskId = 0
function run(arm: 'A' | 'B' | 'C', input: { formatValid?: boolean; decisionResolved?: boolean; infrastructureFailures?: number } = {}) {
  nextTaskId += 1
  return { taskId: `task-${arm}-${nextTaskId}`, arm, trial: 1, attempts: modelAttempt(input) }
}

describe('H1 health prefix audit', () => {
  it('reports early unhealthy B/C prefixes without changing H1 scientific status', () => {
    const runs = [
      run('A'),
      run('B', { decisionResolved: false }),
      run('C', { decisionResolved: false }),
      run('A'),
      run('B', { decisionResolved: false }),
      run('C'),
      run('A'),
      run('B'),
      run('C', { decisionResolved: false }),
      run('A'),
      run('B'),
      run('C'),
      ...Array.from({ length: 12 }, (_, index) => run(index % 3 === 0 ? 'A' : index % 3 === 1 ? 'B' : 'C')),
    ]
    const result = auditH1HealthPrefixes({
      result: { runs, analysis: { status: 'INCONCLUSIVE' } },
      prefixes: [12, 24],
    })
    expect(result.scientificStatus).toBe('INCONCLUSIVE')
    expect(result.snapshots[0]).toMatchObject({ prefix: 12, healthStatus: 'STOP' })
    expect(result.snapshots[1]).toMatchObject({ prefix: 24 })
    expect(result).not.toHaveProperty('replacementScientificStatus')
  })
})
