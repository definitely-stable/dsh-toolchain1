import { describe, expect, it, vi } from 'vitest'

import {
  createPluginCheckToolDefinition,
  PLUGIN_CHECK_TOOL_NAME,
} from '../../src/integrations/dsh/plugin-check-tool.js'
import type { PluginCheckResponse } from '../../src/protocol/index.js'

function response(): PluginCheckResponse {
  return {
    protocolVersion: '1',
    requestId: 'native-plugin',
    snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    status: 'ok',
    data: {
      contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      subjectCompleteness: 'complete',
      ruleset: 'plugin-static-alpha-v1',
      scopeComplete: false,
      verdict: 'compatible-in-scope',
      requirements: [],
      evidence: [],
      candidateCodeExecuted: false,
    },
    diagnostics: [],
  }
}

describe('native DSH plugin check tool', () => {
  it('uses the canonical request parser and exposes one static read-only check operation', async () => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginCheckToolDefinition(resolve)
    const request = {
      target: { profile: 'web' },
      subject: { kind: 'directory' as const, path: '/candidate' },
    }

    expect(tool.name).toBe(PLUGIN_CHECK_TOOL_NAME)
    expect(tool.name).toBe('toolchain_plugin_check')
    expect(tool.description).toContain('static')
    expect(tool.description).not.toContain('verify')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['target', 'subject'],
    })

    await expect(tool.execute(request)).resolves.toEqual(response())
    expect(resolve).toHaveBeenCalledWith(request)
  })

  it('rejects unknown request keys before invoking the service resolver', () => {
    const resolve = vi.fn(async () => response())
    const tool = createPluginCheckToolDefinition(resolve)

    expect(() => tool.execute({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/candidate' },
      executeCandidate: true,
    })).toThrow(TypeError)
    expect(resolve).not.toHaveBeenCalled()
  })
})
