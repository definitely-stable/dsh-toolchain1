import { describe, expect, it } from 'vitest'

import {
  CONTRACT_SEARCH_RANKER_VERSION,
  searchContractIndex,
} from '../../src/model/contract.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  calculateM2RetrievalMetrics,
  type M2RankedTaskResult,
} from './m2-retrieval-metrics.js'

const HISTORICAL_SUCCESS_AT_5 = 0.5625
const HISTORICAL_FORBIDDEN_HIT_RATE_AT_5 = 0.2

async function currentMetrics() {
  const index = await createFrozenM2RetrievalIndex()
  const ranked: M2RankedTaskResult[] = M2_RETRIEVAL_R1.map(task => {
    const selection = searchContractIndex(index, task.query, undefined, 5)
    return Object.freeze({
      task,
      rankedContractIds: Object.freeze(selection.matches.map(match => match.id)),
    })
  })
  return calculateM2RetrievalMetrics(ranked)
}

describe('M2 post-H1 intent retrieval development gate', () => {
  it('improves the disclosed R1 intent gap without regressing frozen exact/package/no-result guardrails', async () => {
    const metrics = await currentMetrics()

    // Emit one bounded marker so the reviewed development baseline can be copied
    // into durable documentation without mutating the historical v1 baseline.
    console.info('M2_RETRIEVAL_V2_DEVELOPMENT_METRICS', JSON.stringify({
      rankerVersion: CONTRACT_SEARCH_RANKER_VERSION,
      metrics,
    }))

    expect(CONTRACT_SEARCH_RANKER_VERSION).toBe('dsh-contract-search-v2-intent')
    expect(metrics.successAt5).toBeGreaterThan(HISTORICAL_SUCCESS_AT_5)
    expect(metrics.byCategory['exact-symbol']?.successAt5).toBe(1)
    expect(metrics.byCategory['package-api']?.successAt5).toBe(1)
    expect(metrics.byCategory['natural-language']?.successAt5).toBeGreaterThan(0)
    expect(metrics.byCategory.indirect?.successAt5).toBeGreaterThan(0)
    expect(metrics.byCategory['no-result']?.noResultCorrectness).toBe(1)
    expect(metrics.forbiddenHitRateAt5).toBeLessThanOrEqual(HISTORICAL_FORBIDDEN_HIT_RATE_AT_5)
  })
})
