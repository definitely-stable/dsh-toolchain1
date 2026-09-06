import { describe, expect, it, vi } from 'vitest'

import {
  createPluginVerifyToolDefinition,
  PLUGIN_VERIFY_TOOL_NAME,
} from '../../src/integrations/dsh/plugin-verify-tool.js'
import type { PluginVerifyResponse } from '../../src/protocol/index.js'

function response(): PluginVerifyResponse {
  const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
  return {
    protocolVersion: '1',
    requestId: 'native-verify',
    snapshotFingerprint: targetFingerprint,
    status: 'ok',
    data: {
      status: 'verified',
      artifactFingerprint: `dsh-plugin-artifact-v1:${'9'.repeat(64)}`,
      targetFingerprint,
      executionPolicy: 'safe',
      checks: [],
      diagnostics: [],
      cleanup: 'succeeded',
    },
    diagnostics: [],
  }
}

describe('native DSH plugin verify tool', () => {
  it('uses the canonical parser and explicitly exposes isolated candidate execution', async () => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginVerifyToolDefinition(resolve)
    const request = {
      target: { profile: 'web' },
      subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe' as const,
    }

    expect(tool.name).toBe(PLUGIN_VERIFY_TOOL_NAME)
    expect(tool.name).toBe('toolchain_plugin_verify')
    expect(tool.description).toContain('executes candidate')
    expect(tool.description).toContain('isolated')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['target', 'subject', 'executionPolicy'],
    })

    await expect(tool.execute(request)).resolves.toEqual(response())
    expect(resolve).toHaveBeenCalledWith(request)
  })

  it.each([
    { target: { profile: 'web' }, subject: { kind: 'directory', path: '/candidate' }, executionPolicy: 'safe' },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/candidate.tgz' }, executionPolicy: 'trusted' },
    { target: { profile: 'web' }, subject: { kind: 'packed', path: '/candidate.tgz' }, executionPolicy: 'safe', extra: true },
  ])('rejects unsupported request %# before invoking the resolver', value => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginVerifyToolDefinition(resolve)

    expect(() => tool.execute(value)).toThrow(TypeError)
    expect(resolve).not.toHaveBeenCalled()
  })
})
