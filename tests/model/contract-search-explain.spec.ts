import { describe, expect, it } from 'vitest'

import * as contractModel from '../../src/model/contract.js'
import type { ContractIndex } from '../../src/model/contract.js'
import {
  createContractSearchIndex,
  type ContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import type { ContractKind } from '../../src/protocol/index.js'

type SearchLane = 'strict' | 'intent' | 'none'
type SearchField = 'identity' | 'fact' | 'summary' | 'kind'

interface TermExplanation {
  readonly token: string
  readonly documentFrequency: number
  readonly field: SearchField
  readonly factIndexes: readonly number[]
  readonly evidenceIds: readonly string[]
}

interface ResultExplanation {
  readonly contractId: string
  readonly score: number
  readonly terms: readonly TermExplanation[]
}

interface SearchExplanation {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly query: string
  readonly queryTokens: readonly string[]
  readonly lane: SearchLane
  readonly results: readonly ResultExplanation[]
}

type ExplainContractSearch = (
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit?: number,
  derived?: ContractSearchIndex,
) => SearchExplanation

function explainContractSearch(
  index: ContractIndex,
  query: string,
  derived?: ContractSearchIndex,
): SearchExplanation {
  const candidate = (contractModel as unknown as {
    readonly explainContractSearch?: ExplainContractSearch
  }).explainContractSearch
  expect(typeof candidate).toBe('function')
  return candidate!(index, query, undefined, 5, derived)
}

function fixtureIndex(): ContractIndex {
  return Object.freeze({
    targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
    evidence: Object.freeze([
      Object.freeze({
        id: 'e:validate',
        kind: 'type-declaration' as const,
        strength: 'authoritative' as const,
        source: '@deepseek-ai/dsh-tools/index.d.ts',
        contentHash: '1'.repeat(64),
        location: '/fixture/dsh-tools/index.d.ts',
      }),
      Object.freeze({
        id: 'e:schema',
        kind: 'type-declaration' as const,
        strength: 'authoritative' as const,
        source: '@deepseek-ai/dsh-tools/index.d.ts',
        contentHash: '2'.repeat(64),
        location: '/fixture/dsh-tools/index.d.ts',
      }),
    ]),
    contracts: Object.freeze([
      Object.freeze({
        id: 'symbol:ToolDefinition',
        kind: 'symbol' as const,
        name: 'ToolDefinition',
        qualifiedName: '@deepseek-ai/dsh-tools.ToolDefinition',
        availability: 'available' as const,
        summary: 'Tool schema helpers',
        facts: Object.freeze([
          Object.freeze({
            key: 'declaration-export',
            value: 'validateArgs',
            evidenceIds: Object.freeze(['e:validate']),
          }),
          Object.freeze({
            key: 'declaration-export',
            value: 'ToolSchema',
            evidenceIds: Object.freeze(['e:schema']),
          }),
        ]),
        evidenceIds: Object.freeze(['e:validate', 'e:schema']),
      }),
    ]),
  })
}

describe('Contract Search internal explanation', () => {
  it('explains an exact strict result without fabricating term evidence', () => {
    const index = fixtureIndex()
    const derived = createContractSearchIndex(index)
    const search = contractModel.searchContractIndex(index, 'ToolDefinition', undefined, 5, derived)
    const explanation = explainContractSearch(index, 'ToolDefinition', derived)

    expect(explanation.lane).toBe('strict')
    expect(explanation.contractIndexFingerprint).toBe(index.fingerprint)
    expect(explanation.results).toEqual([
      {
        contractId: search.matches[0]!.id,
        score: search.matches[0]!.score,
        terms: [],
      },
    ])
  })

  it('explains intent terms with document frequency, fact boundaries, and evidence', () => {
    const index = fixtureIndex()
    const derived = createContractSearchIndex(index)
    const explanation = explainContractSearch(index, 'how validate args schema', derived)

    expect(explanation.lane).toBe('intent')
    expect(explanation.queryTokens).toEqual(['args', 'schema', 'validate'])
    expect(explanation.results).toEqual([
      {
        contractId: 'symbol:ToolDefinition',
        score: 155,
        terms: [
          {
            token: 'args',
            documentFrequency: 1,
            field: 'fact',
            factIndexes: [0],
            evidenceIds: ['e:validate'],
          },
          {
            token: 'schema',
            documentFrequency: 1,
            field: 'fact',
            factIndexes: [1],
            evidenceIds: ['e:schema'],
          },
          {
            token: 'validate',
            documentFrequency: 1,
            field: 'fact',
            factIndexes: [0],
            evidenceIds: ['e:validate'],
          },
        ],
      },
    ])
  })

  it('reports none for a genuine multi-word intent query with no candidate', () => {
    const index = fixtureIndex()
    const derived = createContractSearchIndex(index)
    const explanation = explainContractSearch(index, 'how fictional impossible symbol', derived)

    expect(explanation.lane).toBe('none')
    expect(explanation.results).toEqual([])
  })
})
