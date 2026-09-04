import { describe, expect, it } from 'vitest'

import { createContractSearchIndex } from '../../src/model/contract-search-index.js'
import type { ContractDefinition } from '../../src/protocol/index.js'

const toolsContract: ContractDefinition = {
  id: 'package:tools',
  kind: 'package',
  name: '@deepseek-ai/dsh-tools',
  qualifiedName: 'package:@deepseek-ai/dsh-tools',
  availability: 'unknown',
  summary: 'Tool schema helpers and tool validation.',
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

const otherContract: ContractDefinition = {
  id: 'package:other',
  kind: 'package',
  name: '@deepseek-ai/dsh-other',
  qualifiedName: 'package:@deepseek-ai/dsh-other',
  availability: 'unknown',
  summary: 'Tool runtime support.',
  facts: [
    {
      key: 'declaration-export',
      value: 'OtherRuntime',
      evidenceIds: ['e:other'],
    },
  ],
  evidenceIds: ['e:other'],
}

const contracts: readonly ContractDefinition[] = Object.freeze([toolsContract, otherContract])

describe('ContractSearchIndex derived state', () => {
  it('preserves field and fact boundaries while deriving deterministic postings and document frequency', () => {
    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'a'.repeat(64)}`,
      contracts,
    })

    expect(derived.rankerVersion).toBe('dsh-contract-search-v3-fact-coherence')
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
    const derived = createContractSearchIndex({
      fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      contracts: [toolsContract],
    })

    expect(derived.documentFrequency.get('tool')).toBe(1)
    expect(derived.postings.get('tool')).toHaveLength(1)
  })
})
