import { describe, expect, it } from 'vitest'
import {
  canonicalizeTargetProjection,
  createTargetSemanticProjectionV2,
  fingerprintTarget,
  type AcquiredTargetFacts,
  type Sha256Port,
} from '../../src/model/target.js'

const digest: Sha256Port = {
  async sha256Utf8(value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0').repeat(8)
  },
}

function baseFacts(): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: '1'.repeat(64) },
        { name: 'dsh-toolchain', version: '0.0.0', patchHash: '2'.repeat(64) },
        { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', patchHash: '3'.repeat(64) },
      ],
      dependencies: [
        { name: 'a-user-plugin', version: '1.0.0' },
        { name: 'dsh-toolchain', version: '0.0.0' },
        { name: 'Z-user-plugin', version: '2.0.0' },
      ],
      profilePatchHash: 'a'.repeat(64),
      homePatchHash: 'b'.repeat(64),
      overlayPatchHashes: ['c'.repeat(64), 'd'.repeat(64)],
    },
    evidence: [
      {
        id: 'profile-manifest',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: 'e'.repeat(64),
        location: '/home/one/.dsh/profiles/web/package.json',
      },
      {
        id: 'patch:overlay:0',
        kind: 'composed-config',
        strength: 'authoritative',
        contentHash: 'c'.repeat(64),
        location: '/home/one/overlay.yml',
      },
    ],
  }
}

async function fingerprint(facts: AcquiredTargetFacts): Promise<string> {
  return fingerprintTarget(createTargetSemanticProjectionV2(facts), digest)
}

