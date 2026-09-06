import { describe, expect, it, vi } from 'vitest'

import {
  buildMcpServer,
  createContractInspectMcpTool,
  createContractSearchMcpTool,
} from '../../src/frontends/mcp/index.js'
import {
  createApplicationKernel,
  type ApplicationKernel,
} from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import { serializeContractInspectModelResponse } from '../../src/model/contract-inspect-compact.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractInspectResponse } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`

function mockKernel(): ApplicationKernel {
  return {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('target resolve is not used by contract MCP tests') }),
    searchContracts: vi.fn(async () => ({
      snapshotFingerprint: targetFingerprint,
      data: {
        contractIndexFingerprint,
        matches: [{
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package' as const,
          name: '@deepseek-ai/dsh-tools',
          qualifiedName: 'package:@deepseek-ai/dsh-tools',
          availability: 'unknown' as const,
          score: 200,
          evidenceIds: ['manifest:tools'],
        }],
        evidence: [],
      },
    })),
    inspectContract: vi.fn(async () => ({
      snapshotFingerprint: targetFingerprint,
      data: {
        contractIndexFingerprint,
        contract: {
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package' as const,
          name: '@deepseek-ai/dsh-tools',
          qualifiedName: 'package:@deepseek-ai/dsh-tools',
          availability: 'unknown' as const,
          facts: [{
            key: 'version',
            value: '0.1.1-rc.2',
            evidenceIds: ['manifest:tools'] as [string],
          }],
          evidenceIds: ['manifest:tools'],
        },
        evidence: [{
          id: 'manifest:tools',
          kind: 'manifest' as const,
          strength: 'authoritative' as const,
          source: '@deepseek-ai/dsh-tools/package.json',
          contentHash: '3'.repeat(64),
        }],
      },
    })),
    checkPlugin: vi.fn(async () => { throw new Error('plugin check is not used by contract MCP tests') }),
  }
}

function staleKernel(): ApplicationKernel {
  const targetFacts: AcquiredTargetFacts = {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: '1'.repeat(64),
      homePatchHash: '2'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
  }
  const contractFacts: AcquiredContractFacts = {
    evidence: [{
      id: 'manifest:dsh',
      kind: 'manifest',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh/package.json',
      contentHash: '3'.repeat(64),
    }],
    contracts: [{
      id: 'package:@deepseek-ai/dsh',
      kind: 'package',
      name: '@deepseek-ai/dsh',
      qualifiedName: 'package:@deepseek-ai/dsh',
      availability: 'unknown',
      facts: [{ key: 'version', value: '0.1.1-rc.2', evidenceIds: ['manifest:dsh'] }],
      evidenceIds: ['manifest:dsh'],
    }],
  }

  return createApplicationKernel({
    targetAcquisition: { acquire: async () => targetFacts },
    contractAcquisition: { acquire: async () => contractFacts },
    digest: {
      sha256Utf8: async value => value.includes('dsh-contract-index-v1')
        ? 'b'.repeat(64)
        : 'a'.repeat(64),
    },
    now: () => '2026-08-27T00:00:00.000Z',
  })
}

