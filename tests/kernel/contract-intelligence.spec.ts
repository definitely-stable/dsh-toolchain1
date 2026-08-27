import { describe, expect, it } from 'vitest'

import {
  createApplicationKernel,
  inspectContractResponse,
  searchContractsResponse,
} from '../../src/kernel/index.js'
import {
  ContractAcquisitionError,
  type AcquiredContractFacts,
  type ContractAcquisitionPort,
} from '../../src/model/contract.js'
import { TargetAcquisitionError, type AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const targetFacts: AcquiredTargetFacts = {
  dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
  runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
  profile: {
    name: 'web',
    bundles: [],
    dependencies: [{ name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' }],
    profilePatchHash: '1'.repeat(64),
    homePatchHash: '2'.repeat(64),
    overlayPatchHashes: [],
  },
  evidence: [],
}

function contractFacts(symbol = 'ToolDefinition'): AcquiredContractFacts {
  const manifest: Evidence = {
    id: 'manifest:tools',
    kind: 'manifest',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/package.json',
    contentHash: '3'.repeat(64),
  }
  const types: Evidence = {
    id: 'types:tools:index.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/index.d.ts',
    contentHash: symbol === 'ToolDefinition' ? '4'.repeat(64) : '5'.repeat(64),
  }
  const contract: ContractDefinition = {
    id: 'package:@deepseek-ai/dsh-tools',
    kind: 'package',
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: 'package:@deepseek-ai/dsh-tools',
    availability: 'unknown',
    summary: 'Installed package @deepseek-ai/dsh-tools@0.1.1-rc.2',
    facts: [
      { key: 'version', value: '0.1.1-rc.2', evidenceIds: [manifest.id] },
      { key: 'declaration-symbol', value: symbol, evidenceIds: [types.id] },
    ],
    evidenceIds: [manifest.id, types.id],
  }
  return { evidence: [manifest, types], contracts: [contract] }
}

function createKernel(contractAcquisition: ContractAcquisitionPort) {
  return createApplicationKernel({
    targetAcquisition: { acquire: async () => targetFacts },
    contractAcquisition,
    digest: {
      sha256Utf8: async value => value.includes('dsh-contract-index-v1') ? 'b'.repeat(64) : 'a'.repeat(64),
    },
    now: () => '2026-08-27T00:00:00.000Z',
  })
}

describe('Contract Intelligence kernel', () => {
  it('searches one exact target-bound index and returns compact evidence-backed matches', async () => {
    const kernel = createKernel({ acquire: async () => contractFacts() })

    const outcome = await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition' })

    expect(outcome.snapshotFingerprint).toBe(`dsh-target-v2:${'a'.repeat(64)}`)
    expect(outcome.data.contractIndexFingerprint).toBe(`dsh-contract-index-v1:${'b'.repeat(64)}`)
    expect(outcome.data.matches).toEqual([
      expect.objectContaining({ id: 'package:@deepseek-ai/dsh-tools', score: 200 }),
    ])
    expect(outcome.data.evidence.map(item => item.id)).toEqual([
      'manifest:tools',
      'types:tools:index.d.ts',
    ])
  })

  it('rebuilds the current index for inspect and distinguishes stale from not-found', async () => {
    let current = contractFacts()
    const kernel = createKernel({ acquire: async () => current })
    const search = await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition' })

    const selected = await kernel.inspectContract({
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    })
    expect(selected.data.contract.id).toBe('package:@deepseek-ai/dsh-tools')

    await expect(kernel.inspectContract({
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:missing',
    })).rejects.toMatchObject({ code: 'CONTRACT_NOT_FOUND' })

    current = contractFacts('DifferentSymbol')
    await expect(kernel.inspectContract({
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    })).rejects.toMatchObject({ code: 'CONTRACT_INDEX_STALE' })
  })

  it('maps target, contract acquisition and stale index failures once in shared Protocol responses', async () => {
    const targetFailure = createApplicationKernel({
      targetAcquisition: {
        acquire: async () => {
          throw new TargetAcquisitionError('TARGET_PROFILE_NOT_FOUND', 'missing profile', ['/profiles/missing'])
        },
      },
      contractAcquisition: { acquire: async () => contractFacts() },
      digest: { sha256Utf8: async () => 'a'.repeat(64) },
    })
    await expect(searchContractsResponse(
      targetFailure,
      { target: { profile: 'missing' }, query: 'tool' },
      'search-target-fail',
    )).resolves.toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'TARGET_PROFILE_NOT_FOUND', domain: 'target' }],
    })

    const contractStale = createKernel({
      acquire: async () => {
        throw new ContractAcquisitionError(
          'CONTRACT_EVIDENCE_STALE',
          'manifest changed',
          ['/packages/tools/package.json'],
        )
      },
    })
    await expect(searchContractsResponse(
      contractStale,
      { target: { profile: 'web' }, query: 'tool' },
      'search-stale',
    )).resolves.toMatchObject({
      status: 'stale',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      diagnostics: [{ code: 'CONTRACT_EVIDENCE_STALE', domain: 'contract' }],
    })

    const kernel = createKernel({ acquire: async () => contractFacts() })
    await expect(inspectContractResponse(
      kernel,
      {
        target: { profile: 'web' },
        contractIndexFingerprint: `dsh-contract-index-v1:${'9'.repeat(64)}`,
        contractId: 'package:@deepseek-ai/dsh-tools',
      },
      'inspect-stale',
    )).resolves.toMatchObject({
      status: 'stale',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      diagnostics: [{ code: 'CONTRACT_INDEX_STALE', domain: 'contract' }],
    })
  })

  it('propagates unexpected contract infrastructure failures', async () => {
    const kernel = createKernel({ acquire: async () => { throw new Error('filesystem exploded') } })

    await expect(searchContractsResponse(
      kernel,
      { target: { profile: 'web' }, query: 'tool' },
      'infra-fail',
    )).rejects.toThrow('filesystem exploded')
  })
})
