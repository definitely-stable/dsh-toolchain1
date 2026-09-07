import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createDshFilesystemTargetAcquisition } from '../../src/acquisition/dsh-filesystem.js'
import { TargetAcquisitionError } from '../../src/model/target.js'

const fixture = fileURLToPath(new URL('../fixtures/targets/valid/', import.meta.url))
const roots: string[] = []
const runtime = { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' } as const

async function copyFixture(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `dsh-toolchain-patch-reload-${label}-`))
  roots.push(root)
  await cp(fixture, root, { recursive: true })
  return root
}

function targetRoots(root: string) {
  return {
    dshHome: path.join(root, 'dsh-home'),
    dshPackageRoot: path.join(root, 'dsh-package'),
  }
}

async function rewriteJson(
  location: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = JSON.parse(await readFile(location, 'utf8')) as Record<string, unknown>
  mutate(value)
  await writeFile(location, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8')
}

async function setDshVersion(root: string, version: string): Promise<void> {
  await rewriteJson(path.join(root, 'dsh-package/package.json'), value => {
    value.version = version
  })
}

async function setPatchReload(root: string, value: unknown): Promise<void> {
  await rewriteJson(path.join(root, 'dsh-home/profiles/web/package.json'), manifest => {
    const dsh = manifest.dsh as { profile: Record<string, unknown> }
    dsh.profile.patchReload = value
  })
}

async function acquire(root: string) {
  return createDshFilesystemTargetAcquisition({ env: {}, runtime }).acquire({
    profile: 'web',
    ...targetRoots(root),
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH profile patchReload lifecycle acquisition', () => {
  it('does not backfill the newer lifecycle contract into the frozen rc.2 train', async () => {
    const root = await copyFixture('legacy-rc2')

    const facts = await acquire(root)

    expect(facts.dsh.version).toBe('0.1.1-rc.2')
    expect(facts.profile.patchReload).toBeUndefined()
  })

  it.each(['live', 'startup'] as const)(
    'preserves explicit %s lifecycle on DSH 0.1.2+',
    async patchReload => {
      const root = await copyFixture(`explicit-${patchReload}`)
      await setDshVersion(root, '0.1.2-rc.1')
      await setPatchReload(root, patchReload)

      const facts = await acquire(root)

      expect(facts.dsh.version).toBe('0.1.2-rc.1')
      expect(facts.profile.patchReload).toBe(patchReload)
    },
  )

  it('uses the upstream historical live default when a supporting train omits patchReload', async () => {
    const root = await copyFixture('supported-default')
    await setDshVersion(root, '0.1.2-rc.1')

    const facts = await acquire(root)

    expect(facts.profile.patchReload).toBe('live')
  })

  it('fails closed for an invalid patchReload value on a supporting train', async () => {
    const root = await copyFixture('supported-invalid')
    await setDshVersion(root, '0.1.2-rc.1')
    await setPatchReload(root, 'sometimes')

    let caught: unknown
    try {
      await acquire(root)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(TargetAcquisitionError)
    expect(caught).toMatchObject({
      code: 'TARGET_MANIFEST_INVALID',
      locations: [path.join(root, 'dsh-home/profiles/web/package.json')],
    })
  })
})
