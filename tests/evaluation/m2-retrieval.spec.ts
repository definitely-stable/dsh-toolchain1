import { describe, expect, it } from 'vitest'

import { searchContractIndex } from '../../src/model/contract.js'
import {
  createContractSearchIndex,
  type ContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex, M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import {
  calculateM2RetrievalMetrics,
  type M2RankedTaskResult,
  type M2RetrievalMetrics,
  type M2RetrievalTask,
} from './m2-retrieval-metrics.js'

function score(
  index: Awaited<ReturnType<typeof createFrozenM2RetrievalIndex>>,
  derived: ContractSearchIndex,
  tasks: readonly M2RetrievalTask[] = M2_RETRIEVAL_R1,
): M2RankedTaskResult[] {
  return tasks.map(task => {
    const selection = searchContractIndex(index, task.query, undefined, 5, derived)
    return Object.freeze({
      task,
      rankedContractIds: Object.freeze(selection.matches.map(match => match.id)),
    })
  })
}

function rankedByTask(results: readonly M2RankedTaskResult[]): ReadonlyMap<string, readonly string[]> {
  return new Map(results.map(result => [result.task.id, result.rankedContractIds]))
}

function metricValues(metrics: M2RetrievalMetrics): number[] {
  return [
    metrics.successAt1,
    metrics.successAt3,
    metrics.successAt5,
    metrics.meanReciprocalRank,
    metrics.noResultCorrectness,
    metrics.forbiddenHitRateAt5,
    ...Object.values(metrics.byCategory).flatMap(category => [
      category.successAt1,
      category.successAt3,
      category.successAt5,
      category.meanReciprocalRank,
      category.noResultCorrectness,
      category.forbiddenHitRateAt5,
    ].filter((value): value is number => value !== null)),
  ]
}

describe('M2.3 frozen R1 production retrieval', () => {
  it('runs only the production scorer deterministically with limit five', async () => {
    const index = await createFrozenM2RetrievalIndex()
    expect(index.targetFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(index.fingerprint).toBe(M2_RETRIEVAL_TARGET.contractIndexFingerprint)

    const derived = createContractSearchIndex(index)
    const first = score(index, derived)
    const second = score(index, derived)
    expect(rankedByTask(second)).toEqual(rankedByTask(first))

    const reversed = score(index, derived, [...M2_RETRIEVAL_R1].reverse())
    expect(rankedByTask(reversed)).toEqual(rankedByTask(first))

    for (const result of first) {
      expect(result.rankedContractIds.length).toBeLessThanOrEqual(5)
      expect(new Set(result.rankedContractIds).size).toBe(result.rankedContractIds.length)
    }

    const metrics = calculateM2RetrievalMetrics(first)
    expect(metrics.taskCount).toBe(M2_RETRIEVAL_R1.length)
    for (const value of metricValues(metrics)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})
