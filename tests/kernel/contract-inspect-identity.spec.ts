import { describe, expect, it } from 'vitest'

import { createApplicationKernel, inspectContractResponse } from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

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

function acquiredContracts(): AcquiredContractFacts {
  const manifest: Evidence = {
    id: 'manifest:@deepseek-ai/dsh-subagent',
    kind: 'manifest',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-subagent/package.json',
    contentHash: '3'.repeat(64),
  }
  const declaration: Evidence = {
    id: 'types:@deepseek-ai/dsh-subagent:lib/types/depth.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-subagent/lib/types/depth.d.ts',
    contentHash: '4'.repeat(64),
  }
  const contract: ContractDefinition = {
    id: 'package:@deepseek-ai/dsh-subagent',
    kind: 'package',
    name: '@deepseek-ai/dsh-subagent',
    qualifiedName: 'package:@deepseek-ai/dsh-subagent',
    availability: 'unknown',
    facts: [
      { key: 'version', value: '0.1.1-rc.2', evidenceIds: [manifest.id] },
      { key: 'declaration-export', value: 'assertSubagentMaxDepth', evidenceIds: [declaration.id] },
    ],
    evidenceIds: [manifest.id, declaration.id],
  }
  return { evidence: [manifest, declaration], contracts: [contract] }
}

describe('contract.inspect identity guidance', () => {
  it('identifies provenance evidence ids and points to their inspectable owning contract', async () => {
    const kernel = createApplicationKernel({
      targetAcquisition: { acquire: async () => targetFacts },
      contractAcquisition: { acquire: async () => acquiredContracts() },
      digest: {
        sha256Utf8: async value => value.includes('dsh-contract-index-v1') ? 'b'.repeat(64) : 'a'.repeat(64),
      },
      now: () => '2026-08-30T00:00:00.000Z',
    })

    const response = await inspectContractResponse(kernel, {
      target: { profile: 'web' },
      contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      contractId: 'types:@deepseek-ai/dsh-subagent:lib/types/depth.d.ts',
    }, 'inspect-evidence-id')

    expect(response).toMatchObject({
      status: 'failed',
      diagnostics: [{
        code: 'CONTRACT_NOT_FOUND',
        domain: 'contract',
        summary: expect.stringContaining('Evidence id types:@deepseek-ai/dsh-subagent:lib/types/depth.d.ts is provenance, not a contract id'),
      }],
    })
    expect(response.diagnostics[0]?.summary).toContain('package:@deepseek-ai/dsh-subagent')
    expect(response.diagnostics[0]?.summary).toContain('data.matches[].id')
  })
})
