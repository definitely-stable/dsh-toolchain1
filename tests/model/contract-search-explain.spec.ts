import { describe, expect, it } from 'vitest'

import * as contractModel from '../../src/model/contract.js'
import type { ContractIndex } from '../../src/model/contract.js'
import {
  createContractSearchIndex,
  type ContractSearchIndex,
} from '../../src/model/contract-search-index.js'
import type { ContractDefinition, ContractKind, Evidence } from '../../src/protocol/index.js'

type SearchLane = 'strict' | 'intent' | 'none'
type SearchField = 'identity' | 'fact' | 'summary' | 'kind'

interface TermExplanation {
  readonly token: string
  readonly documentFrequency: number
  readonly inverseDocumentFrequency: number
  readonly field: SearchField
  readonly fieldWeight: number
  readonly contribution: number
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
  const evidence: Evidence[] = [
    {
      id: 'e:validate',
      kind: 'type-declaration',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-tools/index.d.ts',
      contentHash: '1'.repeat(64),
      location: '/fixture/dsh-tools/index.d.ts',
    },
    {
      id: 'e:schema',
      kind: 'type-declaration',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-tools/index.d.ts',
      contentHash: '2'.repeat(64),
      location: '/fixture/dsh-tools/index.d.ts',
    },
  ]
  const contract: ContractDefinition = {
    id: 'package:tool-definition',
    kind: 'package',
    name: 'ToolDefinition',
    qualifiedName: '@deepseek-ai/dsh-tools.ToolDefinition',
    availability: 'available',
    summary: 'Tool schema helpers',
    facts: [
      {
        key: 'declaration-export',
        value: 'validateArgs',
        evidenceIds: ['e:validate'],
      },
      {
        key: 'declaration-export',
        value: 'ToolSchema',
        evidenceIds: ['e:schema'],
      },
    ],
    evidenceIds: ['e:validate', 'e:schema'],
  }
  return {
    targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
    evidence,
    contracts: [contract],
  }
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

  it('explains intent terms with deterministic IDF, field weights, fact boundaries, and evidence', () => {
    const index = fixtureIndex()
    const derived = createContractSearchIndex(index)
    const explanation = explainContractSearch(index, 'how validate args schema', derived)

    expect(explanation.lane).toBe('intent')
    expect(explanation.queryTokens).toEqual(['args', 'schema', 'validate'])
    expect(explanation.results).toEqual([
      {
        contractId: 'package:tool-definition',
        score: 310,
        terms: [
          {
            token: 'args',
            documentFrequency: 1,
            inverseDocumentFrequency: 0.287682,
            field: 'fact',
            fieldWeight: 3,
            contribution: 0.863046,
            factIndexes: [0],
            evidenceIds: ['e:validate'],
          },
          {
            token: 'schema',
            documentFrequency: 1,
            inverseDocumentFrequency: 0.287682,
            field: 'fact',
            fieldWeight: 3,
            contribution: 0.863046,
            factIndexes: [1],
            evidenceIds: ['e:schema'],
          },
          {
            token: 'validate',
            documentFrequency: 1,
            inverseDocumentFrequency: 0.287682,
            field: 'fact',
            fieldWeight: 3,
            contribution: 0.863046,
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
