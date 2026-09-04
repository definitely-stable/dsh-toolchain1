import { describe, expect, it } from 'vitest'

import {
  createContractIndex,
  explainContractSearch,
  searchContractIndex,
} from '../../src/model/contract.js'
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

const TARGET = `dsh-target-v2:${'d'.repeat(64)}`

function evidence(id: string, digit: string): Evidence {
  return {
    id,
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: digit.repeat(64),
  }
}

const evidenceItems: Evidence[] = [
  evidence('e:correct', '1'),
  evidence('e:distractor', '2'),
  evidence('e:bg-1', '3'),
  evidence('e:bg-2', '4'),
  evidence('e:bg-3', '5'),
]

function contract(
  id: string,
  name: string,
  summary: string,
  factValue: string,
  evidenceId: string,
): ContractDefinition {
  return {
    id,
    kind: 'package',
    name,
    qualifiedName: `package:${name}`,
    availability: 'unknown',
    summary,
    facts: [{ key: 'declaration-symbol', value: factValue, evidenceIds: [evidenceId] }],
    evidenceIds: [evidenceId],
  }
}

const contracts: ContractDefinition[] = [
  contract('package:correct', '@fixture/correct', 'common support', 'RareSignal', 'e:correct'),
  contract('package:distractor', '@fixture/common', 'rare support', 'DistractorSignal', 'e:distractor'),
  contract('package:bg-1', '@fixture/background-one', 'common utility', 'BackgroundOne', 'e:bg-1'),
  contract('package:bg-2', '@fixture/background-two', 'common utility', 'BackgroundTwo', 'e:bg-2'),
  contract('package:bg-3', '@fixture/background-three', 'common utility', 'BackgroundThree', 'e:bg-3'),
]

async function index() {
  return createContractIndex(TARGET, evidenceItems, contracts, digest)
}

describe('Contract Search v3 fielded IDF', () => {
  it('lets a rare discriminative fact term outweigh an ubiquitous identity term', async () => {
    const current = await index()
    const query = 'please common rare'

    const result = searchContractIndex(current, query, undefined, 5)
    const explanation = explainContractSearch(current, query, undefined, 5)

    expect(result.matches[0]?.id).toBe('package:correct')
    expect(explanation.lane).toBe('intent')
    expect(explanation.results[0]?.contractId).toBe('package:correct')
    expect(explanation.results[0]?.terms).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: 'common', documentFrequency: 5, field: 'summary' }),
      expect.objectContaining({ token: 'rare', documentFrequency: 2, field: 'fact' }),
    ]))
  })

  it('keeps query term frequency saturated instead of rewarding repetition', async () => {
    const current = await index()
    const once = searchContractIndex(current, 'please common rare', undefined, 5)
    const repeated = searchContractIndex(current, 'please common common common rare rare', undefined, 5)

    expect(repeated.matches).toEqual(once.matches)
  })
})
