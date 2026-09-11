import { describe, expect, it } from 'vitest'

import { explainContractSearch } from '../../src/model/contract.js'
import {
  contractSearchCandidateIds,
  createContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'

function requiredIntentMatches(tokenCount: number): number {
  if (tokenCount <= 1) return 1
  if (tokenCount <= 3) return 2
  return 3
}

describe('M2 Contract Search postings selectivity analysis', () => {
  it('measures exact candidate ratios for frozen queries that use the intent lane', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const rows: Array<{
      id: string
      category: string
      queryTokens: number
      requiredMatches: number
      candidates: number
      documents: number
      ratio: number
    }> = []

    for (const task of M2_RETRIEVAL_R1) {
      const explanation = explainContractSearch(index, task.query, undefined, 5, derived)
      if (explanation.lane !== 'intent') continue
      const requiredMatches = requiredIntentMatches(explanation.queryTokens.length)
      const candidates = contractSearchCandidateIds(derived, explanation.queryTokens, requiredMatches).size
      rows.push({
        id: task.id,
        category: task.category,
        queryTokens: explanation.queryTokens.length,
        requiredMatches,
        candidates,
        documents: derived.documentCount,
        ratio: candidates / derived.documentCount,
      })
    }

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.candidates <= row.documents)).toBe(true)

    const ratios = rows.map(row => row.ratio).toSorted((left, right) => left - right)
    const meanRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
    const medianRatio = ratios[Math.floor(ratios.length / 2)] ?? 0
    const maxRatio = ratios.at(-1) ?? 0
    const payload = {
      intentQueries: rows.length,
      documents: derived.documentCount,
      meanRatio,
      medianRatio,
      maxRatio,
      rows,
    }
    console.log(`DSH_POSTINGS_SELECTIVITY ${JSON.stringify(payload)}`)
  })
})
