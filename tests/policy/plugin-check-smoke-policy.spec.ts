import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function readRepo(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8')
}

describe('Exact Target Plugin Check packed smoke policy', () => {
  it('binds one exact published DSH train and the shipped packed Toolchain artifact', async () => {
    const smoke = await import('../../scripts/smoke-plugin-check.mjs') as Record<string, unknown>

    expect(smoke.PLUGIN_CHECK_SMOKE_DSH_VERSION).toBe('0.1.1-rc.2')
    expect(smoke.PLUGIN_CHECK_SMOKE_PROFILE).toBe('headless')
  })

  it('checks the packed artifact read-only and asserts the static-report safety boundary', async () => {
    const source = await readRepo('scripts/smoke-plugin-check.mjs')

    expect(source).toContain("'plugin', 'check'")
    expect(source).toContain("'--subject'")
    expect(source).toContain('candidateCodeExecuted')
    expect(source).toContain('scopeComplete')
    expect(source).toContain("subjectCompleteness !== 'complete'")
    expect(source).toContain("'plugin:packed-artifact'")
    expect(source).toContain("'plugin:manifest'")
    expect(source).toContain("'plugin:bundle-patch'")
    expect(source).toContain('snapshotTree')
    expect(source).toContain('assertTreeUnchanged')
  })

  it('runs the packed real-DSH smoke exactly once in the primary artifact-truth lane', async () => {
    const workflow = await readRepo('.github/workflows/ci.yml')
    const command = 'node scripts/smoke-plugin-check.mjs .artifacts/dsh-toolchain.tgz'
    const [primary, remainder = ''] = workflow.split('\n  node-compat:')

    expect(primary).toContain(command)
    expect(remainder).not.toContain(command)
    expect(workflow.match(/node scripts\/smoke-plugin-check\.mjs \.artifacts\/dsh-toolchain\.tgz/g)).toHaveLength(1)
  })
})
