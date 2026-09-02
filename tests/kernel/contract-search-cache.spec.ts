import { describe, expect, it } from 'vitest'

import {
  createApplicationKernel,
  type ApplicationKernel,
  type ApplicationKernelOptions,
} from '../../src/kernel/index.js'
import {
  createContractSearchIndex,
  type ContractSearchIndex,
  type ContractSearchIndexSource,
} from '../../src/model/contract-search-index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
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

function contractFacts(symbol: string): AcquiredContractFacts {
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
    contentHash: symbol.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/gu, 'a'),
  }
  const contract: ContractDefinition = {
    id: 'package:@deepseek-ai/dsh-tools',
    kind: 'package',
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: 'package:@deepseek-ai/dsh-tools',
    availability: 'unknown',
    summary: 'Installed tool package',
    facts: [
      { key: 'version', value: '0.1.1-rc.2', evidenceIds: [manifest.id] },
      { key: 'declaration-export', value: symbol, evidenceIds: [types.id] },
    ],
    evidenceIds: [manifest.id, types.id],
  }
  return { evidence: [manifest, types], contracts: [contract] }
}

type SearchIndexFactory = (source: ContractSearchIndexSource) => ContractSearchIndex

type OptionsWithSearchIndexFactory = ApplicationKernelOptions & {
  readonly createContractSearchIndex?: SearchIndexFactory
}

const createKernelWithFactory = createApplicationKernel as unknown as (
  options: OptionsWithSearchIndexFactory,
) => ApplicationKernel

function createCountingKernel(current: () => AcquiredContractFacts): {
  readonly kernel: ApplicationKernel
  readonly buildCount: () => number
} {
  let builds = 0
  const kernel = createKernelWithFactory({
    targetAcquisition: { acquire: async () => targetFacts },
    contractAcquisition: { acquire: async () => current() },
    digest: {
      sha256Utf8: async value => {
        if (!value.includes('dsh-contract-index-v1')) return 'a'.repeat(64)
        const match = /ToolDefinition([0-9]+)/u.exec(value)
        const ordinal = Number.parseInt(match?.[1] ?? '0', 10) + 1
        return ordinal.toString(16).padStart(64, '0')
      },
    },
    now: () => '2026-09-02T00:00:00.000Z',
    createContractSearchIndex: source => {
      builds += 1
      return createContractSearchIndex(source)
    },
  })
  return Object.freeze({ kernel, buildCount: () => builds })
}

describe('Contract Search kernel derived-index cache', () => {
  it('reuses derived state across fresh ContractIndex objects with the same semantic fingerprint', async () => {
    let current = contractFacts('ToolDefinition0')
    const { kernel, buildCount } = createCountingKernel(() => current)

    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition0' })
    current = contractFacts('ToolDefinition0')
    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition0' })

    expect(buildCount()).toBe(1)
  })

  it('builds new derived state when the ContractIndex fingerprint changes', async () => {
    let current = contractFacts('ToolDefinition0')
    const { kernel, buildCount } = createCountingKernel(() => current)

    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition0' })
    current = contractFacts('ToolDefinition1')
    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition1' })

    expect(buildCount()).toBe(2)
  })

  it('keeps exactly eight insertion-ordered entries and does not refresh age on cache hits', async () => {
    let current = contractFacts('ToolDefinition0')
    const { kernel, buildCount } = createCountingKernel(() => current)

    for (let ordinal = 0; ordinal < 8; ordinal += 1) {
      current = contractFacts(`ToolDefinition${ordinal}`)
      await kernel.searchContracts({ target: { profile: 'web' }, query: `ToolDefinition${ordinal}` })
    }
    expect(buildCount()).toBe(8)

    current = contractFacts('ToolDefinition0')
    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition0' })
    expect(buildCount()).toBe(8)

    current = contractFacts('ToolDefinition8')
    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition8' })
    expect(buildCount()).toBe(9)

    current = contractFacts('ToolDefinition0')
    await kernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition0' })
    expect(buildCount()).toBe(10)
  })
})