describe('TargetSemanticProjectionV2', () => {
  it('is stable across paths, evidence locations and Toolchain observer version/content', async () => {
    const left = baseFacts()
    const rightBase = baseFacts()
    const right: AcquiredTargetFacts = {
      ...rightBase,
      profile: {
        ...rightBase.profile,
        bundles: rightBase.profile.bundles.map(bundle =>
          bundle.name === 'dsh-toolchain'
            ? { ...bundle, version: '9.9.9', patchHash: 'f'.repeat(64) }
            : bundle,
        ),
        dependencies: rightBase.profile.dependencies.map(dependency =>
          dependency.name === 'dsh-toolchain'
            ? { ...dependency, version: '9.9.9' }
            : dependency,
        ),
      },
      evidence: rightBase.evidence.map(evidence => ({
        ...evidence,
        location: `C:\\Users\\test\\${evidence.id}.yml`,
      })),
    }

    expect(createTargetSemanticProjectionV2(left)).toEqual(createTargetSemanticProjectionV2(right))
    expect(createTargetSemanticProjectionV2(left).profile.bundles).toEqual([
      { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: '1'.repeat(64) },
      { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', patchHash: '3'.repeat(64) },
    ])
    expect(await fingerprint(left)).toBe(await fingerprint(right))
  })

  it('normalizes dependency declaration order but preserves bundle and overlay order', async () => {
    const dependenciesBase = baseFacts()
    const reorderedDependencies: AcquiredTargetFacts = {
      ...dependenciesBase,
      profile: {
        ...dependenciesBase.profile,
        dependencies: dependenciesBase.profile.dependencies.toReversed(),
      },
    }
    expect(await fingerprint(baseFacts())).toBe(await fingerprint(reorderedDependencies))

    const bundlesBase = baseFacts()
    const reorderedBundles: AcquiredTargetFacts = {
      ...bundlesBase,
      profile: {
        ...bundlesBase.profile,
        bundles: bundlesBase.profile.bundles.toReversed(),
      },
    }
    expect(await fingerprint(baseFacts())).not.toBe(await fingerprint(reorderedBundles))

    const overlaysBase = baseFacts()
    const reorderedOverlays: AcquiredTargetFacts = {
      ...overlaysBase,
      profile: {
        ...overlaysBase.profile,
        overlayPatchHashes: overlaysBase.profile.overlayPatchHashes.toReversed(),
      },
    }
    expect(await fingerprint(baseFacts())).not.toBe(await fingerprint(reorderedOverlays))
  })

  it('changes when any effective composition layer changes', async () => {
    const baseline = await fingerprint(baseFacts())
    const source = baseFacts()

    const bundlePatchChanged: AcquiredTargetFacts = {
      ...source,
      profile: {
        ...source.profile,
        bundles: source.profile.bundles.map((bundle, index) =>
          index === 0 ? { ...bundle, patchHash: '9'.repeat(64) } : bundle,
        ),
      },
    }
    const profilePatchChanged: AcquiredTargetFacts = {
      ...source,
      profile: { ...source.profile, profilePatchHash: '8'.repeat(64) },
    }
    const homePatchChanged: AcquiredTargetFacts = {
      ...source,
      profile: { ...source.profile, homePatchHash: '7'.repeat(64) },
    }
    const overlayChanged: AcquiredTargetFacts = {
      ...source,
      profile: {
        ...source.profile,
        overlayPatchHashes: ['6'.repeat(64), ...source.profile.overlayPatchHashes.slice(1)],
      },
    }
    const bundleVersionChanged: AcquiredTargetFacts = {
      ...source,
      profile: {
        ...source.profile,
        bundles: source.profile.bundles.map((bundle, index) =>
          index === 0 ? { ...bundle, version: '0.1.1-rc.3' } : bundle,
        ),
      },
    }
    const dependencyChanged: AcquiredTargetFacts = {
      ...source,
      profile: {
        ...source.profile,
        dependencies: source.profile.dependencies.map((dependency, index) =>
          index === 0 ? { ...dependency, version: '2.1.0' } : dependency,
        ),
      },
    }

    for (const changed of [
      bundlePatchChanged,
      profilePatchChanged,
      homePatchChanged,
      overlayChanged,
      bundleVersionChanged,
      dependencyChanged,
    ]) {
      expect(await fingerprint(changed)).not.toBe(baseline)
    }
  })

  it.each([
    ['DSH version', (facts: AcquiredTargetFacts) => ({ ...facts, dsh: { ...facts.dsh, version: '0.1.1-rc.3' } })],
    ['Node version', (facts: AcquiredTargetFacts) => ({ ...facts, runtime: { ...facts.runtime, nodeVersion: '26.0.0' } })],
    ['platform', (facts: AcquiredTargetFacts) => ({ ...facts, runtime: { ...facts.runtime, platform: 'win32' } })],
    ['architecture', (facts: AcquiredTargetFacts) => ({ ...facts, runtime: { ...facts.runtime, arch: 'arm64' } })],
  ] as const)('changes when %s changes', async (_label, change) => {
    expect(await fingerprint(change(baseFacts()))).not.toBe(await fingerprint(baseFacts()))
  })

  it('uses deterministic canonical JSON and the v2 fingerprint namespace', async () => {
    const projection = createTargetSemanticProjectionV2(baseFacts())
    const canonical = canonicalizeTargetProjection(projection)
    const result = await fingerprintTarget(projection, digest)

    expect(canonical).toBe(
      '{"dsh":{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"},"profile":{"bundles":[{"name":"@deepseek-ai/dsh-base","patchHash":"1111111111111111111111111111111111111111111111111111111111111111","version":"0.1.1-rc.2"},{"name":"@deepseek-ai/dsh-web-app","patchHash":"3333333333333333333333333333333333333333333333333333333333333333","version":"0.1.1-rc.2"}],"dependencies":[{"name":"Z-user-plugin","version":"2.0.0"},{"name":"a-user-plugin","version":"1.0.0"}],"homePatchHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","name":"web","overlayPatchHashes":["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"],"profilePatchHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"runtime":{"arch":"x64","nodeVersion":"24.19.0","platform":"linux"},"schema":"dsh-target-v2"}',
    )
    expect(result).toMatch(/^dsh-target-v2:[0-9a-f]{64}$/)
  })

  it('rejects a digest implementation that does not return lowercase SHA-256 hex', async () => {
    const invalidDigest: Sha256Port = { sha256Utf8: async () => 'not-a-sha256' }

    await expect(
      fingerprintTarget(createTargetSemanticProjectionV2(baseFacts()), invalidDigest),
    ).rejects.toThrow('64 lowercase hexadecimal')
  })
})
