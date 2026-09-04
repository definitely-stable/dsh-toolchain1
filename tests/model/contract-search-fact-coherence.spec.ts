import { describe, expect, it } from 'vitest'

import { createContractIndex, explainContractSearch, searchContractIndex } from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const digest: Sha256Port = {
  async sha256Utf8(value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0').repeat(8)
  },
}

const TARGET = `dsh-target-v2:${'e'.repeat(64)}`

function evidence(id: string, digit: string): Evidence {
  return {
    id,
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: digit.repeat(64),
  }
}

const evidenceItems: Evidence[] = [
  evidence('e:coherent', '1'),
  evidence('e:split-anchor', '2'),
  evidence('e:split-beta', '3'),
]

const contracts: ContractDefinition[] = [
  {
    id: 'package:split',
    kind: 'package',
    name: '@fixture/a-anchor-split',
    qualifiedName: 'package:@fixture/a-anchor-split',
    availability: 'unknown',
    summary: 'fixture candidate',
    facts: [
      { key: 'declaration-relation', value: 'anchor', evidenceIds: ['e:split-anchor'] },
      { key: 'declaration-relation', value: 'beta', evidenceIds: ['e:split-beta'] },
    ],
    evidenceIds: ['e:split-anchor', 'e:split-beta'],
  },
  {
    id: 'package:coherent',
    kind: 'package',
    name: '@fixture/z-anchor-coherent',
    qualifiedName: 'package:@fixture/z-anchor-coherent',
    availability: 'unknown',
    summary: 'fixture candidate',
    facts: [
      { key: 'declaration-relation', value: 'anchor beta', evidenceIds: ['e:coherent'] },
    ],
    evidenceIds: ['e:coherent'],
  },
]

describe('Contract Search v3 same-fact coherence', () => {
  it('prefers co-located fact evidence even when one query token is hidden by a stronger identity match', async () => {
    const index = await createContractIndex(TARGET, evidenceItems, contracts, digest)
    const query = 'how anchor beta'

    const result = searchContractIndex(index, query, undefined, 5)
    const explanation = explainContractSearch(index, query, undefined, 5)

    expect(explanation.lane).toBe('intent')
    expect(explanation.results[0]?.terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'anchor', field: 'identity', factIndexes: [] }),
      expect.objectContaining({ token: 'beta', field: 'fact' }),
    ]))
    expect(result.matches[0]?.id).toBe('package:coherent')
    expect(explanation.results[0]?.contractId).toBe('package:coherent')
  })
})
