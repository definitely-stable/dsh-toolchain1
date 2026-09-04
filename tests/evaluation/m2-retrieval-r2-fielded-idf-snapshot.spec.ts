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
  R2_FIELDED_IDF_BASELINE_COMMIT,
  R2_FIELDED_IDF_BASELINE_CORPUS_FINGERPRINT,
  R2_FIELDED_IDF_BASELINE_RANKER_VERSION,
  R2_FIELDED_IDF_BASELINE_RESULTS,
} from './m2-retrieval-r2-fielded-idf-snapshot.js'

describe('Contract Search v3 fact coherence R2 development comparison', () => {
  it('introduces no per-query losses against the frozen fielded-IDF phase baseline', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const corpusFingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)

    expect(R2_FIELDED_IDF_BASELINE_COMMIT).toBe('df1b7f7770fe3c4507fb53cc80ce6b8d5a166f9a')
    expect(R2_FIELDED_IDF_BASELINE_RANKER_VERSION).toBe('dsh-contract-search-v3-fielded-idf')
    expect(corpusFingerprint).toBe(R2_FIELDED_IDF_BASELINE_CORPUS_FINGERPRINT)
    expect(derived.rankerVersion).toBe('dsh-contract-search-v3-fact-coherence')

    const candidateResults = R2_RETRIEVAL_DEV.map(task => Object.freeze({
      taskId: task.id,
      rankedContractIds: Object.freeze(
        searchContractIndex(index, task.query, undefined, 5, derived).matches.map(match => match.id),
      ),
    }))
    const comparisons = compareR2RetrievalResults(
      R2_RETRIEVAL_DEV,
      R2_FIELDED_IDF_BASELINE_RESULTS,
      candidateResults,
    )
    const wins = comparisons.filter(item => item.outcome === 'win')
    const losses = comparisons.filter(item => item.outcome === 'loss')
    const ties = comparisons.filter(item => item.outcome === 'tie')

    console.log(`M2_RETRIEVAL_R2_FACT_COHERENCE_COMPARISON ${JSON.stringify({
      baselineCommit: R2_FIELDED_IDF_BASELINE_COMMIT,
      baselineRankerVersion: R2_FIELDED_IDF_BASELINE_RANKER_VERSION,
      candidateRankerVersion: derived.rankerVersion,
      corpusFingerprint,
      wins: wins.length,
      losses: losses.length,
      ties: ties.length,
      perQuery: comparisons,
    })}`)

    expect(comparisons).toHaveLength(18)
    expect(losses).toEqual([])
    expect(wins.length + ties.length).toBe(18)
  })
})
