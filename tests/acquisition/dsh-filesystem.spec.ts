import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDshFilesystemTargetAcquisition,
} from '../../src/acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createTargetSemanticProjectionV1,
  fingerprintTarget,
  TargetAcquisitionError,
  type AcquiredTargetFacts,
  type TargetAcquisitionErrorCode,
} from '../../src/model/target.js'

const fixture = fileURLToPath(new URL('../fixtures/targets/valid/', import.meta.url))
const temporaryRoots: string[] = []
const runtime = { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' } as const

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function copyFixture(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `dsh-toolchain-${label}-`))
  temporaryRoots.push(root)
  await cp(fixture, root, { recursive: true })
  return root
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.toSorted((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else result[path.relative(root, absolute).replaceAll('\\', '/')] = (await readFile(absolute)).toString('base64')
    }
  }

  await visit(root)
  return result
}

async function readOnly<T>(root: string, action: () => Promise<T>): Promise<T> {
  const before = await snapshotTree(root)
  try {
    return await action()
  } finally {
    expect(await snapshotTree(root)).toEqual(before)
  }
}

function roots(root: string) {
  return {
    dshHome: path.join(root, 'dsh-home'),
    dshPackageRoot: path.join(root, 'dsh-package'),
  }
}

function acquisition(env: Readonly<Record<string, string | undefined>> = {}) {
  return createDshFilesystemTargetAcquisition({ env, runtime })
}

async function acquire(root: string, profile = 'web'): Promise<AcquiredTargetFacts> {
  return readOnly(root, () => acquisition().acquire({ profile, ...roots(root) }))
}

async function expectAcquisitionError(
  root: string,
  code: TargetAcquisitionErrorCode,
  action: () => Promise<unknown>,
): Promise<TargetAcquisitionError> {
  let caught: unknown
  try {
    await readOnly(root, action)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TargetAcquisitionError)
  expect(caught).toMatchObject({ code })
  return caught as TargetAcquisitionError
}

