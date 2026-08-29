import { describe, expect, it } from 'vitest'

import {
  buildMcpServer,
  createContractInspectMcpTool,
  createContractSearchMcpTool,
} from '../../src/frontends/mcp/index.js'
import {
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import {
  createApplicationKernel,
  inspectContractResponse,
  type ApplicationKernel,
} from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractInspectResponse, ContractSearchResponse } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
const contractId = 'package:@deepseek-ai/dsh-tools'
const evidenceId = 'types:@deepseek-ai/dsh-tools:index.d.ts'

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

const contractFacts: AcquiredContractFacts = {
  evidence: [{
    id: evidenceId,
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-tools/index.d.ts',
    contentHash: '3'.repeat(64),
  }],
  contracts: [{
    id: contractId,
    kind: 'package',
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: contractId,
    availability: 'unknown',
    facts: [{ key: 'declaration-export', value: 'ToolDefinition', evidenceIds: [evidenceId] }],
    evidenceIds: [evidenceId],
  }],
}

function kernel(): ApplicationKernel {
  return createApplicationKernel({
    targetAcquisition: { acquire: async () => targetFacts },
    contractAcquisition: { acquire: async () => contractFacts },
    digest: {
      sha256Utf8: async value => value.includes('dsh-contract-index-v1')
        ? 'b'.repeat(64)
        : 'a'.repeat(64),
    },
    now: () => '2026-08-29T00:00:00.000Z',
  })
}

function searchResponse(): ContractSearchResponse {
  return {
    protocolVersion: '1',
    requestId: 'search',
    snapshotFingerprint: targetFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      matches: [{
        id: contractId,
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: contractId,
        availability: 'unknown',
        score: 200,
        evidenceIds: [evidenceId],
      }],
      evidence: contractFacts.evidence,
    },
    diagnostics: [],
  }
}

function inspectResponse(): ContractInspectResponse {
  return {
    protocolVersion: '1',
    requestId: 'inspect',
    snapshotFingerprint: targetFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      contract: contractFacts.contracts[0]!,
      evidence: contractFacts.evidence,
    },
    diagnostics: [],
  }
}

describe('contract search-to-inspect id handoff', () => {
  it('makes the inspectable match id explicit on native DSH and MCP agent surfaces', () => {
    const nativeSearch = createContractSearchToolDefinition(async () => searchResponse())
    const nativeInspect = createContractInspectToolDefinition(async () => inspectResponse())
    expect(nativeSearch.description).toContain('data.matches[].id')
    expect(nativeInspect.description).toContain('data.matches[].id')
    expect(nativeInspect.parameters).toMatchObject({
      properties: {
        contractId: {
          description: expect.stringContaining('data.matches[].id'),
        },
      },
    })

    const currentKernel = kernel()
    const mcpSearch = createContractSearchMcpTool(currentKernel, () => 'search')
    const mcpInspect = createContractInspectMcpTool(currentKernel, () => 'inspect')
    expect(mcpSearch.config.description).toContain('data.matches[].id')
    expect(mcpInspect.config.description).toContain('data.matches[].id')

    const server = buildMcpServer({ kernel: currentKernel, requestId: () => 'schema' })
    const inspectSchema = server.toolInputSchemaJson('contract.inspect') as {
      $defs?: Record<string, any>
    }
    expect(inspectSchema.$defs?.contractInspectRequest?.properties?.contractId?.description)
      .toContain('data.matches[].id')
    expect(inspectSchema.$defs?.contractReference?.properties?.id?.description)
      .toContain('inspectable')
    expect(inspectSchema.$defs?.evidence?.properties?.id?.description)
      .toContain('provenance')
  })

  it('keeps evidence ids invalid for inspect but returns deterministic recovery guidance', async () => {
    const currentKernel = kernel()
    const search = await currentKernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition' })
    expect(search.data.matches[0]?.id).toBe(contractId)
    expect(search.data.evidence[0]?.id).toBe(evidenceId)

    const response = await inspectContractResponse(currentKernel, {
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: evidenceId,
    }, 'wrong-id-kind')

    expect(response).toMatchObject({
      status: 'failed',
      diagnostics: [{
        code: 'CONTRACT_NOT_FOUND',
        domain: 'contract',
        summary: expect.stringMatching(/evidence id.*data\.matches\[\]\.id/i),
        repair: {
          action: 'use-contract-search-match-id',
          contractIds: [contractId],
        },
      }],
    })
  })

  it('does not invent repair candidates for an actually unknown contract id', async () => {
    const currentKernel = kernel()
    const search = await currentKernel.searchContracts({ target: { profile: 'web' }, query: 'ToolDefinition' })
    const response = await inspectContractResponse(currentKernel, {
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:missing',
    }, 'unknown-id')

    expect(response).toMatchObject({
      status: 'failed',
      diagnostics: [{ code: 'CONTRACT_NOT_FOUND' }],
    })
    expect(response.diagnostics[0]).not.toHaveProperty('repair')
  })
})
