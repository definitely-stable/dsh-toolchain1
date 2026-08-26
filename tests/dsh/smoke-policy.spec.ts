import { describe, expect, it } from 'vitest'

const smokeModule = await import('../../scripts/smoke-dsh-package.mjs') as Record<string, unknown>

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
})
