import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createPluginSubjectAcquisition } from '../../src/acquisition/plugin-subject.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-subject-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('plugin subject acquisition dispatch', () => {
  it('dispatches directory and packed kinds to their separate read-only acquisition boundaries', async () => {
    const root = await fixture()
    const directory = path.join(root, 'directory')
    const packed = path.join(root, 'candidate.tgz')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(directory)
    await writeFile(packed, 'not-a-gzip', 'utf8')

    const acquisition = createPluginSubjectAcquisition(createNodeSha256Port())

    await expect(acquisition.acquire({ kind: 'directory', path: directory })).resolves.toMatchObject({
      completeness: 'invalid',
      diagnostics: [{ code: 'PLUGIN_MANIFEST_READ_FAILED' }],
    })
    await expect(acquisition.acquire({ kind: 'packed', path: packed })).resolves.toMatchObject({
      completeness: 'invalid',
      diagnostics: [{ code: 'PLUGIN_PACKED_INVALID' }],
    })
  })
})
