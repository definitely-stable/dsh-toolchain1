import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const smokeModule = await import('../../scripts/smoke-dsh-package.mjs') as Record<string, unknown>
const smokeSource = await readFile(
  fileURLToPath(new URL('../../scripts/smoke-dsh-package.mjs', import.meta.url)),
  'utf8',
)

describe('DSH package smoke policy', () => {
  it('covers both minimal and canonical web profiles', () => {
    expect(smokeModule.DSH_SMOKE_PROFILES).toEqual([
      {
        name: 'toolchain-smoke',
        requiredBundles: ['@deepseek-ai/dsh-base'],
      },
      {
        name: 'web',
        requiredBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    ])
  })

  it('requires the shipped profile bundles in addition to dsh-toolchain', () => {
    const assertProfileManifest = smokeModule.assertProfileManifest as (
      manifest: unknown,
      requiredBundles: readonly string[],
    ) => void

    const manifest = {
      dependencies: { 'dsh-toolchain': 'file:package.tgz' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-toolchain'] } },
    }

    expect(() => assertProfileManifest(manifest, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])).toThrow(/@deepseek-ai\/dsh-web-app/)
  })

  it('requires the namespaced loader row in composed config', () => {
    const assertDumpConfig = smokeModule.assertDumpConfig as (dump: string) => void

    expect(() => assertDumpConfig(`
- id: toolchain
  name: dsh-toolchain/dsh
`)).toThrow(/dsh-toolchain row/)
  })

  it('requires an actual DSH boot probe that observes the packaged toolchain service and exits through the launcher', () => {
    expect(smokeModule.DSH_BOOT_PROBE_PROFILE).toBe('toolchain-smoke')
    expect(typeof smokeModule.createBootProbePackage).toBe('function')
    expect(typeof smokeModule.assertBootProbeOutput).toBe('function')

    expect(smokeSource).toContain('ctx.toolchain.describe()')
    expect(smokeSource).toContain("ctx.get('appExit')")
    expect(smokeSource).toContain("'exec', 'dsh', '--profile', DSH_BOOT_PROBE_PROFILE")
  })
})
