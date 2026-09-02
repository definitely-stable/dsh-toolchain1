import { describe, expect, it, vi } from 'vitest'

import {
  buildMcpServer,
  createPluginCheckMcpTool,
} from '../../src/frontends/mcp/index.js'
import type { ApplicationKernel } from '../../src/kernel/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`

function kernel(): ApplicationKernel {
  return {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => ({
      snapshotFingerprint: targetFingerprint,
      data: {
        contractIndexFingerprint,
        subjectCompleteness: 'partial' as const,
        ruleset: 'plugin-static-alpha-v1' as const,
        scopeComplete: false as const,
        verdict: 'unproven' as const,
        requirements: [],
        evidence: [],
        candidateCodeExecuted: false as const,
      },
      diagnostics: [{
        code: 'PLUGIN_BUNDLE_PATCH_MISSING',
        severity: 'error' as const,
        domain: 'plugin',
        summary: 'missing patch',
      }],
    })),
  }
}

describe('plugin.check MCP projection', () => {
  it('registers the canonical Protocol request/response schemas as a read-only idempotent tool', () => {
    const app = kernel()
    const tool = createPluginCheckMcpTool(app, () => 'plugin-mcp')
    const server = buildMcpServer({ kernel: app, requestId: () => 'plugin-mcp' })

    expect(tool.name).toBe('plugin.check')
    expect(tool.config.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })
    expect(server.toolInputSchemaJson('plugin.check')).toMatchObject({
      $ref: '#/$defs/pluginCheckRequest',
      $defs: expect.objectContaining({ pluginCheckRequest: expect.any(Object) }),
    })
  })

  it('returns expected broken-plugin findings as semantic structured content rather than MCP transport errors', async () => {
    const app = kernel()
    const tool = createPluginCheckMcpTool(app, () => 'plugin-mcp')
    const request = {
      target: { profile: 'web' },
      subject: { kind: 'directory' as const, path: '/candidate' },
    }

    const result = await tool.callback(request)

    expect(app.checkPlugin).toHaveBeenCalledWith(request)
    expect(result).not.toHaveProperty('isError', true)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'plugin-mcp',
      status: 'ok',
      snapshotFingerprint: targetFingerprint,
      data: {
        verdict: 'unproven',
        subjectCompleteness: 'partial',
        candidateCodeExecuted: false,
      },
      diagnostics: [{ code: 'PLUGIN_BUNDLE_PATCH_MISSING', domain: 'plugin' }],
    })
  })
})
