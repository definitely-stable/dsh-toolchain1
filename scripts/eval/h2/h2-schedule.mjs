import { H2_POLICY } from './h2-config.mjs'
import { requireNonNegativeSafeInteger, sha256Canonical, sha256Utf8 } from './h2-util.mjs'

export const H2_SCHEDULE_SCHEMA = 'dsh-toolchain-h2-schedule-v1'

/**
 * Mulberry32 PRNG over a 32-bit seed, matching the deterministic schedule
 * approach used by the frozen H1 analysis (SHA-256-derived seed).
 */
function mulberry32(seed) {
  let state = seed >>> 0
  return function next() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** First 32 bits of the SHA-256 of the seed and ordered task ids. */
function deriveSeed(seed, taskIds) {
  const sortKey = [...taskIds].sort().join('\n')
  const hash = sha256Utf8(`${seed}\n${sortKey}`)
  return Number.parseInt(hash.slice(0, 8), 16) >>> 0
}

/**
 * Builds the frozen H2 schedule: exactly 18 tasks × 2 arms = 36 entries.
 * The 18 task ids are pseudo-randomly shuffled with the frozen seed, the
 * first 9 run B→C and the last 9 run C→B, producing a deterministic arm
 * order that can never be re-rolled after the seed is committed.
 */
export function buildH2Schedule({ taskIds, seed = H2_POLICY.schedule.seed }) {
  if (!Array.isArray(taskIds)) throw new Error('H2 schedule requires an array of task ids')
  const ids = [...taskIds]
  if (ids.length !== H2_POLICY.taskCount) throw new Error(`H2 schedule requires exactly ${H2_POLICY.taskCount} task ids`)
  if (new Set(ids).size !== ids.length) throw new Error('H2 schedule requires unique task ids')

  const shuffled = [...ids]
  const random = mulberry32(deriveSeed(seed, ids))
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    const swap = shuffled[index]
    shuffled[index] = shuffled[other]
    shuffled[other] = swap
  }

  const entries = []
  let ordinal = 1
  shuffled.forEach((taskId, index) => {
    const arms = index < H2_POLICY.schedule.balancedArmOrderTasks ? ['B', 'C'] : ['C', 'B']
    for (const arm of arms) {
      entries.push(Object.freeze({ ordinal, taskId, arm }))
      ordinal += 1
    }
  })

  return Object.freeze({
    schema: H2_SCHEDULE_SCHEMA,
    seed,
    entries: Object.freeze(entries),
    hash: sha256Canonical({ seed, entries }),
  })
}

/** Returns the task ids a schedule covers, in first-appearance order. */
export function scheduleTaskOrder(schedule) {
  const seen = new Set()
  const order = []
  for (const entry of schedule.entries) {
    if (!seen.has(entry.taskId)) {
      seen.add(entry.taskId)
      order.push(entry.taskId)
    }
  }
  return order
}

export function assertScheduleMatchesPolicy(schedule) {
  if (!schedule || schedule.schema !== H2_SCHEDULE_SCHEMA) throw new Error('H2 schedule schema mismatch')
  if (schedule.seed !== H2_POLICY.schedule.seed) throw new Error('H2 schedule seed is frozen and must not change')
  if (schedule.entries.length !== H2_POLICY.scoringObservations) {
    throw new Error(`H2 schedule must have exactly ${H2_POLICY.scoringObservations} entries`)
  }
  for (const entry of schedule.entries) {
    requireNonNegativeSafeInteger(entry.ordinal, 'schedule ordinal')
    if (typeof entry.taskId !== 'string' || entry.taskId.length === 0) throw new Error('H2 schedule entry missing taskId')
    if (entry.arm !== 'B' && entry.arm !== 'C') throw new Error('H2 schedule entry has invalid arm')
  }
}