import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDshRuntimeTargetBinding,
  parseRunningDshProfileInvocation,
} from '../../src/integrations/dsh/runtime-target-binding.js'
import type { Evidence, TargetSnapshot } from '../../src/protocol/index.js'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-binding-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface RuntimeFixture {
  readonly home: string
  readonly profileDir: string
  readonly runtimeDsh: string
  readonly script: string
  readonly profileManifest: string
  readonly profilePatch: string
  readonly homePatch: string
  readonly dshManifest: string
  readonly bundleManifest: string
  readonly bundlePatch: string
  readonly snapshot: TargetSnapshot
}

function evidence(id: string, kind: Evidence['kind'], location: string, contentHash: string): Evidence {
  return {
    id,
    kind,
    strength: 'authoritative',
    contentHash,
    location,
  }
}

async function createFixture(): Promise<RuntimeFixture> {
  const root = await tempRoot()
  const home = join(root, 'dsh-home')
  const profileDir = join(home, 'profiles', 'web')
  const runtimeDsh = join(root, 'runtime-dsh')
  const script = join(runtimeDsh, 'lib', 'bin.js')
  const profileManifest = join(profileDir, 'package.json')
  const profilePatch = join(profileDir, 'cordis.patch.yml')
  const homePatch = join(home, 'cordis.patch.yml')
  const dshManifest = join(runtimeDsh, 'package.json')
  const bundleDir = join(runtimeDsh, 'node_modules', '@deepseek-ai', 'dsh-base')
  const bundleManifest = join(bundleDir, 'package.json')
  const bundlePatch = join(bundleDir, 'cordis.patch.yml')

  await mkdir(join(runtimeDsh, 'lib'), { recursive: true })
  await mkdir(profileDir, { recursive: true })
  await mkdir(bundleDir, { recursive: true })
  await writeFile(profileManifest, '{"name":"dsh-profile-web","version":"0.0.0","dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}\n')
  await writeFile(profilePatch, '[]\n')
  await writeFile(homePatch, '[]\n')
  await writeFile(dshManifest, '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n')
  await writeFile(bundleManifest, '{"name":"@deepseek-ai/dsh-base","version":"0.1.1-rc.2","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}\n')
  await writeFile(bundlePatch, '- insert: []\n')
  await writeFile(script, '// runtime entry\n')

  const snapshot: TargetSnapshot = {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-08-27T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: {
      nodeVersion: '24.19.0',
      platform: 'linux',
      arch: 'x64',
    },
    profile: {
      name: 'web',
      bundles: [{
        name: '@deepseek-ai/dsh-base',
        version: '0.1.1-rc.2',
        patchHash: 'bundle-patch-hash-a',
      }],
      dependencies: [],
      profilePatchHash: 'profile-hash-a',
      homePatchHash: 'home-hash-a',
      overlayPatchHashes: [],
    },
    evidence: [
      evidence('manifest:dsh', 'manifest', dshManifest, 'dsh-manifest-hash-a'),
      evidence('manifest:profile', 'manifest', profileManifest, 'profile-manifest-hash-a'),
      evidence('patch:profile', 'composed-config', profilePatch, 'profile-hash-a'),
      evidence('patch:home', 'composed-config', homePatch, 'home-hash-a'),
      evidence('manifest:bundle:0:@deepseek-ai/dsh-base', 'manifest', bundleManifest, 'bundle-manifest-hash-a'),
      evidence('patch:bundle:0:@deepseek-ai/dsh-base', 'composed-config', bundlePatch, 'bundle-patch-hash-a'),
    ],
  }

  return {
    home,
    profileDir,
    runtimeDsh,
    script,
    profileManifest,
    profilePatch,
    homePatch,
    dshManifest,
    bundleManifest,
    bundlePatch,
    snapshot,
  }
}

function createBinding(fixture: RuntimeFixture, overrides: {
  readonly home?: string
  readonly argv?: readonly string[]
  readonly nodeVersion?: string
  readonly startupTargetFingerprint?: string | Promise<string | undefined>
} = {}) {
  const binding = createDshRuntimeTargetBinding({
    baseUrl: pathToFileURL(fixture.profileDir).href + '/',
    dshHome: overrides.home ?? fixture.home,
    startupTargetFingerprint: overrides.startupTargetFingerprint ?? fixture.snapshot.fingerprint,
    argv: overrides.argv ?? ['node', fixture.script, '--profile', 'web'],
    cwd: fixture.profileDir,
    nodeVersion: overrides.nodeVersion ?? '24.19.0',
    platform: 'linux',
    arch: 'x64',
  })
  if (binding === undefined) throw new Error('runtime binding unexpectedly unavailable')
  return binding
}

function driftedSnapshot(
  snapshot: TargetSnapshot,
  discriminator: string,
  mutate: (value: TargetSnapshot) => TargetSnapshot = value => value,
): TargetSnapshot {
  const digit = discriminator.charCodeAt(0).toString(16).slice(-1)
  const base: TargetSnapshot = {
    ...snapshot,
    fingerprint: `dsh-target-v2:${digit.repeat(64)}`,
  }
  return mutate(base)
}

