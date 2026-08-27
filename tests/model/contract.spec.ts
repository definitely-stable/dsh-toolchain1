import { describe, expect, it } from 'vitest'
import {
  canonicalizeContractIndexProjection,
  createContractIndex,
  inspectContractIndex,
  searchContractIndex,
  type ContractIndex,
} from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { ContractDefinition, ContractFact, Evidence } from '../../src/protocol/index.js'

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

const TARGET = `dsh-target-v2:${'a'.repeat(64)}`

function baseEvidence(): Evidence[] {
  return [
    {
      id: 'types:tools:index.d.ts',
      kind: 'type-declaration',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-tools/index.d.ts',
      contentHash: '2'.repeat(64),
      location: '/one/node_modules/@deepseek-ai/dsh-tools/index.d.ts',
    },
    {
      id: 'manifest:tools',
      kind: 'manifest',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-tools/package.json',
      contentHash: '1'.repeat(64),
      location: '/one/node_modules/@deepseek-ai/dsh-tools/package.json',
    },
    {
      id: 'manifest:agent',
      kind: 'manifest',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-agent/package.json',
      contentHash: '3'.repeat(64),
      location: '/one/node_modules/@deepseek-ai/dsh-agent/package.json',
    },
  ]
}

function baseContracts(): ContractDefinition[] {
  return [
    {
      id: 'package:@deepseek-ai/dsh-tools',
      kind: 'package',
      name: '@deepseek-ai/dsh-tools',
      qualifiedName: 'package:@deepseek-ai/dsh-tools',
      availability: 'unknown',
      summary: 'Installed package @deepseek-ai/dsh-tools@0.1.1-rc.2',
      facts: [
        { key: 'declaration-symbol', value: 'ToolDefinition', evidenceIds: ['types:tools:index.d.ts'] },
        { key: 'version', value: '0.1.1-rc.2', evidenceIds: ['manifest:tools'] },
      ],
      evidenceIds: ['types:tools:index.d.ts', 'manifest:tools'],
    },
    {
      id: 'package:@deepseek-ai/dsh-agent',
      kind: 'package',
      name: '@deepseek-ai/dsh-agent',
      qualifiedName: 'package:@deepseek-ai/dsh-agent',
      availability: 'unknown',
      summary: 'Installed package @deepseek-ai/dsh-agent@0.1.1-rc.2',
      facts: [
        { key: 'version', value: '0.1.1-rc.2', evidenceIds: ['manifest:agent'] },
      ],
      evidenceIds: ['manifest:agent'],
    },
  ]
}

async function makeIndex(
  evidence: readonly Evidence[] = baseEvidence(),
  contracts: readonly ContractDefinition[] = baseContracts(),
  targetFingerprint = TARGET,
): Promise<ContractIndex> {
  return createContractIndex(targetFingerprint, evidence, contracts, digest)
}