describe('Contract Intelligence MCP projection', () => {
  it('registers contract.search and contract.inspect with Protocol-owned schemas', () => {
    const server = buildMcpServer({ kernel: mockKernel(), requestId: () => 'mcp-contract' })

    expect(server.toolInputSchemaJson('contract.search')).toMatchObject({
      $ref: '#/$defs/contractSearchRequest',
      $defs: expect.objectContaining({ contractSearchRequest: expect.any(Object) }),
    })
    expect(server.toolInputSchemaJson('contract.inspect')).toMatchObject({
      $ref: '#/$defs/contractInspectRequest',
      $defs: expect.objectContaining({ contractInspectRequest: expect.any(Object) }),
    })
  })

  it('makes the search-to-inspect identity handoff explicit in MCP descriptions and Protocol schema', () => {
    const kernel = mockKernel()
    const search = createContractSearchMcpTool(kernel)
    const inspect = createContractInspectMcpTool(kernel)
    const server = buildMcpServer({ kernel, requestId: () => 'mcp-contract-id-guidance' })
    const inspectSchema = server.toolInputSchemaJson('contract.inspect') as {
      $defs?: Record<string, { properties?: Record<string, { description?: string }> }>
    }

    expect(search.config.description).toContain('data.matches[].id')
    expect(search.config.description).toContain('provenance')
    expect(inspect.config.description).toContain('data.matches[].id')
    expect(inspect.config.description).toContain('evidence')
    expect(inspectSchema.$defs?.contractInspectRequest?.properties?.contractId?.description)
      .toContain('data.matches[].id')
    expect(inspectSchema.$defs?.contractReference?.properties?.id?.description)
      .toContain('Inspectable contract identifier')
    expect(inspectSchema.$defs?.evidence?.properties?.id?.description)
      .toContain('Provenance evidence identifier')
  })

  it('defines contract.search as read-only/idempotent and delegates canonical requests', async () => {
    const kernel = mockKernel()
    const tool = createContractSearchMcpTool(kernel, () => 'mcp-search')

    expect(tool.name).toBe('contract.search')
    expect(tool.config.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })

    const request = { target: { profile: 'web' }, query: 'ToolDefinition', kinds: ['package' as const], limit: 5 }
    const result = await tool.callback(request)

    expect(kernel.searchContracts).toHaveBeenCalledWith(request)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-search',
      snapshotFingerprint: targetFingerprint,
      status: 'ok',
      data: { contractIndexFingerprint },
    })
    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null'))
      .toEqual(result.structuredContent)
  })

  it('keeps canonical structuredContent while using the non-regressing Inspect serializer for text', async () => {
    const kernel = mockKernel()
    const tool = createContractInspectMcpTool(kernel, () => 'mcp-inspect')
    const request = {
      target: { profile: 'web' },
      contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    }

    expect(tool.name).toBe('contract.inspect')
    expect(tool.config.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })

    const result = await tool.callback(request)

    expect(kernel.inspectContract).toHaveBeenCalledWith(request)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-inspect',
      snapshotFingerprint: targetFingerprint,
      status: 'ok',
      data: {
        contractIndexFingerprint,
        contract: {
          id: 'package:@deepseek-ai/dsh-tools',
          evidenceIds: ['manifest:tools'],
        },
        evidence: [{ id: 'manifest:tools' }],
      },
    })

    const canonical = result.structuredContent as ContractInspectResponse
    const renderedText = result.content[0]?.type === 'text' ? result.content[0].text : ''
    expect(renderedText).toBe(serializeContractInspectModelResponse(canonical))
    expect(JSON.parse(renderedText)).toMatchObject({
      representation: 'dsh-contract-inspect-compact-v1',
      requestId: canonical.requestId,
      snapshotFingerprint: targetFingerprint,
    })
    expect(new TextEncoder().encode(renderedText).byteLength)
      .toBeLessThan(new TextEncoder().encode(JSON.stringify(canonical)).byteLength)
  })

  it('returns stale contract indexes as canonical semantic Protocol results rather than MCP transport errors', async () => {
    const tool = createContractInspectMcpTool(staleKernel(), () => 'mcp-stale')

    const result = await tool.callback({
      target: { profile: 'web' },
      contractIndexFingerprint: `dsh-contract-index-v1:${'9'.repeat(64)}`,
      contractId: 'package:@deepseek-ai/dsh',
    })

    expect(result).not.toHaveProperty('isError', true)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-stale',
      snapshotFingerprint: targetFingerprint,
      status: 'stale',
      diagnostics: [{ code: 'CONTRACT_INDEX_STALE', domain: 'contract' }],
    })
    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null'))
      .toEqual(result.structuredContent)
  })
})
