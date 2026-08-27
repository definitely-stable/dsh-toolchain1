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
  readonly snapshot: TargetSnapshot
}

function evidence(id: string, kind: Evidence['kind'], location: string): Evidence {
  return {
    id,
    kind,
    strength: 'authoritative',
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

  await mkdir(join(runtimeDsh, 'lib'), { recursive: true })
  await mkdir(profileDir, { recursive: true })
  await writeFile(profileManifest, '{"name":"dsh-profile-web","version":"0.0.0"}\n')
  await writeFile(profilePatch, '[]\n')
  await writeFile(homePatch, '[]\n')
  await writeFile(dshManifest, '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n')
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
      bundles: [],
      dependencies: [],
      profilePatchHash: 'profile-hash',
      homePatchHash: 'home-hash',
      overlayPatchHashes: [],
    },
    evidence: [
      evidence('manifest:dsh', 'manifest', dshManifest),
      evidence('manifest:profile', 'manifest', profileManifest),
      evidence('patch:profile', 'composed-config', profilePatch),
      evidence('patch:home', 'composed-config', homePatch),
    ],
  }

  return { home, profileDir, runtimeDsh, script, snapshot }
}

function createBinding(fixture: RuntimeFixture, overrides: {
  readonly home?: string
  readonly argv?: readonly string[]
  readonly nodeVersion?: string
} = {}) {
  const binding = createDshRuntimeTargetBinding({
    baseUrl: pathToFileURL(fixture.profileDir).href + '/',
    dshHome: overrides.home ?? fixture.home,
    argv: overrides.argv ?? ['node', fixture.script, '--profile', 'web'],
    cwd: fixture.profileDir,
    nodeVersion: overrides.nodeVersion ?? '24.19.0',
    platform: 'linux',
    arch: 'x64',
  })
  if (binding === undefined) throw new Error('runtime binding unexpectedly unavailable')
  return binding
}

describe('DSH runtime target binding', () => {
  it('binds only the exact profile/home/DSH/runtime identity', async () => {
    const fixture = await createFixture()
    await expect(createBinding(fixture).matches(fixture.snapshot)).resolves.toBe(true)
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
