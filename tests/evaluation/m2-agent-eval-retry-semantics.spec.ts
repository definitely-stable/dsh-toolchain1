import { describe, expect, it } from 'vitest'

import {
  validateAgentAttempts,
  type AgentAttemptRecord,
} from './m2-agent-eval-integrity.js'

const policy = {
  maxInfrastructureRetries: 2,
  modelOutcomeRetries: 0 as const,
  retryableReasons: ['provider-transport'] as const,
}

function failures(count: number): AgentAttemptRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    taskId: 'h1-retry-budget',
    arm: 'C' as const,
    trial: 1 as const,
    attempt: index + 1,
    kind: 'infrastructure-failure' as const,
    reason: 'provider-transport',
  }))
}

describe('M2.3 infrastructure retry semantics', () => {
  it('interprets maxInfrastructureRetries as retries after the initial attempt', () => {
    expect(() => validateAgentAttempts(failures(3), policy)).not.toThrow()
    expect(() => validateAgentAttempts(failures(4), policy)).toThrow(/infrastructure retr/i)
  })

  it('allows the second retry to produce the one terminal model outcome', () => {
    const attempts: AgentAttemptRecord[] = [
      ...failures(2),
      {
        taskId: 'h1-retry-budget',
        arm: 'C',
        trial: 1,
        attempt: 3,
        kind: 'model-outcome',
      },
    ]

    expect(() => validateAgentAttempts(attempts, policy)).not.toThrow()
  })
})