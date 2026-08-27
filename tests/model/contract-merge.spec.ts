import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  ContractAcquisitionError,
  createContractIndex,
  mergeAcquiredContractFacts,
  type AcquiredContractFacts,
} from '../../src/model/contract.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const digest = createNodeSha256Port()
const TARGET = `dsh-target-v2:${'a'.repeat(64)}`

function offlineEvidence(): Evidence {
  return {
    id: 'types:toolchain:index.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: 'dsh-toolchain/index.d.ts',
    contentHash: '1'.repeat(64),
  }
}

function runtimeEvidence(contentHash = '2'.repeat(64)): Evidence {
  return {
    id: 'runtime:cordis-inspect:host:Tool:listTools',
    kind: 'runtime',
    strength: 'observed',
    source: 'cordis-inspect:host/Tool/listTools',
    contentHash,
  }
}

function offlineTool(): ContractDefinition {
  return {
    id: 'tool:host:toolchain_target_resolve',
    kind: 'tool',
    name: 'toolchain_target_resolve',
    qualifiedName: 'tool:toolchain_target_resolve',
    availability: 'unknown',
    summary: 'Resolve the exact installed DSH target.',
    facts: [{
      key: 'declared-shape',
      value: 'TargetResolveRequest -> TargetResolveResponse',
      evidenceIds: ['types:toolchain:index.d.ts'],
    }],
    evidenceIds: ['types:toolchain:index.d.ts'],
  }
}

function liveTool(schema = '{"type":"object"}'): ContractDefinition {
  return {
    id: 'tool:host:toolchain_target_resolve',
    kind: 'tool',
    name: 'toolchain_target_resolve',
    qualifiedName: 'tool:toolchain_target_resolve',
    availability: 'available',
    summary: 'Resolve the exact installed DSH target.',
    facts: [{
      key: 'parameters-schema',
      value: schema,
      evidenceIds: ['runtime:cordis-inspect:host:Tool:listTools'],
    }],
    evidenceIds: ['runtime:cordis-inspect:host:Tool:listTools'],
  }
}

function acquired(
  evidence: readonly Evidence[],
  contracts: readonly ContractDefinition[],
): AcquiredContractFacts {
  return { evidence, contracts }
}

async function indexOf(facts: AcquiredContractFacts): Promise<string> {
  return (await createContractIndex(TARGET, facts.evidence, facts.contracts, digest)).fingerprint
}

describe('offline + live Contract merge invariants', () => {
  it('preserves offline facts and upgrades availability only on positive live proof', () => {
    const merged = mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence()], [liveTool()]),
    )

    expect(merged.contracts).toHaveLength(1)
    expect(merged.contracts[0]).toMatchObject({
      id: 'tool:host:toolchain_target_resolve',
      availability: 'available',
    })
    expect(merged.contracts[0]?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'declared-shape' }),
      expect.objectContaining({ key: 'parameters-schema' }),
    ]))
    expect(merged.contracts[0]?.evidenceIds).toEqual([
      'runtime:cordis-inspect:host:Tool:listTools',
      'types:toolchain:index.d.ts',
    ])
  })

  it('keeps availability unknown when neither source positively proves liveness', () => {
    const catalogContract: ContractDefinition = {
      ...offlineTool(),
      availability: 'unknown',
      facts: [{
        key: 'catalog-signature',
        value: 'resolveTarget(request): Promise<TargetResolveResponse>',
        evidenceIds: ['runtime:cordis-inspect:host:Tool:listTools'],
      }],
      evidenceIds: ['runtime:cordis-inspect:host:Tool:listTools'],
    }

    const merged = mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence()], [catalogContract]),
    )
    expect(merged.contracts[0]?.availability).toBe('unknown')
  })

  it('fails closed on contradictory positive availability or contract identity', () => {
    const unavailable: ContractDefinition = { ...liveTool(), availability: 'unavailable' }
    expect(() => mergeAcquiredContractFacts(
      acquired([offlineEvidence(), runtimeEvidence()], [liveTool()]),
      acquired([], [unavailable]),
    )).toThrow(ContractAcquisitionError)

    const conflictingIdentity: ContractDefinition = {
      ...liveTool(),
      qualifiedName: 'tool:different_identity',
    }
    expect(() => mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence()], [conflictingIdentity]),
    )).toThrow(/conflicting declared\/live identity fields/i)
  })

  it('fails closed when one evidence id is reused for different observed bytes', () => {
    expect(() => mergeAcquiredContractFacts(
      acquired([runtimeEvidence('2'.repeat(64))], []),
      acquired([runtimeEvidence('3'.repeat(64))], []),
    )).toThrow(/evidence id .* conflicting contents/i)
  })

  it('produces a stable index for equal semantics regardless of merge/input order', async () => {
    const left = mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence()], [liveTool()]),
    )
    const right = mergeAcquiredContractFacts(
      acquired([runtimeEvidence()], [liveTool()]),
      acquired([offlineEvidence()], [offlineTool()]),
    )

    await expect(indexOf(left)).resolves.toBe(await indexOf(right))
  })

  it('changes the Contract Index when the Agent-visible live Tool semantics drift', async () => {
    const baseline = mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence('2'.repeat(64))], [liveTool('{"type":"object"}')]),
    )
    const drifted = mergeAcquiredContractFacts(
      acquired([offlineEvidence()], [offlineTool()]),
      acquired([runtimeEvidence('3'.repeat(64))], [liveTool('{"type":"object","required":["profile"]}')]),
    )

    expect(await indexOf(drifted)).not.toBe(await indexOf(baseline))
  })
})
