import { describe, expect, it } from 'vitest'

import {
  contractSearchCandidatesForRanking,
  createContractSearchIndex,
  searchTokens,
} from '../../src/model/contract-search-index.js'
import type { ContractDefinition } from '../../src/protocol/index.js'

function contract(id: string, summary: string): ContractDefinition {
  return {
    id,
    kind: 'service',
    name: id,
    qualifiedName: `adaptive.${id}`,
    availability: 'available',
    summary,
    facts: [],
    evidenceIds: [],
  }
}

const contracts: readonly ContractDefinition[] = Object.freeze([
  contract('target', 'common alpha beta rare target'),
  ...Array.from({ length: 7 }, (_, index) => contract(`other-${index}`, 'common alpha beta')),
])

function derived() {
  return createContractSearchIndex({
    fingerprint: `dsh-contract-index-v1:${'d'.repeat(64)}`,
    contracts,
  })
}

describe('adaptive Contract Search candidate pruning', () => {
  it('uses exact candidates when the postings cost model predicts selective pruning', () => {
    const result = contractSearchCandidatesForRanking(
      derived(),
      contracts,
      searchTokens('rare target common missing'),
      2,
    )

    expect(result.map(contract => contract.id)).toEqual(['target'])
  })

  it('keeps the original full list when postings are dense and cannot repay their scan cost', () => {
    const result = contractSearchCandidatesForRanking(
      derived(),
      contracts,
      searchTokens('common alpha beta missing'),
      2,
    )

    expect(result).toBe(contracts)
  })
})
