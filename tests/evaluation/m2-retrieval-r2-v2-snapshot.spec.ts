import { describe, expect, it } from 'vitest'

import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import { searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import { R2_RETRIEVAL_DEV } from './m2-retrieval-r2.js'

describe('Contract Search R2 v2 snapshot capture', () => {
  it('emits the per-query current-v2 ranking before the Phase 3 scorer changes', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    expect(derived.rankerVersion).toBe('dsh-contract-search-v2-intent')

    const results = R2_RETRIEVAL_DEV.map(task => ({
      taskId: task.id,
      rankedContractIds: searchContractIndex(index, task.query, undefined, 5, derived)
        .matches.map(match => match.id),
    }))

    console.log(`M2_RETRIEVAL_R2_V2_PER_QUERY ${JSON.stringify(results)}`)
    expect(results).toHaveLength(18)
  })
})