describe('DSH runtime target binding', () => {
  it('binds only the exact profile/home/DSH/runtime identity', async () => {
    const fixture = await createFixture()
    await expect(createBinding(fixture).matches(fixture.snapshot)).resolves.toBe(true)
  })

  it('fails closed when no startup semantic baseline is available', async () => {
    const fixture = await createFixture()
    await expect(createBinding(fixture, {
      startupTargetFingerprint: Promise.resolve(undefined),
    }).matches(fixture.snapshot)).resolves.toBe(false)
  })

  it('rejects a different requested profile', async () => {
    const fixture = await createFixture()
    const snapshot: TargetSnapshot = {
      ...fixture.snapshot,
      profile: { ...fixture.snapshot.profile, name: 'headless' },
    }
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a foreign DSH home even when the requested profile name matches', async () => {
    const fixture = await createFixture()
    const foreignHome = join(await tempRoot(), 'foreign-home')
    await expect(createBinding(fixture, { home: foreignHome }).matches(fixture.snapshot)).resolves.toBe(false)
  })

  it('rejects a snapshot resolved from another DSH installation', async () => {
    const fixture = await createFixture()
    const foreignDsh = join(await tempRoot(), 'foreign-dsh')
    await mkdir(foreignDsh, { recursive: true })
    const foreignManifest = join(foreignDsh, 'package.json')
    await writeFile(foreignManifest, '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n')
    const snapshot: TargetSnapshot = {
      ...fixture.snapshot,
      evidence: fixture.snapshot.evidence.map(item => item.id === 'manifest:dsh'
        ? { ...item, location: foreignManifest }
        : item),
    }

    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects requested overlays because upstream exposes no immutable boot-time overlay identity', async () => {
    const fixture = await createFixture()
    const snapshot: TargetSnapshot = {
      ...fixture.snapshot,
      profile: {
        ...fixture.snapshot.profile,
        overlayPatchHashes: [...fixture.snapshot.profile.overlayPatchHashes, 'overlay-hash'],
      },
    }
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a running launcher invocation that used an explicit overlay', async () => {
    const fixture = await createFixture()
    const argv = ['node', fixture.script, '--profile', 'web', '--patch', './overlay.yml']
    await expect(createBinding(fixture, { argv }).matches(fixture.snapshot)).resolves.toBe(false)
  })

  it('rejects a runtime identity mismatch', async () => {
    const fixture = await createFixture()
    await expect(createBinding(fixture, { nodeVersion: '26.0.0' }).matches(fixture.snapshot)).resolves.toBe(false)
  })

  it('rejects a profile manifest changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.profileManifest, '{"name":"dsh-profile-web","version":"0.0.0","dsh":{"profile":{"bundles":[]}}}\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'b', value => ({
      ...value,
      evidence: value.evidence.map(item => item.id === 'manifest:profile'
        ? { ...item, contentHash: 'profile-manifest-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a DSH manifest changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.dshManifest, '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.3"}\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'c', value => ({
      ...value,
      dsh: { ...value.dsh, version: '0.1.1-rc.3' },
      evidence: value.evidence.map(item => item.id === 'manifest:dsh'
        ? { ...item, contentHash: 'dsh-manifest-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a bundle manifest changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.bundleManifest, '{"name":"@deepseek-ai/dsh-base","version":"0.1.1-rc.3","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'd', value => ({
      ...value,
      profile: {
        ...value.profile,
        bundles: value.profile.bundles.map(bundle => ({ ...bundle, version: '0.1.1-rc.3' })),
      },
      evidence: value.evidence.map(item => item.id.startsWith('manifest:bundle:')
        ? { ...item, contentHash: 'bundle-manifest-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a bundle patch changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.bundlePatch, '- insert:\n    - id: changed\n      name: changed-plugin\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'e', value => ({
      ...value,
      profile: {
        ...value.profile,
        bundles: value.profile.bundles.map(bundle => ({ ...bundle, patchHash: 'bundle-patch-hash-b' })),
      },
      evidence: value.evidence.map(item => item.id.startsWith('patch:bundle:')
        ? { ...item, contentHash: 'bundle-patch-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a startup profile patch changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.profilePatch, '- id: changed\n  disabled: true\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'f', value => ({
      ...value,
      profile: { ...value.profile, profilePatchHash: 'profile-hash-b' },
      evidence: value.evidence.map(item => item.id === 'patch:profile'
        ? { ...item, contentHash: 'profile-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })

  it('rejects a home patch changed in place after the running composition was established', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.homePatch, '- id: changed\n  disabled: true\n')
    const snapshot = driftedSnapshot(fixture.snapshot, 'g', value => ({
      ...value,
      profile: { ...value.profile, homePatchHash: 'home-hash-b' },
      evidence: value.evidence.map(item => item.id === 'patch:home'
        ? { ...item, contentHash: 'home-hash-b' }
        : item),
    }))
    await expect(createBinding(fixture).matches(snapshot)).resolves.toBe(false)
  })
})

describe('official DSH launcher parsing', () => {
  it('parses profile/web aliases and preserves ordered launcher overlays', () => {
    expect(parseRunningDshProfileInvocation(['node', '/dsh/bin.js', '--profile', 'web'])).toEqual({
      profile: 'web',
      patches: [],
    })
    expect(parseRunningDshProfileInvocation([
      'node', '/dsh/bin.js', 'web', '--patch=a.yml', '--patch', 'b.yml', '--app-flag', 'value',
    ], '/workspace')).toEqual({
      profile: 'web',
      patches: ['/workspace/a.yml', '/workspace/b.yml'],
    })
  })

  it('refuses non-boot launcher modes', () => {
    expect(parseRunningDshProfileInvocation(['node', '/dsh/bin.js', 'plugin', '--profile', 'web'])).toBeUndefined()
    expect(parseRunningDshProfileInvocation(['node', '/dsh/bin.js', '--profile', 'web', '--dump-config'])).toBeUndefined()
  })
})
