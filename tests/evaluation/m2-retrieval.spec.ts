import { describe, expect, it } from 'vitest'

import { searchContractIndex } from '../../src/model/contract.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex, M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import {
  calculateM2RetrievalMetrics,
  type M2RankedTaskResult,
  type M2RetrievalMetrics,
} from './m2-retrieval-metrics.js'

function score(index: Awaited<ReturnType<typeof createFrozenM2RetrievalIndex>>): M2RankedTaskResult[] {
  return M2_RETRIEVAL_R1.map(task => {
    const selection = searchContractIndex(index, task.query, undefined, 5)
    return Object.freeze({
      task,
      rankedContractIds: Object.freeze(selection.matches.map(match => match.id)),
    })
  })
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
    const first = score(index)
    const second = score(index)

    expect(second.map(result => result.rankedContractIds)).toEqual(
      first.map(result => result.rankedContractIds),
    )
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

    throw new Error(`M2_RETRIEVAL_CAPTURE_V1=${JSON.stringify({
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: index.fingerprint,
      results: first.map(result => ({
        taskId: result.task.id,
        rankedContractIds: result.rankedContractIds,
      })),
      metrics,
    })}`)
  })
})
