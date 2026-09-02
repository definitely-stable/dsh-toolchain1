import { describe, expect, it } from 'vitest'

import * as contractModel from '../../src/model/contract.js'
import type { ContractDefinition } from '../../src/protocol/index.js'

interface DerivedFactShape {
  readonly index: number
  readonly key: string
  readonly value: string
  readonly tokens: readonly string[]
  readonly evidenceIds: readonly string[]
}

interface DerivedDocumentShape {
  readonly contractId: string
  readonly identity: { readonly tokens: readonly string[] }
  readonly facts: readonly DerivedFactShape[]
}

interface DerivedIndexShape {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly documentCount: number
  readonly documents: ReadonlyMap<string, DerivedDocumentShape>
  readonly postings: ReadonlyMap<string, readonly { readonly contractId: string }[]>
  readonly documentFrequency: ReadonlyMap<string, number>
  readonly retainedTokenCount: number
  readonly postingCount: number
}

type ContractModelWithSearchIndex = typeof contractModel & {
  readonly createContractSearchIndex?: (source: {
    readonly fingerprint: string
    readonly contracts: readonly ContractDefinition[]
  }) => DerivedIndexShape
}

const contracts: readonly ContractDefinition[] = Object.freeze([
  Object.freeze({
    id: 'package:tools',
    kind: 'package' as const,
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: 'package:@deepseek-ai/dsh-tools',
    availability: 'unknown' as const,
    summary: 'Tool schema helpers and tool validation.',
    facts: Object.freeze([
      Object.freeze({
        key: 'declaration-export',
        value: 'validateArgs',
        evidenceIds: ['e:validate'] as [string],
      }),
      Object.freeze({
        key: 'declaration-export',
        value: 'ToolSchema',
        evidenceIds: ['e:schema'] as [string],
      }),
    ]),
    evidenceIds: Object.freeze(['e:validate', 'e:schema']),
  }),
  Object.freeze({
    id: 'package:other',
    kind: 'package' as const,
    name: '@deepseek-ai/dsh-other',
    qualifiedName: 'package:@deepseek-ai/dsh-other',
    availability: 'unknown' as const,
    summary: 'Tool runtime support.',
    facts: Object.freeze([
      Object.freeze({
        key: 'declaration-export',
        value: 'OtherRuntime',
        evidenceIds: ['e:other'] as [string],
      }),
    ]),
    evidenceIds: Object.freeze(['e:other']),
  }),
])

function builder() {
  return (contractModel as ContractModelWithSearchIndex).createContractSearchIndex
}

describe('ContractSearchIndex derived state', () => {
  it('preserves field and fact boundaries while deriving deterministic postings and document frequency', () => {
    const createContractSearchIndex = builder()
    expect(typeof createContractSearchIndex).toBe('function')
    if (createContractSearchIndex === undefined) return

    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'a'.repeat(64)}`,
      contracts,
    })

    expect(derived.rankerVersion).toBe('dsh-contract-search-v2-intent')
    expect(derived.contractIndexFingerprint).toBe(`dsh-contract-index-v1:${'a'.repeat(64)}`)
    expect(derived.documentCount).toBe(2)

    const tools = derived.documents.get('package:tools')
    expect(tools).toBeDefined()
    expect(tools?.identity.tokens).toContain('tools')
    expect(tools?.facts).toHaveLength(2)
    expect(tools?.facts[0]).toMatchObject({
      index: 0,
      key: 'declaration-export',
      value: 'validateArgs',
      evidenceIds: ['e:validate'],
    })
    expect(tools?.facts[0]?.tokens).toEqual(expect.arrayContaining(['validate', 'args']))
    expect(tools?.facts[1]).toMatchObject({
      index: 1,
      key: 'declaration-export',
      value: 'ToolSchema',
      evidenceIds: ['e:schema'],
    })

    expect(derived.documentFrequency.get('tool')).toBe(2)
    expect(derived.documentFrequency.get('validate')).toBe(1)
    expect(derived.documentFrequency.get('args')).toBe(1)

    expect(derived.postings.get('tool')?.map(item => item.contractId)).toEqual([
      'package:other',
      'package:tools',
    ])
    expect(derived.postings.get('validate')?.map(item => item.contractId)).toEqual([
      'package:tools',
    ])
    expect(derived.retainedTokenCount).toBeGreaterThan(0)
    expect(derived.postingCount).toBeGreaterThan(0)
  })

  it('counts one document per term even when a token repeats across fields and facts in the same contract', () => {
    const createContractSearchIndex = builder()
    expect(typeof createContractSearchIndex).toBe('function')
    if (createContractSearchIndex === undefined) return

    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      contracts: [contracts[0]!],
    })

    expect(derived.documentFrequency.get('tool')).toBe(1)
    expect(derived.postings.get('tool')).toHaveLength(1)
  })
})
