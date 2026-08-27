import { describe, expect, it } from 'vitest'
import { createContractIndex, inspectContractIndex, searchContractIndex } from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const digest: Sha256Port = {
  async sha256Utf8() {
    return 'a'.repeat(64)
  },
}

const evidence: Evidence[] = [
  {
    id: 'manifest:tools',
    kind: 'manifest',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/package.json',
    contentHash: '1'.repeat(64),
  },
  {
    id: 'types:tools:a.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/a.d.ts',
    contentHash: '2'.repeat(64),
  },
  {
    id: 'types:tools:b.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/b.d.ts',
    contentHash: '3'.repeat(64),
  },
]

const contracts: ContractDefinition[] = [{
  id: 'package:@deepseek-ai/dsh-tools',
  kind: 'package',
  name: '@deepseek-ai/dsh-tools',
  qualifiedName: 'package:@deepseek-ai/dsh-tools',
  availability: 'unknown',
  summary: 'Installed package @deepseek-ai/dsh-tools@0.1.1-rc.2',
  facts: [
    { key: 'declaration-export', value: 'ToolFactory', evidenceIds: ['types:tools:a.d.ts'] },
    { key: 'declaration-export', value: 'OtherExport', evidenceIds: ['types:tools:b.d.ts'] },
    { key: 'version', value: '0.1.1-rc.2', evidenceIds: ['manifest:tools'] },
  ],
  evidenceIds: ['manifest:tools', 'types:tools:a.d.ts', 'types:tools:b.d.ts'],
}]

describe('Contract search evidence witnesses', () => {
  it('returns one deterministic existence witness for an exact name match', async () => {
    const index = await createContractIndex(
      `dsh-target-v2:${'b'.repeat(64)}`,
      evidence,
      contracts,
      digest,
    )

    const result = searchContractIndex(index, '@deepseek-ai/dsh-tools')

    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]?.evidenceIds).toEqual(['manifest:tools'])
    expect(result.evidence.map(item => item.id)).toEqual(['manifest:tools'])
  })

  it('returns only evidence supporting the matching fact while inspect remains complete', async () => {
    const index = await createContractIndex(
      `dsh-target-v2:${'b'.repeat(64)}`,
      evidence,
      contracts,
      digest,
    )

    const search = searchContractIndex(index, 'ToolFactory')
    const inspect = inspectContractIndex(index, 'package:@deepseek-ai/dsh-tools')

    expect(search.matches[0]?.evidenceIds).toEqual(['types:tools:a.d.ts'])
    expect(search.evidence.map(item => item.id)).toEqual(['types:tools:a.d.ts'])
    expect(inspect?.evidence.map(item => item.id)).toEqual([
      'manifest:tools',
      'types:tools:a.d.ts',
      'types:tools:b.d.ts',
    ])
  })
})
