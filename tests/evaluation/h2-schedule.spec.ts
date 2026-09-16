import { describe, expect, it } from 'vitest'

import { buildH2Schedule } from '../../scripts/eval/h2/h2-schedule.mjs'

const TASK_IDS = Array.from({ length: 18 }, (_, index) => `h2-task-${String(index + 1).padStart(2, '0')}`)

describe('H2 deterministic schedule', () => {
  it('builds exactly 36 entries: every task once per arm, ordinals 1..36', () => {
    const schedule = buildH2Schedule({ taskIds: TASK_IDS })
    expect(schedule.entries).toHaveLength(36)
    expect(schedule.entries.map(entry => entry.ordinal)).toEqual(Array.from({ length: 36 }, (_, i) => i + 1))
    for (const taskId of TASK_IDS) {
      const arms = schedule.entries.filter(entry => entry.taskId === taskId).map(entry => entry.arm)
      expect(arms.sort()).toEqual(['B', 'C'])
    }
    expect(schedule.entries.every(entry => entry.arm === 'B' || entry.arm === 'C')).toBe(true)
  })

  it('balances arm order: exactly nine tasks run B->C and nine run C->B', () => {
    const schedule = buildH2Schedule({ taskIds: TASK_IDS })
    const bFirst = schedule.entries.filter((entry, index) => index % 2 === 0 && entry.arm === 'B').length
    const cFirst = schedule.entries.filter((entry, index) => index % 2 === 0 && entry.arm === 'C').length
    expect(bFirst).toBe(9)
    expect(cFirst).toBe(9)
    // Each task's two entries are adjacent, and the arm order comes from the
    // first entry of the pair.
    for (let start = 0; start < 36; start += 2) {
      const [first, second] = schedule.entries.slice(start, start + 2)
      expect(first.taskId).toBe(second.taskId)
      expect(first.arm).not.toBe(second.arm)
    }
  })

  it('is fully deterministic: same inputs produce the identical frozen schedule', () => {
    const first = buildH2Schedule({ taskIds: TASK_IDS })
    const second = buildH2Schedule({ taskIds: TASK_IDS })
    expect(second).toEqual(first)
    expect(Object.isFrozen(scheduleOf(first))).toBe(true)
    expect(first.entries.every(Object.isFrozen)).toBe(true)
  })

  it('changes the hash when the task set changes, and keeps a stable identity within one set', () => {
    const first = buildH2Schedule({ taskIds: TASK_IDS })
    const other = buildH2Schedule({ taskIds: [...TASK_IDS].reverse() })
    expect(first.hash).toBe((buildH2Schedule({ taskIds: TASK_IDS }).hash))
    expect(other.hash).not.toBe(first.hash)
    expect(/^[0-9a-f]{64}$/.test(first.hash)).toBe(true)
  })

  it('refuses duplicate or fewer than 18 task ids', () => {
    expect(() => buildH2Schedule({ taskIds: [...TASK_IDS, 'h2-task-19'] })).toThrow()
    expect(() => buildH2Schedule({ taskIds: TASK_IDS.slice(0, 17) })).toThrow()
    expect(() => buildH2Schedule({ taskIds: [...TASK_IDS.slice(0, 17), TASK_IDS[0]] })).toThrow()
  })

  it('records the frozen seed in the schedule identity', () => {
    const schedule = buildH2Schedule({ taskIds: TASK_IDS })
    expect(schedule.seed).toBe('h2-product-benchmark-v1-schedule')
    expect(schedule.schema).toBe('dsh-toolchain-h2-schedule-v1')
  })
})

function scheduleOf(schedule: { entries: readonly unknown[] }) {
  return schedule
}