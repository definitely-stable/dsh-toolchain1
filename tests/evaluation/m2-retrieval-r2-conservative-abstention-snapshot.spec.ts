import { describe, expect, it } from 'vitest'

import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import { searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  R2_RETRIEVAL_DEV,
  fingerprintR2RetrievalCorpus,
} from './m2-retrieval-r2.js'
import {
  R2_CONSERVATIVE_ABSTENTION_FREEZE_COMMIT,
  R2_CONSERVATIVE_ABSTENTION_FREEZE_CORPUS_FINGERPRINT,
  R2_CONSERVATIVE_ABSTENTION_FREEZE_RANKER_VERSION,
  R2_CONSERVATIVE_ABSTENTION_FREEZE_RESULTS,
} from './m2-retrieval-r2-conservative-abstention-snapshot.js'

describe('Contract Search v3 final development freeze', () => {
  it('keeps the final conservative-abstention R2-dev behavior exactly frozen', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const corpusFingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)

    expect(R2_CONSERVATIVE_ABSTENTION_FREEZE_COMMIT)
      .toBe('7ea5b095ec6730e279195f0d83c3d230e7085c68')
    expect(derived.rankerVersion).toBe(R2_CONSERVATIVE_ABSTENTION_FREEZE_RANKER_VERSION)
    expect(corpusFingerprint).toBe(R2_CONSERVATIVE_ABSTENTION_FREEZE_CORPUS_FINGERPRINT)

    const current = R2_RETRIEVAL_DEV.map(task => Object.freeze({
      taskId: task.id,
      rankedContractIds: Object.freeze(
        searchContractIndex(index, task.query, undefined, 5, derived).matches.map(match => match.id),
      ),
    }))

    expect(current).toEqual(R2_CONSERVATIVE_ABSTENTION_FREEZE_RESULTS)

    let answerableTop1 = 0
    let answerableTop5 = 0
    let noResultCorrect = 0
    let forbiddenHitAt5 = 0
    for (const task of R2_RETRIEVAL_DEV) {
      const ranked = current.find(result => result.taskId === task.id)?.rankedContractIds ?? []
      if (task.expectNoResult === true) {
        if (ranked.length === 0) noResultCorrect += 1
      } else {
        const expected = new Set(task.expectedContractIds)
        if (ranked[0] !== undefined && expected.has(ranked[0])) answerableTop1 += 1
        if (ranked.slice(0, 5).some(id => expected.has(id))) answerableTop5 += 1
      }
      const forbidden = new Set(task.forbiddenContractIds ?? [])
      if (ranked.slice(0, 5).some(id => forbidden.has(id))) forbiddenHitAt5 += 1
    }

    const marker = Object.freeze({
      schema: 'dsh-contract-search-v3-freeze-v1',
      commit: R2_CONSERVATIVE_ABSTENTION_FREEZE_COMMIT,
      rankerVersion: derived.rankerVersion,
      corpusFingerprint,
      answerableTop1,
      answerableTop5,
      noResultCorrect,
      forbiddenHitAt5,
    })
    console.log(`M2_RETRIEVAL_R2_V3_FREEZE ${JSON.stringify(marker)}`)

    expect(answerableTop1).toBe(9)
    expect(answerableTop5).toBe(9)
    expect(noResultCorrect).toBe(5)
    expect(forbiddenHitAt5).toBe(0)
  })
})
