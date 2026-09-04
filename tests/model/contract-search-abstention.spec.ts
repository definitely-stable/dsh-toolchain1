import { describe, expect, it } from 'vitest'

import { createContractIndex, searchContractIndex } from '../../src/model/contract.js'
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

const TARGET = `dsh-target-v2:${'f'.repeat(64)}`
const evidence: Evidence[] = [
  {
    id: 'e:tools',
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: '1'.repeat(64),
  },
]
const contract: ContractDefinition = {
  id: 'package:@fixture/dsh-tools',
  kind: 'package',
  name: '@fixture/dsh-tools',
  qualifiedName: 'package:@fixture/dsh-tools',
  availability: 'available',
  summary: 'Tool definition helpers',
  facts: [
    { key: 'declaration-export', value: 'defineTool', evidenceIds: ['e:tools'] },
    { key: 'declaration-export', value: 'validateArgs', evidenceIds: ['e:tools'] },
  ],
  evidenceIds: ['e:tools'],
}

describe('Contract Search v3 conservative abstention', () => {
  it('abstains when an exact package anchor is followed by an unsupported API-shaped identifier', async () => {
    const index = await createContractIndex(TARGET, evidence, [contract], digest)
    const selection = searchContractIndex(
      index,
      '@fixture/dsh-tools defineToolGraphVNext from a later release',
      undefined,
      5,
    )

    expect(selection.matches).toEqual([])
    expect(selection.evidence).toEqual([])
  })

  it('keeps a package-qualified API lookup when that identifier is supported by the package facts', async () => {
    const index = await createContractIndex(TARGET, evidence, [contract], digest)
    const selection = searchContractIndex(index, '@fixture/dsh-tools defineTool', undefined, 5)

    expect(selection.matches[0]?.id).toBe(contract.id)
  })

  it('does not reinterpret a plain exact identifier lookup as an abstention request', async () => {
    const index = await createContractIndex(TARGET, evidence, [contract], digest)
    const selection = searchContractIndex(index, 'defineTool', undefined, 5)

    expect(selection.matches[0]?.id).toBe(contract.id)
  })
})