describe('ContractIndex', () => {
  it('is canonical across input order and machine evidence locations', async () => {
    const left = await makeIndex()
    const relocated = baseEvidence().toReversed().map(item => ({
      ...item,
      location: `C:\\Users\\test\\${item.id.replaceAll(':', '-')}`,
    }))
    const reorderedContracts = baseContracts().toReversed().map(contract => ({
      ...contract,
      facts: contract.facts.toReversed(),
      evidenceIds: contract.evidenceIds.toReversed(),
    }))
    const right = await makeIndex(relocated, reorderedContracts)

    expect(right.fingerprint).toBe(left.fingerprint)
    expect(canonicalizeContractIndexProjection(right)).toBe(canonicalizeContractIndexProjection(left))
    expect(left.fingerprint).toMatch(/^dsh-contract-index-v1:[0-9a-f]{64}$/)
  })

  it('changes identity for target, consumed evidence bytes, or normalized contract semantics', async () => {
    const baseline = (await makeIndex()).fingerprint

    const targetChanged = await makeIndex(baseEvidence(), baseContracts(), `dsh-target-v2:${'b'.repeat(64)}`)
    expect(targetChanged.fingerprint).not.toBe(baseline)

    const evidenceChanged = baseEvidence().map(item =>
      item.id === 'types:tools:index.d.ts' ? { ...item, contentHash: '9'.repeat(64) } : item,
    )
    expect((await makeIndex(evidenceChanged)).fingerprint).not.toBe(baseline)

    const semanticsChanged = baseContracts().map(contract =>
      contract.id === 'package:@deepseek-ai/dsh-tools'
        ? { ...contract, availability: 'available' as const }
        : contract,
    )
    expect((await makeIndex(baseEvidence(), semanticsChanged)).fingerprint).not.toBe(baseline)
  })

  it('deep-freezes every hashed contract semantic collection after fingerprint creation', async () => {
    const index = await makeIndex()
    const contract = index.contracts[0]
    const fact = contract?.facts[0]
    expect(contract).toBeDefined()
    expect(fact).toBeDefined()

    expect(Object.isFrozen(index)).toBe(true)
    expect(Object.isFrozen(index.contracts)).toBe(true)
    expect(Object.isFrozen(contract)).toBe(true)
    expect(Object.isFrozen(contract?.facts)).toBe(true)
    expect(Object.isFrozen(fact)).toBe(true)
    expect(Object.isFrozen(fact?.evidenceIds)).toBe(true)
    expect(Object.isFrozen(contract?.evidenceIds)).toBe(true)

    expect(() => {
      (index.contracts as unknown as ContractDefinition[]).push(baseContracts()[0]!)
    }).toThrow(TypeError)
    expect(() => {
      (contract!.facts as unknown as ContractFact[]).push({
        key: 'mutation',
        value: 'forbidden',
        evidenceIds: ['manifest:tools'],
      })
    }).toThrow(TypeError)
    expect(() => {
      (fact!.evidenceIds as unknown as string[]).push('manifest:agent')
    }).toThrow(TypeError)
    expect(() => {
      (contract!.evidenceIds as unknown as string[]).push('manifest:agent')
    }).toThrow(TypeError)
  })

  it('rejects normalized facts without supporting evidence', async () => {
    const contracts = baseContracts().map(contract =>
      contract.id === 'package:@deepseek-ai/dsh-tools'
        ? {
            ...contract,
            facts: [
              ...contract.facts,
              { key: 'unsupported', value: 'claim', evidenceIds: [] },
            ],
          }
        : contract,
    )

    await expect(makeIndex(baseEvidence(), contracts)).rejects.toThrow(
      'must reference at least one evidence id',
    )
  })

  it('ranks exact, prefix and fact matches deterministically and returns compact references', async () => {
    const contracts: ContractDefinition[] = [
      {
        id: 'package:tool-exact',
        kind: 'package',
        name: 'tool',
        qualifiedName: 'package:tool-exact',
        availability: 'unknown',
        facts: [],
        evidenceIds: ['manifest:tools'],
      },
      {
        id: 'package:tool-prefix',
        kind: 'package',
        name: 'toolbox',
        qualifiedName: 'package:tool-prefix',
        availability: 'unknown',
        facts: [],
        evidenceIds: ['manifest:tools'],
      },
      {
        id: 'package:fact-match',
        kind: 'package',
        name: 'runtime-api',
        qualifiedName: 'package:runtime-api',
        availability: 'unknown',
        facts: [{ key: 'declaration-symbol', value: 'ToolFactory', evidenceIds: ['types:tools:index.d.ts'] }],
        evidenceIds: ['types:tools:index.d.ts'],
      },
    ]
    const index = await makeIndex(baseEvidence(), contracts)

    const result = searchContractIndex(index, 'tool')

    expect(result.matches.map(match => [match.id, match.score])).toEqual([
      ['package:tool-exact', 550],
      ['package:tool-prefix', 500],
      ['package:fact-match', 200],
    ])
    expect(result.matches[0]).toEqual({
      id: 'package:tool-exact',
      kind: 'package',
      name: 'tool',
      qualifiedName: 'package:tool-exact',
      availability: 'unknown',
      score: 550,
      evidenceIds: ['manifest:tools'],
    })
    expect(result.evidence.map(item => item.id)).toEqual([
      'manifest:tools',
      'types:tools:index.d.ts',
    ])
  })

  it('supports multi-token name matching, kind filters, limits and stable lexical ties', async () => {
    const contracts: ContractDefinition[] = [
      {
        id: 'service:zeta',
        kind: 'service',
        name: 'Agent Runtime Service',
        qualifiedName: 'service:zeta',
        availability: 'available',
        facts: [],
        evidenceIds: ['manifest:agent'],
      },
      {
        id: 'service:alpha',
        kind: 'service',
        name: 'Agent Runtime Service',
        qualifiedName: 'service:alpha',
        availability: 'available',
        facts: [],
        evidenceIds: ['manifest:agent'],
      },
      {
        id: 'package:agent-runtime',
        kind: 'package',
        name: 'Agent Runtime Service Package',
        qualifiedName: 'package:agent-runtime',
        availability: 'unknown',
        facts: [],
        evidenceIds: ['manifest:agent'],
      },
    ]
    const index = await makeIndex(baseEvidence(), contracts)

    expect(searchContractIndex(index, 'agent service', ['service'], 1).matches.map(match => match.id)).toEqual([
      'service:alpha',
    ])
    expect(searchContractIndex(index, 'agent service', ['package']).matches.map(match => match.id)).toEqual([
      'package:agent-runtime',
    ])
  })

  it('inspects one exact definition and returns only the evidence it references', async () => {
    const index = await makeIndex()

    const selected = inspectContractIndex(index, 'package:@deepseek-ai/dsh-tools')

    expect(selected?.contract.id).toBe('package:@deepseek-ai/dsh-tools')
    expect(selected?.evidence.map(item => item.id)).toEqual([
      'manifest:tools',
      'types:tools:index.d.ts',
    ])
    expect(inspectContractIndex(index, 'package:missing')).toBeUndefined()
  })

  it('rejects a digest implementation that does not return lowercase SHA-256 hex', async () => {
    const invalidDigest: Sha256Port = { sha256Utf8: async () => 'bad-hash' }

    await expect(
      createContractIndex(TARGET, baseEvidence(), baseContracts(), invalidDigest),
    ).rejects.toThrow('64 lowercase hexadecimal')
  })
})
