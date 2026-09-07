import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createDshRuntimeTargetBinding } from '../../src/integrations/dsh/runtime-target-binding.js'
import type { Evidence, TargetSnapshot } from '../../src/protocol/index.js'

const roots: string[] = []
const TARGET = `dsh-target-v2:${'a'.repeat(64)}`
const LIVE = `dsh-profile-lifecycle-v1:${'b'.repeat(64)}`
const STARTUP = `dsh-profile-lifecycle-v1:${'c'.repeat(64)}`

function evidence(id: string, kind: Evidence['kind'], location: string): Evidence {
  return {
    id,
    kind,
    strength: 'authoritative',
    contentHash: 'd'.repeat(64),
    location,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  readonly snapshot: TargetSnapshot
  readonly binding: NonNullable<ReturnType<typeof createDshRuntimeTargetBinding>>
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-lifecycle-binding-'))
  roots.push(root)

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
  await writeFile(profileManifest, '{"name":"dsh-profile-web","version":"0.0.0","dsh":{"profile":{"patchReload":"live","bundles":[]}}}\n')
  await writeFile(profilePatch, '[]\n')
  await writeFile(homePatch, '[]\n')
  await writeFile(dshManifest, '{"name":"@deepseek-ai/dsh","version":"0.1.2-rc.1"}\n')
  await writeFile(script, '// runtime entry\n')

  const snapshot: TargetSnapshot = {
    fingerprint: TARGET,
    createdAt: '2026-09-07T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'e'.repeat(64),
      homePatchHash: 'f'.repeat(64),
      overlayPatchHashes: [],
    },
    profileLifecycle: {
      patchReload: 'live',
      fingerprint: LIVE,
    },
    evidence: [
      evidence('manifest:dsh', 'manifest', dshManifest),
      evidence('manifest:profile', 'manifest', profileManifest),
      evidence('patch:profile', 'composed-config', profilePatch),
      evidence('patch:home', 'composed-config', homePatch),
    ],
  }

  const binding = createDshRuntimeTargetBinding({
    baseUrl: pathToFileURL(profileDir).href + '/',
    dshHome: home,
    startupTargetFingerprint: TARGET,
    startupLifecycleFingerprint: LIVE,
    argv: ['node', script, '--profile', 'web'],
    cwd: profileDir,
    nodeVersion: '24.19.0',
    platform: 'linux',
    arch: 'x64',
  })
  if (binding === undefined) throw new Error('runtime binding unexpectedly unavailable')

  return { snapshot, binding }
}

describe('DSH runtime profile lifecycle binding', () => {
  it('accepts the startup lifecycle and rejects same-target lifecycle drift', async () => {
    const { snapshot, binding } = await fixture()

    await expect(binding.matches(snapshot)).resolves.toBe(true)
    await expect(binding.matches({
      ...snapshot,
      profileLifecycle: {
        patchReload: 'startup',
        fingerprint: STARTUP,
      },
    })).resolves.toBe(false)
  })
})
