import { describe, expect, it, vi } from 'vitest'

import {
  createPluginVerifyToolDefinition,
  PLUGIN_VERIFY_TOOL_NAME,
} from '../../src/integrations/dsh/plugin-verify-tool.js'
import type { PluginVerifyResponse } from '../../src/protocol/index.js'
import { stubTargetBinding } from '../support/tool-target-binding.js'

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
      contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
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
    const tool = createPluginVerifyToolDefinition(resolve, stubTargetBinding())
    const args = {
      profile: 'web',
      subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe' as const,
      visibilityAssertions: [{ kind: 'host-service' as const, name: 'exampleService' }],
    }

    expect(tool.name).toBe(PLUGIN_VERIFY_TOOL_NAME)
    expect(tool.name).toBe('toolchain_plugin_verify')
    expect(tool.description).toContain('executes candidate')
    expect(tool.description).toContain('isolated')
    expect(tool.description).toContain('Agent Tool')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'executionPolicy'],
      properties: {
        profile: expect.objectContaining({ type: 'string' }),
        visibilityAssertions: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'name'],
            properties: {
              kind: { enum: ['host-service', 'agent-tool'] },
              name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
            },
          },
        },
      },
    })

    await expect(tool.execute(args)).resolves.toEqual(response())
    expect(resolve).toHaveBeenCalledWith({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe',
      visibilityAssertions: [{ kind: 'host-service', name: 'exampleService' }],
    })
  })

  it('passes Agent Tool assertions through the canonical parser unchanged', async () => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginVerifyToolDefinition(resolve, stubTargetBinding())
    const args = {
      profile: 'web',
      subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe' as const,
      visibilityAssertions: [
        { kind: 'host-service' as const, name: 'shared-name' },
        { kind: 'agent-tool' as const, name: 'shared-name' },
      ],
    }

    await expect(tool.execute(args)).resolves.toEqual(response())
    expect(resolve).toHaveBeenCalledWith({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe',
      visibilityAssertions: [
        { kind: 'host-service', name: 'shared-name' },
        { kind: 'agent-tool', name: 'shared-name' },
      ],
    })
  })

  it.each([
    { profile: 'web', subject: { kind: 'directory', path: '/candidate' }, executionPolicy: 'safe' },
    { profile: 'web', subject: { kind: 'packed', path: '/candidate.tgz' }, executionPolicy: 'trusted' },
    { profile: 'web', subject: { kind: 'packed', path: '/candidate.tgz' }, executionPolicy: 'safe', extra: true },
    {
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate.tgz' },
      executionPolicy: 'safe',
    },
  ])('rejects unsupported request %# before invoking the resolver', async value => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginVerifyToolDefinition(resolve, stubTargetBinding())

    await expect(Promise.resolve().then(() => tool.execute(value))).rejects.toThrow(TypeError)
    expect(resolve).not.toHaveBeenCalled()
  })
})
