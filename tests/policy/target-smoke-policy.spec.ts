import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function readRepo(path: string): Promise<string> {
  return readFile(fileURLToPath(new URL(path, root)), 'utf8')
}

describe('Target Intelligence smoke policy', () => {
  it('covers the current and older DSH trains with one normalized target contract', async () => {
    const smoke = await import('../../scripts/smoke-target-resolve.mjs') as Record<string, unknown>

    expect(smoke.TARGET_SMOKE_DSH_VERSIONS).toEqual([
      '0.1.2-alpha.1',
      '0.1.1-rc.2',
      '0.1.0-rc.8',
    ])
    expect(smoke.TARGET_SMOKE_PROFILE).toBe('headless')
  })

  it('requires path-stability, v2 fingerprinting, read-only evidence, and one no-hint DSH resolution', async () => {
    const source = await readRepo('scripts/smoke-target-resolve.mjs')

    expect(source).toContain("'target', 'resolve'")
    expect(source).toContain("'--profile'")
    expect(source).toContain("'--dsh-home'")
    expect(source).toContain("'--dsh-package-root'")
    expect(source).toMatch(/dsh-target-v2:\[0-9a-f\]\{64\}/)
    expect(source).toContain('resolveReadOnlyTarget({ version, home: firstHome })')
    expect(source).toContain('snapshotTree')
    expect(source).toContain('assertTreeUnchanged')
    expect(source).toContain('copyFile')
  })

  it('runs the registry-backed multi-train smoke only in the primary artifact-truth lane', async () => {
    const workflow = await readRepo('.github/workflows/ci.yml')
    const [primary, remainder = ''] = workflow.split('\n  node-compat:')

    expect(primary).toContain('node scripts/smoke-target-resolve.mjs')
    expect(remainder).not.toContain('node scripts/smoke-target-resolve.mjs')
    expect(workflow.match(/node scripts\/smoke-target-resolve\.mjs/g)).toHaveLength(1)
  })
})
