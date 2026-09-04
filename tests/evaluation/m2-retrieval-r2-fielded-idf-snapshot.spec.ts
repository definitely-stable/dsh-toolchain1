import { describe, expect, it } from 'vitest'

import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import { searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
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

describe('Contract Search fielded IDF phase baseline', () => {
  it('binds the frozen per-query snapshot to the exact production ranker and R2-dev corpus before coherence changes', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const corpusFingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)

    expect(R2_FIELDED_IDF_BASELINE_COMMIT).toBe('df1b7f7770fe3c4507fb53cc80ce6b8d5a166f9a')
    expect(derived.rankerVersion).toBe(R2_FIELDED_IDF_BASELINE_RANKER_VERSION)
    expect(corpusFingerprint).toBe(R2_FIELDED_IDF_BASELINE_CORPUS_FINGERPRINT)

    const current = R2_RETRIEVAL_DEV.map(task => Object.freeze({
      taskId: task.id,
      rankedContractIds: Object.freeze(
        searchContractIndex(index, task.query, undefined, 5, derived).matches.map(match => match.id),
      ),
    }))

    expect(current).toEqual(R2_FIELDED_IDF_BASELINE_RESULTS)
  })
})
