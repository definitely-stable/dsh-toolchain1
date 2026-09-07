import { describe, expect, it, vi } from 'vitest'

import {
  buildMcpServer,
  createPluginVerifyMcpTool,
} from '../../src/frontends/mcp/index.js'
import type { ApplicationKernel } from '../../src/kernel/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const artifactFingerprint = `dsh-plugin-artifact-v1:${'9'.repeat(64)}`

function kernel(): ApplicationKernel {
  return {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => { throw new Error('unused') }),
    verifyPlugin: vi.fn(async () => ({
      snapshotFingerprint: targetFingerprint,
      data: {
        status: 'stale' as const,
        artifactFingerprint,
        targetFingerprint,
        executionPolicy: 'safe' as const,
        checks: [],
        diagnostics: [{
          code: 'VERIFY_TARGET_STALE',
          severity: 'error' as const,
          domain: 'verification',
          summary: 'target changed',
        }],
        cleanup: 'succeeded' as const,
      },
    })),
  }
}

describe('plugin.verify MCP projection', () => {
  it('registers canonical schemas and declares execution side effects', () => {
    const app = kernel()
    const tool = createPluginVerifyMcpTool(app, () => 'plugin-verify-mcp')
    const server = buildMcpServer({ kernel: app, requestId: () => 'plugin-verify-mcp' })

    expect(tool.name).toBe('plugin.verify')
    expect(tool.config.annotations).toEqual({ readOnlyHint: false, idempotentHint: false })
    expect(server.toolInputSchemaJson('plugin.verify')).toMatchObject({
      $ref: '#/$defs/pluginVerifyRequest',
      $defs: expect.objectContaining({ pluginVerifyRequest: expect.any(Object) }),
    })
  })

  it('returns semantic stale as ordinary structured content and delegates the canonical request', async () => {
    const app = kernel()
    const tool = createPluginVerifyMcpTool(app, () => 'plugin-verify-mcp')
    const request = {
      target: { profile: 'web' },
      subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe' as const,
    }

    const result = await tool.callback(request)

    expect(app.verifyPlugin).toHaveBeenCalledWith(request)
    expect(result).not.toHaveProperty('isError', true)
    expect(result.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'plugin-verify-mcp',
      status: 'ok',
      data: { status: 'stale', artifactFingerprint },
    })
    expect(JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null'))
      .toEqual(result.structuredContent)
  })
})
