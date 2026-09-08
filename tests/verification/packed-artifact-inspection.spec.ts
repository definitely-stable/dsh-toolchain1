import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { inspectPackedArtifactRuntimeEntrypoint } from '../../src/verification/packed-artifact-inspection.js'

interface TarEntryInput {
  readonly name: string
  readonly content: string
  readonly type?: string
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`
  buffer.write(encoded, offset, length, 'ascii')
}

function tarEntry(input: TarEntryInput): Buffer {
  const content = Buffer.from(input.content, 'utf8')
  const header = Buffer.alloc(512)

  writeTarString(header, 0, 100, input.name)
  writeTarOctal(header, 100, 8, 0o644)
  writeTarOctal(header, 108, 8, 0)
  writeTarOctal(header, 116, 8, 0)
  writeTarOctal(header, 124, 12, content.length)
  writeTarOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header.write(input.type ?? '0', 156, 1, 'ascii')
  writeTarString(header, 257, 6, 'ustar\0')
  writeTarString(header, 263, 2, '00')

  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')

  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([header, content, padding])
}

function paxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`
  let length = Buffer.byteLength(body) + 2
  for (;;) {
    const record = `${length} ${body}`
    const byteLength = Buffer.byteLength(record)
    if (byteLength === length) return record
    length = byteLength
  }
}

function npmTgz(entries: readonly TarEntryInput[]): Buffer {
  return gzipSync(Buffer.concat([
    ...entries.map(tarEntry),
    Buffer.alloc(1024),
  ]))
}

function artifact(manifest: Record<string, unknown>, runtimeFiles: readonly string[]): Buffer {
  return npmTgz([
    { name: 'package/package.json', content: JSON.stringify(manifest) },
    { name: 'package/cordis.patch.yml', content: '- insert: []\n' },
    ...runtimeFiles.map(name => ({ name: `package/${name}`, content: 'export function apply() {}\n' })),
  ])
}

describe('packed artifact runtime entrypoint inspection', () => {
  it('proves an explicit main entrypoint from the exact archive membership', () => {
    const bytes = artifact({
      name: 'candidate',
      version: '1.0.0',
      type: 'module',
      main: 'plugin.mjs',
    }, ['plugin.mjs'])

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({
      status: 'present',
      entrypoint: 'package/plugin.mjs',
    })
  })

  it('detects an explicit main entrypoint omitted from the packed artifact', () => {
    const bytes = artifact({
      name: 'candidate',
      version: '1.0.0',
      type: 'module',
      main: 'plugin.mjs',
    }, [])

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({
      status: 'missing',
      entrypoint: 'package/plugin.mjs',
    })
  })

  it('detects a simple root exports target omitted from the packed artifact', () => {
    const bytes = artifact({
      name: 'candidate',
      version: '1.0.0',
      type: 'module',
      exports: './plugin.mjs',
    }, [])

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({
      status: 'missing',
      entrypoint: 'package/plugin.mjs',
    })
  })

  it('does not reinterpret invalid exports targets as package-relative files', () => {
    for (const exportsValue of ['plugin.mjs', './dist/../plugin.mjs']) {
      const bytes = artifact({
        name: 'candidate',
        version: '1.0.0',
        type: 'module',
        exports: exportsValue,
      }, [])

      expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({ status: 'not-checkable' })
    }
  })

  it('does not reinterpret URL-suffixed exports targets as literal archive member paths', () => {
    for (const exportsValue of ['./plugin.mjs?mode=dsh', './plugin.mjs#runtime']) {
      for (const runtimeFiles of [['plugin.mjs'], []] as const) {
        const bytes = artifact({
          name: 'candidate',
          version: '1.0.0',
          type: 'module',
          exports: exportsValue,
        }, runtimeFiles)

        expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({ status: 'not-checkable' })
      }
    }
  })

  it('does not guess conditional exports that require Node condition resolution', () => {
    const bytes = artifact({
      name: 'candidate',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './plugin.mjs', require: './plugin.cjs' } },
    }, [])

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({ status: 'not-checkable' })
  })

  it('uses PAX byte lengths when a UTF-8 path maps the runtime entry', () => {
    const runtimePath = 'package/café/plugin.mjs'
    const bytes = npmTgz([
      {
        name: 'package/package.json',
        content: JSON.stringify({
          name: 'candidate',
          version: '1.0.0',
          type: 'module',
          main: 'café/plugin.mjs',
        }),
      },
      { name: 'package/cordis.patch.yml', content: '- insert: []\n' },
      { name: 'PaxHeaders.0/plugin.mjs', type: 'x', content: paxRecord('path', runtimePath) },
      { name: 'package/placeholder.mjs', content: 'export function apply() {}\n' },
    ])

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({
      status: 'present',
      entrypoint: runtimePath,
    })
  })

  it('distinguishes malformed archive inspection from intentional deferral', () => {
    const bytes = gzipSync(Buffer.from('not a bounded tar archive', 'utf8'))

    expect(inspectPackedArtifactRuntimeEntrypoint(bytes)).toEqual({ status: 'failed' })
  })
})
