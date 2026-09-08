import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function readRepo(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8')
}

describe('Plugin Verify negative public-path real-DSH smoke policy', () => {
  it('pins the current registry-backed lifecycle-aware DSH train and headless profile', async () => {
    const source = await readRepo('scripts/smoke-plugin-verify-negative.mjs')

    expect(source).toContain("export const PLUGIN_VERIFY_NEGATIVE_SMOKE_DSH_VERSION = '0.1.2-rc.1'")
    expect(source).toContain("export const PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE = 'headless'")
  })

  it('covers packed-entrypoint rejection and requested Host Service visibility failure through the installed public CLI', async () => {
    const source = await readRepo('scripts/smoke-plugin-verify-negative.mjs')

    expect(source).toContain('createPackedRuntimeBrokenCandidate')
    expect(source).toContain('createVisibilityBrokenCandidate')
    expect(source).toContain("'plugin', 'verify'")
    expect(source).toContain("'--subject'")
    expect(source).toContain("'--visibility-service'")
    expect(source).toContain("allowedStatuses: [1]")
    expect(source).toContain("status, 'failed'")
    expect(source).toContain("cleanup, 'succeeded'")
    expect(source).toContain("'VERIFY_PACKAGE_ENTRYPOINT_MISSING'")
    expect(source).toContain("reason: 'prerequisite-package-failed'")
    expect(source).toContain("'VERIFY_VISIBILITY_FAILED'")
    expect(source).toContain('dsh-plugin-artifact-v1:')
    expect(source).toContain('dsh-target-v2:')
    expect(source).toContain('dsh-profile-lifecycle-v1:')
    expect(source).toContain('assertTreeUnchanged')
    expect(source).not.toContain('runPackedPluginVerification')
    expect(source).not.toContain('../lib/verification/packed-worker.js')
  })

  it('runs the negative public verify smoke exactly once in the primary artifact-truth lane', async () => {
    const workflow = await readRepo('.github/workflows/ci.yml')
    const command = 'node scripts/smoke-plugin-verify-negative.mjs .artifacts/dsh-toolchain.tgz'
    const [primary, remainder = ''] = workflow.split('\n  node-compat:')

    expect(primary).toContain(command)
    expect(remainder).not.toContain(command)
    expect(workflow.match(/node scripts\/smoke-plugin-verify-negative\.mjs \.artifacts\/dsh-toolchain\.tgz/g)).toHaveLength(1)
  })
})
