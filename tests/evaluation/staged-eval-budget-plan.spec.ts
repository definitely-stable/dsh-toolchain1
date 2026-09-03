import { describe, expect, it } from 'vitest'

import { getEvalMode, planEvalBudget } from '../../scripts/eval/budget-plan.mjs'

describe('staged evaluation budget planner', () => {
  it('freezes the intended default modes and call budgets', () => {
    expect(getEvalMode('deterministic')).toEqual({
      mode: 'deterministic',
      taskCount: 0,
      arms: [],
      repetitions: 0,
      expectedModelCalls: 0,
      hardModelCallCap: 0,
      claimStrength: 'implementation-validity',
    })
    expect(getEvalMode('canary')).toMatchObject({ taskCount: 8, arms: ['B', 'C'], repetitions: 1, expectedModelCalls: 16, hardModelCallCap: 16 })
    expect(getEvalMode('dev')).toMatchObject({ taskCount: 20, arms: ['B', 'C'], repetitions: 1, expectedModelCalls: 40, hardModelCallCap: 40 })
    expect(getEvalMode('release')).toMatchObject({ taskCount: 32, arms: ['B', 'C'], repetitions: 1, expectedModelCalls: 64, hardModelCallCap: 64 })
    expect(getEvalMode('research')).toMatchObject({ taskCount: 48, arms: ['B', 'C'], repetitions: 1, expectedModelCalls: 96, hardModelCallCap: 96 })
  })

  it('plans the normal development comparison without arm A or implicit repetitions', () => {
    expect(planEvalBudget({ mode: 'dev' })).toEqual({
      mode: 'dev',
      taskCount: 20,
      arms: ['B', 'C'],
      repetitions: 1,
      expectedModelCalls: 40,
      hardModelCallCap: 40,
      remainingCallHeadroom: 0,
      claimStrength: 'engineering-signal',
    })
  })

  it('rejects unknown modes', () => {
    expect(() => getEvalMode('giant')).toThrow(/unknown evaluation mode/i)
  })

  it('rejects task overrides that exceed the selected mode budget', () => {
    expect(() => planEvalBudget({ mode: 'dev', taskCount: 21 })).toThrow(/hard model-call cap/i)
  })

  it('rejects repetition overrides that silently multiply the budget', () => {
    expect(() => planEvalBudget({ mode: 'canary', repetitions: 2 })).toThrow(/hard model-call cap/i)
  })

  it('does not allow model work in deterministic mode', () => {
    expect(() => planEvalBudget({ mode: 'deterministic', taskCount: 1 })).toThrow(/deterministic mode/i)
  })
})
