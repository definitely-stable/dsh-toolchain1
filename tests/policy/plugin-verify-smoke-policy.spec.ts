import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function readRepo(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8')
}

describe('Plugin Verify public-path real-DSH smoke policy', () => {
  it('binds one exact published DSH train, lightweight headless target, and explicit Host Service assertion', async () => {
    const smoke = await import('../../scripts/smoke-plugin-verify.mjs') as Record<string, unknown>

    expect(smoke.PLUGIN_VERIFY_SMOKE_DSH_VERSION).toBe('0.1.1-rc.2')
    expect(smoke.PLUGIN_VERIFY_SMOKE_PROFILE).toBe('headless')
    expect(smoke.PLUGIN_VERIFY_SMOKE_SERVICE).toBe('dshToolchainVerifySmokeService')
  })

  it('invokes the installed public CLI and asserts a fully verified exact-artifact receipt with live Host Service visibility', async () => {
    const source = await readRepo('scripts/smoke-plugin-verify.mjs')

    expect(source).toContain("ctx.provide(PLUGIN_VERIFY_SMOKE_SERVICE")
    expect(source).toContain("'plugin', 'verify'")
    expect(source).toContain("'--subject'")
    expect(source).toContain("'--visibility-service', PLUGIN_VERIFY_SMOKE_SERVICE")
    expect(source).toContain("status, 'verified'")
    expect(source).toContain("cleanup, 'succeeded'")
    expect(source).toContain("['structure', 'manifest', 'dependency', 'contract', 'build', 'package', 'install', 'compose', 'boot', 'visibility', 'behavior']")
    expect(source).toContain("['package', 'install', 'compose', 'boot', 'visibility']")
    expect(source).toContain('dsh-plugin-artifact-v1:')
    expect(source).toContain('dsh-target-v2:')
    expect(source).not.toContain('runPackedPluginVerification')
    expect(source).not.toContain("../lib/verification/packed-worker.js")
  })

  it('runs the public verify smoke exactly once in the primary artifact-truth lane', async () => {
    const workflow = await readRepo('.github/workflows/ci.yml')
    const command = 'node scripts/smoke-plugin-verify.mjs .artifacts/dsh-toolchain.tgz'
    const [primary, remainder = ''] = workflow.split('\n  node-compat:')

    expect(primary).toContain(command)
    expect(remainder).not.toContain(command)
    expect(workflow.match(/node scripts\/smoke-plugin-verify\.mjs \.artifacts\/dsh-toolchain\.tgz/g)).toHaveLength(1)
  })
})