describe('createDshFilesystemTargetAcquisition', () => {
  it('acquires exact installed target facts and deterministic content-hashed evidence without writes', async () => {
    const root = await copyFixture('success')
    const facts = await acquire(root)

    expect(facts).toMatchObject({
      dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      runtime,
      profile: {
        name: 'web',
        bundles: [
          { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2' },
          { name: 'dsh-toolchain', version: '0.0.0' },
          { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2' },
        ],
        dependencies: [
          { name: 'dsh-toolchain', version: '0.0.0' },
          { name: 'z-user-plugin', version: '2.3.4' },
          { name: 'a-user-plugin', version: '1.2.3' },
        ],
      },
    })
    expect(facts.evidence.map(item => item.id)).toEqual([
      'manifest:dsh',
      'manifest:profile',
      'patch:profile',
      'manifest:bundle:0:@deepseek-ai/dsh-base',
      'manifest:bundle:1:dsh-toolchain',
      'manifest:bundle:2:@deepseek-ai/dsh-web-app',
      'manifest:dependency:dsh-toolchain',
      'manifest:dependency:z-user-plugin',
      'manifest:dependency:a-user-plugin',
    ])
    expect(facts.evidence.every(item =>
      /^[0-9a-f]{64}$/.test(item.contentHash ?? '') && path.isAbsolute(item.location ?? ''),
    )).toBe(true)
    expect(facts.profile.patchHash).toBe(
      createHash('sha256').update('plugins: {}\n', 'utf8').digest('hex'),
    )
  })

  it('keeps equivalent targets stable across absolute roots and observer versions while retaining observer evidence', async () => {
    const leftRoot = await copyFixture('left')
    const rightRoot = await copyFixture('right')
    const observerManifest = path.join(
      rightRoot,
      'dsh-home/profiles/web/node_modules/dsh-toolchain/package.json',
    )
    await writeFile(
      observerManifest,
      '{"name":"dsh-toolchain","version":"7.8.9","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}\n',
      'utf8',
    )

    const left = await acquire(leftRoot)
    const right = await acquire(rightRoot)
    const digest = createNodeSha256Port()
    const leftFingerprint = await fingerprintTarget(createTargetSemanticProjectionV1(left), digest)
    const rightFingerprint = await fingerprintTarget(createTargetSemanticProjectionV1(right), digest)

    expect(right.profile.bundles).toContainEqual({ name: 'dsh-toolchain', version: '7.8.9' })
    expect(right.evidence).toContainEqual(expect.objectContaining({ id: 'manifest:bundle:1:dsh-toolchain' }))
    expect(left.evidence[0]?.location).not.toBe(right.evidence[0]?.location)
    expect(leftFingerprint).toBe(rightFingerprint)
  })

  it('uses DSH_HOME when no request home is supplied and explicit request home takes precedence', async () => {
    const root = await copyFixture('home')
    const provider = acquisition({ DSH_HOME: roots(root).dshHome })
    const fromEnvironment = await readOnly(root, () => provider.acquire({
      profile: 'web',
      dshPackageRoot: roots(root).dshPackageRoot,
    }))
    const fromRequest = await readOnly(root, () => acquisition({ DSH_HOME: 'Z:\\wrong' }).acquire({
      profile: 'web',
      ...roots(root),
    }))

    expect(fromEnvironment.profile.name).toBe('web')
    expect(fromRequest.profile.name).toBe('web')
  })

  it('accepts an upstream-compatible hand-written profile with no dsh section or version', async () => {
    const root = await copyFixture('minimal-profile')
    await writeFile(
      path.join(root, 'dsh-home/profiles/web/package.json'),
      '{"name":"dsh-profile-web","private":true,"dependencies":{}}\n',
      'utf8',
    )

    const facts = await acquire(root)

    expect(facts.profile.bundles).toEqual([])
    expect(facts.profile.dependencies).toEqual([])
  })

  it('accepts a missing patch as a distinct namespaced sentinel and does not create the file', async () => {
    const root = await copyFixture('missing-patch')
    const patch = path.join(root, 'dsh-home/profiles/web/cordis.patch.yml')
    await unlink(patch)

    const facts = await acquire(root)

    expect(facts.profile.patchHash).toBe(
      createHash('sha256').update('dsh-target-v1:profile-patch:absent', 'utf8').digest('hex'),
    )
    expect(facts.evidence).toContainEqual(expect.objectContaining({
      id: 'patch:profile',
      strength: 'observed',
      location: patch,
      contentHash: facts.profile.patchHash,
    }))
  })

  it.each(['.', '..', 'node_modules', '../web', 'nested/web', 'nested\\web'])(
    'rejects invalid profile %s before resolving filesystem paths',
    async profile => {
      const root = await copyFixture('invalid-profile')
      const error = await expectAcquisitionError(root, 'TARGET_PROFILE_INVALID', () =>
        acquisition().acquire({ profile, dshHome: roots(root).dshHome, dshPackageRoot: 'Z:\\missing' }),
      )
      expect(error.locations).toEqual([profile])
    },
  )

  it('reports a missing profile without creating it', async () => {
    const root = await copyFixture('missing-profile')
    const error = await expectAcquisitionError(root, 'TARGET_PROFILE_NOT_FOUND', () =>
      acquisition().acquire({ profile: 'missing', ...roots(root) }),
    )
    expect(error.locations).toEqual([
      path.join(root, 'dsh-home/profiles/missing/package.json'),
    ])
  })

  it.each([
    ['bundle', 'TARGET_BUNDLE_NOT_FOUND', 'dsh-package/node_modules/@deepseek-ai/dsh-web-app/package.json'],
    ['dependency', 'TARGET_DEPENDENCY_NOT_FOUND', 'dsh-home/profiles/web/node_modules/z-user-plugin/package.json'],
  ] as const)('reports a missing %s package with its attempted locations', async (_kind, code, relative) => {
    const root = await copyFixture(`missing-${_kind}`)
    await rm(path.join(root, relative))
    const error = await expectAcquisitionError(root, code, () =>
      acquisition().acquire({ profile: 'web', ...roots(root) }),
    )
    expect(error.locations.length).toBeGreaterThan(0)
    expect(error.locations.every(location => path.isAbsolute(location))).toBe(true)
  })

  it('reports a missing explicit DSH package root', async () => {
    const root = await copyFixture('missing-dsh')
    const missing = path.join(root, 'missing-dsh')
    const error = await expectAcquisitionError(root, 'TARGET_DSH_NOT_FOUND', () =>
      acquisition().acquire({ profile: 'web', dshHome: roots(root).dshHome, dshPackageRoot: missing }),
    )
    expect(error.locations).toEqual([path.join(missing, 'package.json')])
  })

  it('reports malformed package manifests deterministically', async () => {
    const root = await copyFixture('malformed')
    const manifest = path.join(root, 'dsh-home/profiles/web/package.json')
    await writeFile(manifest, '{', 'utf8')
    const error = await expectAcquisitionError(root, 'TARGET_MANIFEST_INVALID', () =>
      acquisition().acquire({ profile: 'web', ...roots(root) }),
    )
    expect(error.locations).toEqual([manifest])
    expect(error.cause).toBeInstanceOf(SyntaxError)
  })

  it('rejects a listed package that does not declare a DSH bundle patch', async () => {
    const root = await copyFixture('bundleless-package')
    const manifest = path.join(
      root,
      'dsh-package/node_modules/@deepseek-ai/dsh-web-app/package.json',
    )
    await writeFile(
      manifest,
      '{"name":"@deepseek-ai/dsh-web-app","version":"0.1.1-rc.2"}\n',
      'utf8',
    )
    const error = await expectAcquisitionError(root, 'TARGET_MANIFEST_INVALID', () =>
      acquisition().acquire({ profile: 'web', ...roots(root) }),
    )
    expect(error.locations).toEqual([manifest])
  })

  it('preserves an unexpected evidence read failure as the typed error cause', async () => {
    const root = await copyFixture('read-failure')
    const patch = path.join(root, 'dsh-home/profiles/web/cordis.patch.yml')
    await rm(patch)
    await mkdir(patch)
    const error = await expectAcquisitionError(root, 'TARGET_EVIDENCE_READ_FAILED', () =>
      acquisition().acquire({ profile: 'web', ...roots(root) }),
    )
    expect(error.locations).toEqual([patch])
    expect(error.cause).toBeDefined()
  })
})
