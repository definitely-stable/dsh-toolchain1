import { describe, expect, it } from 'vitest'

import { buildStagedSchedule } from '../../scripts/eval/staged-schedule.mjs'

const tasks = Array.from({ length: 48 }, (_, index) => ({
  id: `task-${String(index + 1).padStart(2, '0')}`,
  domain: `domain-${index % 6}`,
  prompt: `Prompt ${index + 1}`,
  successRule: {
    kind: Math.floor(index / 6) % 2 === 0 ? 'api-exists-any' : 'api-absent',
  },
}))

function tupleIdentity(call: { taskId: string; arm: 'B' | 'C'; repetition: number }) {
  return `${call.taskId}:${call.arm}:${call.repetition}`
}

describe('staged evaluation deterministic schedule', () => {
  it.each([
    ['canary', 16, 0, 16],
    ['dev', 16, 24, 40],
    ['release', 16, 48, 64],
    ['research', 16, 80, 96],
  ] as const)('builds %s with an exact 16-call canary prefix and bounded remainder', (mode, canaryCount, remainderCount, total) => {
    const schedule = buildStagedSchedule({ mode, tasks })

    expect(schedule.canaryCalls).toHaveLength(canaryCount)
    expect(schedule.remainderCalls).toHaveLength(remainderCount)
    expect(schedule.plan.expectedModelCalls).toBe(total)
    expect([...schedule.canaryCalls, ...schedule.remainderCalls]).toHaveLength(total)
    expect(Object.isFrozen(schedule)).toBe(true)
    expect(Object.isFrozen(schedule.canaryCalls)).toBe(true)
    expect(Object.isFrozen(schedule.remainderCalls)).toBe(true)
  })

  it('uses B/C only, repetition one, deterministic task-major ordering and no duplicate tuples', () => {
    const first = buildStagedSchedule({ mode: 'dev', tasks })
    const second = buildStagedSchedule({ mode: 'dev', tasks })
    const calls = [...first.canaryCalls, ...first.remainderCalls]

    expect(second).toEqual(first)
    expect(calls.every(call => call.arm === 'B' || call.arm === 'C')).toBe(true)
    expect(calls.every(call => call.repetition === 1)).toBe(true)
    expect(calls.map(call => call.ordinal)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
    expect(new Set(calls.map(tupleIdentity)).size).toBe(calls.length)

    expect(calls.slice(0, 4)).toEqual([
      expect.objectContaining({ ordinal: 1, taskId: first.selectedTasks[0].id, arm: 'B', repetition: 1 }),
      expect.objectContaining({ ordinal: 2, taskId: first.selectedTasks[0].id, arm: 'C', repetition: 1 }),
      expect.objectContaining({ ordinal: 3, taskId: first.selectedTasks[1].id, arm: 'B', repetition: 1 }),
      expect.objectContaining({ ordinal: 4, taskId: first.selectedTasks[1].id, arm: 'C', repetition: 1 }),
    ])
  })

  it('makes the canary exactly the first eight selected tasks across both B/C arms', () => {
    const schedule = buildStagedSchedule({ mode: 'research', tasks })
    const canaryTaskIds = new Set(schedule.canaryCalls.map(call => call.taskId))

    expect([...canaryTaskIds]).toEqual(schedule.selectedTasks.slice(0, 8).map(task => task.id))
    expect(schedule.canaryCalls).toEqual(
      [...schedule.canaryCalls, ...schedule.remainderCalls].slice(0, 16),
    )
  })

  it('rejects deterministic mode because this runner cannot invent model work', () => {
    expect(() => buildStagedSchedule({ mode: 'deterministic', tasks })).toThrow(/deterministic mode/i)
  })
})
