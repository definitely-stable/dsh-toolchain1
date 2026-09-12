import { describe, expect, it } from 'vitest'

import {
  contractSearchCandidateIds,
  createContractSearchIndex,
  searchTokens,
} from '../../src/model/contract-search-index.js'
import type { ContractDefinition } from '../../src/protocol/index.js'

function contract(id: string, summary: string): ContractDefinition {
  return {
    id,
    kind: 'service',
    name: id,
    qualifiedName: `perf.${id}`,
    availability: 'available',
    summary,
    facts: [],
    evidenceIds: [],
  }
}

const contracts: readonly ContractDefinition[] = Object.freeze([
  contract('alpha', 'session lifecycle checkpoint storage'),
  contract('beta', 'session lifecycle query search'),
  contract('gamma', 'session approval policy risk'),
  contract('delta', 'subagent lifecycle scheduling'),
])

function exhaustiveCandidateIds(
  derived: ReturnType<typeof createContractSearchIndex>,
  queryTokens: readonly string[],
  requiredMatches: number,
): readonly string[] {
  const distinct = [...new Set(queryTokens)]
  return [...derived.documents.values()]
    .filter(document => {
      const tokens = new Set([
        ...document.identity.tokens,
        ...document.summary.tokens,
        ...document.kind.tokens,
        ...document.facts.flatMap(fact => fact.tokens),
      ])
      return distinct.filter(token => tokens.has(token)).length >= requiredMatches
    })
    .map(document => document.contractId)
    .toSorted()
}

describe('Contract Search postings candidates', () => {
  it.each([
    { query: 'session lifecycle', required: 2 },
    { query: 'session lifecycle checkpoint', required: 3 },
    { query: 'session policy nonexistent', required: 2 },
    { query: 'subagent lifecycle', required: 1 },
    { query: 'completely absent tokens', required: 1 },
  ])('matches exhaustive distinct-token eligibility for "$query"', ({ query, required }) => {
    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'a'.repeat(64)}`,
      contracts,
    })
    const tokens = searchTokens(query)

    expect([...contractSearchCandidateIds(derived, tokens, required)].toSorted())
      .toEqual(exhaustiveCandidateIds(derived, tokens, required))
  })

  it('counts duplicate query tokens once', () => {
    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      contracts,
    })

    expect([...contractSearchCandidateIds(derived, ['session', 'session', 'checkpoint'], 2)].toSorted())
      .toEqual(['alpha'])
  })

  it('fails closed for invalid match thresholds', () => {
    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'c'.repeat(64)}`,
      contracts,
    })

    expect(() => contractSearchCandidateIds(derived, ['session'], 0)).toThrow(/requiredMatches/)
    expect(() => contractSearchCandidateIds(derived, ['session'], 2)).not.toThrow()
  })
})
