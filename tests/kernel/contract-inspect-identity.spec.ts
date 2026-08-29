import { describe, expect, it } from 'vitest'

import { createApplicationKernel, inspectContractResponse } from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const evidenceId = 'types:@deepseek-ai/dsh-subagent:lib/types/depth.d.ts'

const targetFacts: AcquiredTargetFacts = {
  dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
  runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
  profile: {
    name: 'web',
    bundles: [],
    dependencies: [{ name: '@deepseek-ai/dsh-subagent', version: '0.1.1-rc.2' }],
    profilePatchHash: '1'.repeat(64),
    homePatchHash: '2'.repeat(64),
    overlayPatchHashes: [],
  },
  evidence: [],
}

function acquiredContracts(contractIds: readonly string[] = ['package:@deepseek-ai/dsh-subagent']): AcquiredContractFacts {
  const declaration: Evidence = {
    id: evidenceId,
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-subagent/lib/types/depth.d.ts',
    contentHash: '4'.repeat(64),
  }
  const contracts: ContractDefinition[] = contractIds.map((id, index) => ({
    id,
    kind: 'package',
    name: id.slice('package:'.length),
    qualifiedName: id,
    availability: 'unknown',
    facts: [{ key: 'declaration-export', value: `symbol${index}`, evidenceIds: [declaration.id] }],
    evidenceIds: [declaration.id],
  }))
  return { evidence: [declaration], contracts }
}

function kernelFor(contracts: AcquiredContractFacts) {
  return createApplicationKernel({
    targetAcquisition: { acquire: async () => targetFacts },
    contractAcquisition: { acquire: async () => contracts },
    digest: {
      sha256Utf8: async value => value.includes('dsh-contract-index-v1') ? 'b'.repeat(64) : 'a'.repeat(64),
    },
    now: () => '2026-08-30T00:00:00.000Z',
  })
}

async function inspectEvidenceId(contracts: AcquiredContractFacts) {
  return inspectContractResponse(kernelFor(contracts), {
    target: { profile: 'web' },
    contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
    contractId: evidenceId,
  }, 'inspect-evidence-id')
}

describe('contract.inspect identity guidance', () => {
  it('identifies provenance evidence ids and points to their inspectable owning contract', async () => {
    const response = await inspectEvidenceId(acquiredContracts())

    expect(response).toMatchObject({
      status: 'failed',
      diagnostics: [{
        code: 'CONTRACT_NOT_FOUND',
        domain: 'contract',
        summary: expect.stringContaining('data.matches[].id'),
        repair: {
          action: 'use-contract-search-match-id',
          contractIds: ['package:@deepseek-ai/dsh-subagent'],
        },
      }],
    })
  })

  it('bounds and sorts repair candidates without accepting an evidence id as an alias', async () => {
    const contractIds = Array.from({ length: 12 }, (_value, index) => `package:@example/owner-${String(index).padStart(2, '0')}`)
    const response = await inspectEvidenceId(acquiredContracts(contractIds.toReversed()))

    expect(response.status).toBe('failed')
    expect(response.diagnostics[0]).toMatchObject({
      code: 'CONTRACT_NOT_FOUND',
      repair: {
        action: 'use-contract-search-match-id',
        contractIds: contractIds.slice(0, 10),
      },
    })
  })
})
