import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDshFilesystemTargetAcquisition } from '../../src/acquisition/dsh-filesystem.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function writeJson(location: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(location), { recursive: true })
  await writeFile(location, `${JSON.stringify(value, undefined, 2)}\n`, 'utf8')
}

describe('pnpm-linked DSH installation acquisition', () => {
  it('resolves installation bundles and their patches from the real package anchor without a healed home fallback', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-pnpm-layout-'))
    temporaryRoots.push(root)

    const version = '0.1.1-rc.2'
    const modules = path.join(root, '.pnpm', `@deepseek-ai+dsh@${version}`, 'node_modules')
    const realDsh = path.join(modules, '@deepseek-ai', 'dsh')
    const dshLink = path.join(root, 'runner', 'node_modules', '@deepseek-ai', 'dsh')
    const home = path.join(root, 'dsh-home')
    const profile = path.join(home, 'profiles', 'headless')

    await writeJson(path.join(realDsh, 'package.json'), {
      name: '@deepseek-ai/dsh',
      version,
    })
    for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']) {
      const bundleRoot = path.join(modules, name)
      await writeJson(path.join(bundleRoot, 'package.json'), {
        name,
        version,
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      })
      await writeFile(path.join(bundleRoot, 'cordis.patch.yml'), `# ${name}\n[]\n`, 'utf8')
    }
    await writeJson(path.join(profile, 'package.json'), {
      name: 'dsh-profile-headless',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    })
    await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')

    await mkdir(path.dirname(dshLink), { recursive: true })
    await symlink(realDsh, dshLink, 'dir')

    const facts = await createDshFilesystemTargetAcquisition({
      env: {},
      runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    }).acquire({
      profile: 'headless',
      dshHome: home,
      dshPackageRoot: dshLink,
    })

    expect(facts.dsh.version).toBe(version)
    expect(facts.profile.bundles).toEqual([
      expect.objectContaining({
        name: '@deepseek-ai/dsh-base',
        version,
        patchHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      expect.objectContaining({
        name: '@deepseek-ai/dsh-headless',
        version,
        patchHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
  })
})
