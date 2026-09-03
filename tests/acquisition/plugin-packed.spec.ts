import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { acquirePluginPacked } from '../../src/acquisition/plugin-packed.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-packed-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface TarEntryInput {
  readonly name: string
  readonly content?: string
  readonly type?: '0' | '2'
  readonly linkName?: string
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`
  buffer.write(encoded, offset, length, 'ascii')
}

function tarEntry(input: TarEntryInput): Buffer {
  const type = input.type ?? '0'
  const content = type === '0' ? Buffer.from(input.content ?? '', 'utf8') : Buffer.alloc(0)
  const header = Buffer.alloc(512)

  writeTarString(header, 0, 100, input.name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, content.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, 'ascii')
  if (input.linkName !== undefined) writeTarString(header, 157, 100, input.linkName)
  writeTarString(header, 257, 6, 'ustar\0')
  writeTarString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')

  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([header, content, padding])
}

function npmTgz(entries: readonly TarEntryInput[]): Buffer {
  return gzipSync(Buffer.concat([
    ...entries.map(tarEntry),
    Buffer.alloc(1024),
  ]))
}

describe('packed plugin acquisition', () => {
  it('reads only normalized npm package manifest and bundle patch bytes without extracting the archive', async () => {
    const root = await fixture()
    const packed = path.join(root, 'example-plugin.tgz')
    await writeFile(packed, npmTgz([
      {
        name: 'package/package.json',
        content: JSON.stringify({
          name: 'example-plugin',
          version: '1.2.3',
          dsh: { bundle: { patch: './cordis.patch.yml' } },
          peerDependencies: { '@deepseek-ai/cordis': '4.0.1' },
          dependencies: { '@deepseek-ai/dsh-agent': '^0.1.1' },
          scripts: { postinstall: 'node ./must-not-run.js' },
        }),
      },
      { name: 'package/cordis.patch.yml', content: '- name: example\n' },
      { name: 'package/must-not-run.js', content: 'throw new Error("executed")\n' },
    ]))

    const acquired = await acquirePluginPacked(packed, createNodeSha256Port())

    expect(acquired).toMatchObject({
      completeness: 'complete',
      packageName: 'example-plugin',
      packageVersion: '1.2.3',
      requirements: [
        {
          packageName: '@deepseek-ai/cordis',
          range: '4.0.1',
          relationship: 'host-peer-required',
        },
        {
          packageName: '@deepseek-ai/dsh-agent',
          range: '^0.1.1',
          relationship: 'artifact-dependency',
        },
      ],
      diagnostics: [],
    })
    expect(acquired.bundlePatchHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(acquired.evidence.map(item => item.id)).toEqual([
      'plugin:packed-artifact',
      'plugin:manifest',
      'plugin:bundle-patch',
    ])
    expect(acquired.evidence[0]).toEqual(expect.objectContaining({
      kind: 'package',
      strength: 'authoritative',
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }))
  })

  it('returns an invalid semantic subject instead of throwing for malformed gzip or tar bytes', async () => {
    const root = await fixture()
    const packed = path.join(root, 'broken.tgz')
    await writeFile(packed, 'not-a-gzip', 'utf8')

    await expect(acquirePluginPacked(packed, createNodeSha256Port())).resolves.toMatchObject({
      completeness: 'invalid',
      requirements: [],
      diagnostics: [{
        code: 'PLUGIN_PACKED_INVALID',
        domain: 'plugin',
        severity: 'error',
      }],
    })
  })

  it('fails closed when package.json is represented by a tar link instead of regular archive bytes', async () => {
    const root = await fixture()
    const packed = path.join(root, 'linked-manifest.tgz')
    await writeFile(packed, npmTgz([
      {
        name: 'package/package.json',
        type: '2',
        linkName: '../outside-package.json',
      },
    ]))

    await expect(acquirePluginPacked(packed, createNodeSha256Port())).resolves.toMatchObject({
      completeness: 'invalid',
      requirements: [],
      evidence: [expect.objectContaining({ id: 'plugin:packed-artifact' })],
      diagnostics: [{
        code: 'PLUGIN_PACKED_INVALID',
        domain: 'plugin',
        severity: 'error',
      }],
    })
  })
})
