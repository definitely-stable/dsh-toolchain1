import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { captureConventionalPackageFiles } from '../../scripts/m2-ordinary-evidence.mjs'

const roots: string[] = []

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

async function put(root: string, relativePath: string, content: string | Uint8Array): Promise<string> {
  const location = join(root, relativePath)
  await mkdir(dirname(location), { recursive: true })
  await writeFile(location, content)
  return location
}

async function syntheticPackage(root: string): Promise<{ root: string; declarations: string[] }> {
  await put(root, 'package.json', JSON.stringify({
    name: '@deepseek-ai/example',
    version: '1.2.3',
    types: './types/index.d.ts',
  }, undefined, 2) + '\n')
  const entry = await put(root, 'types/index.d.ts', "export * from './public.js'\n")
  const publicDeclaration = await put(root, 'types/public.d.ts', 'export interface PublicApi { ok: true }\n')
  await put(root, 'types/private.d.ts', 'export interface PrivateApi { secret: true }\n')
  await put(root, 'index.js', 'export const runtime = true\n')
  await put(root, 'index.js.map', '{}\n')
  await put(root, '.env', 'TOKEN=secret\n')
  await put(root, 'credentials.json', '{"token":"secret"}\n')
  await put(root, 'README.md', '# Example\n')
  await put(root, 'CHANGELOG.md', '# Changes\n')
  await put(root, 'docs/guide.md', '# Guide\n')
  await put(root, 'docs/nested/example.txt', 'plain text\n')
  await put(root, 'docs/evaluation/m2/api-oracle-v1.json', '{"leak":true}\n')
  await put(root, 'docs/image.bin', new Uint8Array([0xff, 0xfe, 0x00, 0x01]))
  return { root, declarations: [entry, publicDeclaration] }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('M2.3 conventional rc.2 fixture capture policy', () => {
  it('captures only manifest, production-approved declarations, and safe conventional docs', async () => {
    const packageRoot = await tempRoot('dsh-m2-ordinary-package-')
    const fixture = await syntheticPackage(packageRoot)

    const files = await captureConventionalPackageFiles({
      name: '@deepseek-ai/example',
      version: '1.2.3',
      packageRoot: fixture.root,
      declarationLocations: fixture.declarations,
    })

    expect(files.map(file => file.path)).toEqual([
      '/exact-target/node_modules/@deepseek-ai/example/CHANGELOG.md',
      '/exact-target/node_modules/@deepseek-ai/example/README.md',
      '/exact-target/node_modules/@deepseek-ai/example/docs/guide.md',
      '/exact-target/node_modules/@deepseek-ai/example/docs/nested/example.txt',
      '/exact-target/node_modules/@deepseek-ai/example/package.json',
      '/exact-target/node_modules/@deepseek-ai/example/types/index.d.ts',
      '/exact-target/node_modules/@deepseek-ai/example/types/public.d.ts',
    ])
    expect(files.some(file => file.path.endsWith('private.d.ts'))).toBe(false)
    expect(files.some(file => /index\.js(?:\.map)?$/u.test(file.path))).toBe(false)
    expect(files.some(file => /\.env|credentials|api-oracle|image\.bin/u.test(file.path))).toBe(false)
    expect(files.find(file => file.path.endsWith('package.json'))?.mediaType).toBe('application/json')
    expect(files.filter(file => file.path.endsWith('.d.ts')).every(file => file.mediaType === 'text/typescript')).toBe(true)
  })

  it('is independent of absolute installation root', async () => {
    const firstRoot = await tempRoot('dsh-m2-ordinary-a-')
    const secondRoot = await tempRoot('dsh-m2-ordinary-b-')
    const first = await syntheticPackage(firstRoot)
    const second = await syntheticPackage(secondRoot)

    const left = await captureConventionalPackageFiles({
      name: '@deepseek-ai/example',
      version: '1.2.3',
      packageRoot: first.root,
      declarationLocations: first.declarations,
    })
    const right = await captureConventionalPackageFiles({
      name: '@deepseek-ai/example',
      version: '1.2.3',
      packageRoot: second.root,
      declarationLocations: second.declarations,
    })

    expect(right).toEqual(left)
  })

  it('rejects a production declaration location that escapes the canonical package root through a symlink', async () => {
    const packageRoot = await tempRoot('dsh-m2-ordinary-symlink-')
    const outside = await tempRoot('dsh-m2-ordinary-outside-')
    await put(packageRoot, 'package.json', '{"name":"@deepseek-ai/example","version":"1.2.3"}\n')
    await put(outside, 'outside.d.ts', 'export interface Escaped {}\n')
    await mkdir(join(packageRoot, 'types'), { recursive: true })
    await symlink(join(outside, 'outside.d.ts'), join(packageRoot, 'types', 'escape.d.ts'))

    await expect(captureConventionalPackageFiles({
      name: '@deepseek-ai/example',
      version: '1.2.3',
      packageRoot,
      declarationLocations: [join(packageRoot, 'types', 'escape.d.ts')],
    })).rejects.toThrow(/escape|symlink|package root/i)
  })
})
