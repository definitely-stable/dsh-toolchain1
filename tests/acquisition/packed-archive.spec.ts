import { describe, expect, it } from 'vitest'

import {
  PackedArchiveError,
  parsePackedTarArchive,
} from '../../src/acquisition/packed-archive.js'

interface TarEntryInput {
  readonly name: string
  readonly content?: string
  readonly type?: string
}

function writeTarString(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeTarOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii')
}

function tarEntry(input: TarEntryInput): Buffer {
  const content = Buffer.from(input.content ?? '', 'utf8')
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

  return Buffer.concat([
    header,
    content,
    Buffer.alloc((512 - (content.length % 512)) % 512),
  ])
}

function tar(entries: readonly TarEntryInput[]): Buffer {
  return Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024)])
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

describe('bounded packed archive index', () => {
  it('parses PAX lengths as bytes for UTF-8 member paths', () => {
    const resolved = 'package/данные/plugin.mjs'
    const archive = parsePackedTarArchive(tar([
      { name: 'PaxHeaders.0/plugin', type: 'x', content: paxRecord('path', resolved) },
      { name: 'package/placeholder.mjs', content: 'export {}\n' },
    ]))

    expect([...archive.entries.keys()]).toEqual([resolved])
    expect(archive.entries.get(resolved)?.content.toString('utf8')).toBe('export {}\n')
  })

  it('preserves meaningful trailing spaces in archive member names', () => {
    const name = 'package/runtime.mjs '
    const archive = parsePackedTarArchive(tar([{ name, content: 'export {}\n' }]))

    expect(archive.entries.has(name)).toBe(true)
    expect(archive.entries.has(name.trimEnd())).toBe(false)
  })

  it('applies GNU long-name records without trimming the resolved path', () => {
    const longName = `package/${'nested/'.repeat(16)}plugin.mjs`
    const archive = parsePackedTarArchive(tar([
      { name: '././@LongLink', type: 'L', content: `${longName}\0` },
      { name: 'package/placeholder.mjs', content: 'export {}\n' },
    ]))

    expect([...archive.entries.keys()]).toEqual([longName])
  })

  it('rejects duplicate canonical member paths', () => {
    expect(() => parsePackedTarArchive(tar([
      { name: 'package/sub/../plugin.mjs', content: 'first\n' },
      { name: 'package/plugin.mjs', content: 'second\n' },
    ]))).toThrow(PackedArchiveError)
  })
})
