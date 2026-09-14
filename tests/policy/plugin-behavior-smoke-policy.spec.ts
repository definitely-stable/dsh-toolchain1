import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function readRepo(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8')
}

describe('M4.3.3 real-DSH Agent Tool behavior smoke policy', () => {
  it('pins the exact DSH behavior authority and Agent-capable profile', async () => {
    const smoke = await import('../../scripts/smoke-plugin-behavior.mjs') as Record<string, unknown>

    expect(smoke.PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION).toBe('0.1.5-rc.2')
    expect(smoke.PLUGIN_BEHAVIOR_SMOKE_PROFILE).toBe('web')
    expect(smoke.PLUGIN_BEHAVIOR_SMOKE_TOOL).toBe('dsh_toolchain_behavior_smoke_tool')
  })

  it('uses the exact packed Toolchain worker to prove structured Agent Tool arguments and result value', async () => {
    const source = await readRepo('scripts/smoke-plugin-behavior.mjs')

    expect(source).toContain("@deepseek-ai/dsh@${PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION}")
    expect(source).toContain("'target', 'resolve'")
    expect(source).toContain("lib', 'verification', 'packed-worker.js")
    expect(source).toContain('runPackedPluginVerification')
    expect(source).toContain("visibilityAssertions: [{ kind: 'agent-tool'")
    expect(source).toContain("kind: 'agent-tool-result'")
    expect(source).toContain('arguments: { value: 7 }')
    expect(source).toContain('expectedValue: { ready: true, value: 7 }')
    expect(source).toContain("['package', 'install', 'compose', 'boot', 'visibility', 'behavior']")
    expect(source).toContain("cleanup, 'succeeded'")
    expect(source).toContain('assertTreeUnchanged')
    expect(source).toContain('must-not-cross-behavior-verification-boundary')
  })

  it('is delegated from the existing primary Plugin Verify smoke without weakening its public-path contract', async () => {
    const source = await readRepo('scripts/smoke-plugin-verify.mjs')

    expect(source).toContain("import { smokePluginBehavior } from './smoke-plugin-behavior.mjs'")
    expect(source).toContain('await smokePluginBehavior(packedToolchain)')
    expect(source).not.toContain("lib', 'verification', 'packed-worker.js")
  })
})
