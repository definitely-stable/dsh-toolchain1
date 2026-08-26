import { describe, expect, it } from 'vitest'
import {
  canonicalizeTargetProjection,
  createTargetSemanticProjectionV1,
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
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2' },
        { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2' },
      ],
      dependencies: [
        { name: 'z-user-plugin', version: '2.0.0' },
        { name: 'dsh-toolchain', version: '0.0.0' },
        { name: 'a-user-plugin', version: '1.0.0' },
      ],
      patchHash: 'a'.repeat(64),
    },
    evidence: [
      {
        id: 'profile-manifest',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: 'b'.repeat(64),
        location: '/home/one/.dsh/profiles/web/package.json',
      },
    ],
  }
}

async function fingerprint(facts: AcquiredTargetFacts): Promise<string> {
  return fingerprintTarget(createTargetSemanticProjectionV1(facts), digest)
}

describe('TargetSemanticProjectionV1', () => {
  it('is stable across paths, evidence locations and Toolchain observer version', async () => {
    const left = baseFacts()
    const rightBase = baseFacts()
    const right: AcquiredTargetFacts = {
      ...rightBase,
      profile: {
        ...rightBase.profile,
        dependencies: rightBase.profile.dependencies.map(dependency =>
          dependency.name === 'dsh-toolchain'
            ? { ...dependency, version: '9.9.9' }
            : dependency,
        ),
      },
      evidence: rightBase.evidence.map(evidence => ({
        ...evidence,
        location: 'C:\\Users\\test\\.dsh\\profiles\\web\\package.json',
      })),
    }

    expect(createTargetSemanticProjectionV1(left)).toEqual(createTargetSemanticProjectionV1(right))
    expect(await fingerprint(left)).toBe(await fingerprint(right))
  })

  it('normalizes dependency declaration order but preserves bundle order', async () => {
    const dependenciesBase = baseFacts()
    const reorderedDependencies: AcquiredTargetFacts = {
      ...dependenciesBase,
      profile: {
        ...dependenciesBase.profile,
        dependencies: [...dependenciesBase.profile.dependencies].reverse(),
      },
    }

    expect(await fingerprint(baseFacts())).toBe(await fingerprint(reorderedDependencies))

    const bundlesBase = baseFacts()
    const reorderedBundles: AcquiredTargetFacts = {
      ...bundlesBase,
      profile: {
        ...bundlesBase.profile,
        bundles: [...bundlesBase.profile.bundles].reverse(),
      },
    }
    expect(await fingerprint(baseFacts())).not.toBe(await fingerprint(reorderedBundles))
  })

  it('changes when compatibility-relevant target facts change', async () => {
    const baseline = await fingerprint(baseFacts())
    const source = baseFacts()

    const patchChanged: AcquiredTargetFacts = {
      ...source,
      profile: { ...source.profile, patchHash: 'c'.repeat(64) },
    }
    const bundleChanged: AcquiredTargetFacts = {
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
    const runtimeChanged: AcquiredTargetFacts = {
      ...source,
      runtime: { ...source.runtime, arch: 'arm64' },
    }

    for (const changed of [patchChanged, bundleChanged, dependencyChanged, runtimeChanged]) {
      expect(await fingerprint(changed)).not.toBe(baseline)
    }
  })

  it('uses deterministic canonical JSON and a versioned fingerprint namespace', async () => {
    const projection = createTargetSemanticProjectionV1(baseFacts())
    const canonical = canonicalizeTargetProjection(projection)
    const result = await fingerprintTarget(projection, digest)

    expect(JSON.parse(canonical)).toEqual(projection)
    expect(result).toMatch(/^dsh-target-v1:[0-9a-f]{64}$/)
    expect(projection.profile.dependencies.map(dependency => dependency.name)).toEqual([
      'a-user-plugin',
      'z-user-plugin',
    ])
  })

  it('rejects a digest implementation that does not return lowercase SHA-256 hex', async () => {
    const invalidDigest: Sha256Port = { sha256Utf8: async () => 'not-a-sha256' }

    await expect(
      fingerprintTarget(createTargetSemanticProjectionV1(baseFacts()), invalidDigest),
    ).rejects.toThrow('64 lowercase hexadecimal')
  })
})
