import { describe, expect, it } from 'vitest'

import {
  searchContractIndex,
  type ContractIndex,
  type ContractSearchSelection,
} from '../../src/model/contract.js'
import {
  createContractSearchIndex,
  type ContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import type { ContractKind } from '../../src/protocol/index.js'
import { M2_RETRIEVAL_R1 } from '../evaluation/m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from '../evaluation/m2-retrieval-index.js'

type SearchWithDerived = (
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit?: number,
  derived?: ContractSearchIndex,
) => ContractSearchSelection

const searchWithDerived = searchContractIndex as unknown as SearchWithDerived

describe('Contract Search derived-index integration', () => {
  it('preserves the exact v2 result and evidence projection for every frozen R1 query', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)

    for (const task of M2_RETRIEVAL_R1) {
      const cold = searchContractIndex(index, task.query, undefined, 5)
      const warm = searchWithDerived(index, task.query, undefined, 5, derived)
      expect(warm, task.id).toEqual(cold)
    }
  })

  it('fails closed when a caller supplies derived state for a different ContractIndex fingerprint', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const wrong = {
      ...derived,
      contractIndexFingerprint: `dsh-contract-index-v1:${'f'.repeat(64)}`,
    } as ContractSearchIndex

    expect(() => searchWithDerived(index, 'ToolDefinition', undefined, 5, wrong))
      .toThrow(/ContractSearchIndex fingerprint mismatch/)
  })

  it('fails closed when a caller supplies derived state from another ranker version', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)
    const wrong = {
      ...derived,
      rankerVersion: 'dsh-contract-search-v999-test',
    } as ContractSearchIndex

    expect(() => searchWithDerived(index, 'ToolDefinition', undefined, 5, wrong))
      .toThrow(/ContractSearchIndex ranker version mismatch/)
  })
})
