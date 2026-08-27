import { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'

import {
  buildMcpServer,
  createTargetResolveMcpTool,
  launchMcpStdio,
} from '../../src/frontends/mcp/index.js'
import type { ApplicationKernel } from '../../src/kernel/index.js'
import { TargetAcquisitionError } from '../../src/model/target.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const fingerprint = `dsh-target-v2:${'a'.repeat(64)}`

function snapshot(): TargetSnapshot {
  return {
    fingerprint,
    createdAt: '2026-08-27T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
  }
}

function unusedContractMethods(): Pick<ApplicationKernel, 'searchContracts' | 'inspectContract'> {
  return {
    searchContracts: vi.fn(async () => {
      throw new Error('contract search is not used by target-only MCP tests')
    }),
    inspectContract: vi.fn(async () => {
      throw new Error('contract inspect is not used by target-only MCP tests')
    }),
  }
}

function successKernel(): ApplicationKernel {
  return {
    describe: () => ({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    }),
    resolveTarget: vi.fn(async () => ({ snapshot: snapshot() })),
    ...unusedContractMethods(),
  }
}

function failureKernel(): ApplicationKernel {
  return {
    describe: () => ({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    }),
    resolveTarget: vi.fn(async () => {
      throw new TargetAcquisitionError(
        'TARGET_PROFILE_NOT_FOUND',
        'DSH profile was not found',
        ['/tmp/dsh/profiles/missing/package.json'],
      )
    }),
    ...unusedContractMethods(),
  }
}

describe('MCP frontend', () => {
  it('builds a fresh MCP server from the shared product identity and registers Protocol-owned target input', () => {
    const first = buildMcpServer({
      kernel: successKernel(),
      requestId: () => 'mcp-request-1',
    })
    const second = buildMcpServer({
      kernel: successKernel(),
      requestId: () => 'mcp-request-2',
    })

    expect(first).toBeInstanceOf(McpServer)
    expect(second).toBeInstanceOf(McpServer)
    expect(second).not.toBe(first)
    expect(first.toolInputSchemaJson('target.resolve')).toMatchObject({
      $ref: '#/$defs/targetResolveRequest',
      $defs: expect.objectContaining({ targetResolveRequest: expect.any(Object) }),
    })
  })

  it('defines target.resolve as read-only/idempotent and returns Protocol success as structured content', async () => {
    const kernel = successKernel()
    const tool = createTargetResolveMcpTool(kernel, () => 'mcp-success')

    expect(tool.name).toBe('target.resolve')
    expect(tool.config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    })

    const result = await tool.callback({ profile: 'web' })

    expect(kernel.resolveTarget).toHaveBeenCalledWith({ profile: 'web' })
    expect(result).not.toHaveProperty('isError', true)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-success',
      status: 'ok',
      snapshotFingerprint: fingerprint,
    })
    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null'))
      .toEqual(result.structuredContent)
  })

  it('returns expected target acquisition defects as semantic failed Protocol results, not MCP errors', async () => {
    const tool = createTargetResolveMcpTool(failureKernel(), () => 'mcp-failure')

    const result = await tool.callback({ profile: 'missing' })

    expect(result).not.toHaveProperty('isError', true)
    expect(result.structuredContent).toEqual({
      protocolVersion: '1',
      requestId: 'mcp-failure',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
        summary: 'DSH profile was not found',
        locations: ['/tmp/dsh/profiles/missing/package.json'],
      }],
    })
  })

  it('delegates stdio ownership to serveStdio with a fresh-server factory', () => {
    const servers: McpServer[] = []
    const handle = { close: vi.fn(async () => undefined) }
    const serve = vi.fn((factory: () => McpServer) => {
      servers.push(factory(), factory())
      return handle
    })

    expect(launchMcpStdio(serve)).toBe(handle)
    expect(serve).toHaveBeenCalledOnce()
    expect(servers).toHaveLength(2)
    expect(servers[0]).not.toBe(servers[1])
  })
})
