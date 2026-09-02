import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { acquirePluginDirectory } from '../../src/acquisition/plugin-directory.js'
import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-plugin-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('plugin directory acquisition', () => {
  it('normalizes host peers, optional peers and artifact dependencies without executing candidate code', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'cordis.patch.yml'), '- name: example\n', 'utf8')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.2.3',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      peerDependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
        '@deepseek-ai/dsh-tools': '^0.1.1',
        react: '^19.0.0',
      },
      peerDependenciesMeta: {
        '@deepseek-ai/dsh-tools': { optional: true },
      },
      dependencies: {
        '@deepseek-ai/dsh-agent': '^0.1.1',
        lodash: '^4.17.0',
      },
      scripts: {
        postinstall: 'node ./must-not-run.js',
      },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired.completeness).toBe('complete')
    expect(acquired.packageName).toBe('example-plugin')
    expect(acquired.packageVersion).toBe('1.2.3')
    expect(acquired.bundlePatchHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(acquired.requirements).toEqual([
      {
        packageName: '@deepseek-ai/cordis',
        range: '^4.0.1',
        relationship: 'host-peer-required',
      },
      {
        packageName: '@deepseek-ai/dsh-tools',
        range: '^0.1.1',
        relationship: 'host-peer-optional',
      },
      {
        packageName: '@deepseek-ai/dsh-agent',
        range: '^0.1.1',
        relationship: 'artifact-dependency',
      },
    ])
    expect(acquired.diagnostics).toEqual([])
    expect(acquired.evidence.map(item => item.id)).toEqual([
      'plugin:manifest',
      'plugin:bundle-patch',
    ])
  })

  it('rejects a present non-boolean peerDependenciesMeta optional value without weakening the peer requirement', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'cordis.patch.yml'), '- name: example\n', 'utf8')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      peerDependencies: {
        '@deepseek-ai/cordis': '^4.0.1',
      },
      peerDependenciesMeta: {
        '@deepseek-ai/cordis': { optional: 'yes' },
      },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired.completeness).toBe('partial')
    expect(acquired.requirements).toContainEqual({
      packageName: '@deepseek-ai/cordis',
      range: '^4.0.1',
      relationship: 'host-peer-required',
    })
    expect(acquired.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_MANIFEST_INVALID',
      domain: 'plugin',
      severity: 'error',
    }))
  })

  it('returns an invalid semantic subject instead of throwing when package.json is missing', async () => {
    const root = await fixture()

    await expect(acquirePluginDirectory(root, createNodeSha256Port())).resolves.toMatchObject({
      completeness: 'invalid',
      requirements: [],
      diagnostics: [{
        code: 'PLUGIN_MANIFEST_READ_FAILED',
        domain: 'plugin',
        severity: 'error',
      }],
    })
  })

  it('returns an invalid semantic subject instead of throwing for malformed JSON', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'package.json'), '{broken', 'utf8')

    await expect(acquirePluginDirectory(root, createNodeSha256Port())).resolves.toMatchObject({
      completeness: 'invalid',
      diagnostics: [{
        code: 'PLUGIN_MANIFEST_INVALID',
        domain: 'plugin',
        severity: 'error',
      }],
    })
  })

  it('distinguishes a malformed present dsh.bundle.patch from a missing declaration', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: 42 } },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired.completeness).toBe('partial')
    expect(acquired.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_MANIFEST_INVALID',
      domain: 'plugin',
      severity: 'error',
    }))
    expect(acquired.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'PLUGIN_BUNDLE_PATCH_MISSING',
    }))
  })

  it('preserves valid manifest identity but reports a bundle patch escaping the subject root', async () => {
    const parent = await fixture()
    const root = path.join(parent, 'plugin')
    await mkdir(root)
    await writeFile(path.join(parent, 'outside.yml'), '- name: outside\n', 'utf8')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: '../outside.yml' } },
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired).toMatchObject({
      completeness: 'partial',
      packageName: 'example-plugin',
      packageVersion: '1.0.0',
      diagnostics: [{
        code: 'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT',
        domain: 'plugin',
        severity: 'error',
      }],
    })
    expect(acquired.bundlePatchHash).toBeUndefined()
    expect(acquired.requirements).toHaveLength(1)
  })

  it('rejects a lexically contained bundle patch whose symlink or junction resolves outside the subject root', async () => {
    const parent = await fixture()
    const root = path.join(parent, 'plugin')
    const outside = path.join(parent, 'outside')
    const linked = path.join(root, 'linked')
    await mkdir(root)
    await mkdir(outside)
    await writeFile(path.join(outside, 'cordis.patch.yml'), '- name: outside\n', 'utf8')
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir')
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './linked/cordis.patch.yml' } },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired.completeness).toBe('partial')
    expect(acquired.bundlePatchHash).toBeUndefined()
    expect(acquired.evidence.map(item => item.id)).toEqual(['plugin:manifest'])
    expect(acquired.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT',
      domain: 'plugin',
      severity: 'error',
    }))
  })

  it('keeps independently valid manifest facts when the declared bundle patch is missing', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'example-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: './missing.patch.yml' } },
      dependencies: { '@deepseek-ai/dsh-agent': '^0.1.1' },
    }), 'utf8')

    const acquired = await acquirePluginDirectory(root, createNodeSha256Port())

    expect(acquired).toMatchObject({
      completeness: 'partial',
      packageName: 'example-plugin',
      packageVersion: '1.0.0',
      requirements: [{
        packageName: '@deepseek-ai/dsh-agent',
        range: '^0.1.1',
        relationship: 'artifact-dependency',
      }],
      diagnostics: [{
        code: 'PLUGIN_BUNDLE_PATCH_MISSING',
        domain: 'plugin',
        severity: 'error',
      }],
    })
  })
})