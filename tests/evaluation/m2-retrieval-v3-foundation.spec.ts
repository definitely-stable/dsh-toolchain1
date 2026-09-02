import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'

import { searchContractIndex } from '../../src/model/contract.js'
import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'

const AUDIT_TASKS = Object.freeze([
  ...new Map(M2_RETRIEVAL_R1.map(task => [task.category, task] as const)).values(),
])

function score(
  index: Awaited<ReturnType<typeof createFrozenM2RetrievalIndex>>,
  derived?: ReturnType<typeof createContractSearchIndex>,
) {
  return AUDIT_TASKS.map(task => searchContractIndex(index, task.query, undefined, 5, derived))
}

describe('Contract Search v3 foundation audit', () => {
  it('keeps representative cold and warm selections identical while materializing reusable derived state', async () => {
    const index = await createFrozenM2RetrievalIndex()

    const buildStarted = performance.now()
    const derived = createContractSearchIndex(index)
    const buildMs = performance.now() - buildStarted

    const coldStarted = performance.now()
    const cold = score(index)
    const coldMs = performance.now() - coldStarted

    const warmStarted = performance.now()
    const warm = score(index, derived)
    const warmMs = performance.now() - warmStarted

    expect(AUDIT_TASKS.length).toBeGreaterThan(0)
    expect(new Set(AUDIT_TASKS.map(task => task.category)).size).toBe(AUDIT_TASKS.length)
    expect(warm).toEqual(cold)
    expect(derived.contractIndexFingerprint).toBe(index.fingerprint)
    expect(derived.documentCount).toBe(index.contracts.length)
    expect(derived.documentCount).toBeGreaterThan(0)
    expect(derived.postingCount).toBeGreaterThan(0)
    expect(derived.retainedTokenCount).toBeGreaterThan(0)

    console.log('M2_RETRIEVAL_V3_FOUNDATION_AUDIT', JSON.stringify({
      rankerVersion: derived.rankerVersion,
      contractIndexFingerprint: derived.contractIndexFingerprint,
      taskCount: AUDIT_TASKS.length,
      categories: AUDIT_TASKS.map(task => task.category),
      documentCount: derived.documentCount,
      postingCount: derived.postingCount,
      retainedTokenCount: derived.retainedTokenCount,
      buildMs,
      coldMs,
      warmMs,
    }))
  })
})
