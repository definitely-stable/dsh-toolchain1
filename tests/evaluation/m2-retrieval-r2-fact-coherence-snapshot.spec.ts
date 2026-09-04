import { describe, expect, it } from 'vitest'

import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import { searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import { compareR2RetrievalResults } from './m2-retrieval-r2-comparison.js'
import {
  R2_RETRIEVAL_DEV,
  fingerprintR2RetrievalCorpus,
} from './m2-retrieval-r2.js'
import {
  R2_FACT_COHERENCE_BASELINE_COMMIT,
  R2_FACT_COHERENCE_BASELINE_CORPUS_FINGERPRINT,
  R2_FACT_COHERENCE_BASELINE_RANKER_VERSION,
  R2_FACT_COHERENCE_BASELINE_RESULTS,
} from './m2-retrieval-r2-fact-coherence-snapshot.js'

describe('Contract Search v3 abstention immediate-prior baseline', () => {
  it('matches the frozen fact-coherence per-query baseline before abstention changes', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const corpusFingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)

    expect(R2_FACT_COHERENCE_BASELINE_COMMIT).toBe('803d8e219d05f794bf980e9b11a2fa3a390bc41f')
    expect(R2_FACT_COHERENCE_BASELINE_RANKER_VERSION).toBe('dsh-contract-search-v3-fact-coherence')
    expect(corpusFingerprint).toBe(R2_FACT_COHERENCE_BASELINE_CORPUS_FINGERPRINT)
    expect(derived.rankerVersion).toBe(R2_FACT_COHERENCE_BASELINE_RANKER_VERSION)

    const current = R2_RETRIEVAL_DEV.map(task => Object.freeze({
      taskId: task.id,
      rankedContractIds: Object.freeze(
        searchContractIndex(index, task.query, undefined, 5, derived).matches.map(match => match.id),
      ),
    }))
    const comparisons = compareR2RetrievalResults(
      R2_RETRIEVAL_DEV,
      R2_FACT_COHERENCE_BASELINE_RESULTS,
      current,
    )

    expect(comparisons).toHaveLength(18)
    expect(comparisons.every(item => item.outcome === 'tie')).toBe(true)
  })
})
