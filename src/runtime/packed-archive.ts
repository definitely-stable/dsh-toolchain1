import path from 'node:path'
import { TextDecoder } from 'node:util'

export const MAX_PACKED_TAR_BYTES = 32 * 1024 * 1024

const TAR_BLOCK_BYTES = 512
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

export interface PackedArchiveEntry {
  readonly name: string
  readonly type: string
  readonly content: Buffer
}

export interface ParsedPackedArchive {
  readonly entries: ReadonlyMap<string, PackedArchiveEntry>
}

export class PackedArchiveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PackedArchiveError'
  }
}

function decodeUtf8(bytes: Buffer, message: string): string {
  try {
    return UTF8_DECODER.decode(bytes)
  } catch (cause) {
    throw new PackedArchiveError(message, { cause })
  }
}

function decodeTarString(buffer: Buffer, start: number, length: number): string {
  const raw = buffer.subarray(start, start + length)
  const nul = raw.indexOf(0)
  return decodeUtf8(
    raw.subarray(0, nul === -1 ? raw.length : nul),
    'Tar header contains invalid UTF-8 text',
  )
}

function parseTarOctal(buffer: Buffer, start: number, length: number): number {
  const raw = decodeTarString(buffer, start, length).trim()
  if (raw.length === 0) return 0
  if (!/^[0-7]+$/u.test(raw)) throw new PackedArchiveError('Invalid tar octal field')
  const value = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new PackedArchiveError('Invalid tar numeric field')
  return value
}

function isZeroBlock(block: Buffer): boolean {
  return block.every(byte => byte === 0)
}

function verifyTarChecksum(header: Buffer): void {
  const declared = parseTarOctal(header, 148, 8)
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0
  }
  if (declared !== actual) throw new PackedArchiveError('Invalid tar header checksum')
}

function normalizedArchivePath(name: string): string {
  if (
    name.length === 0
    || name.includes('\\')
    || name.includes('\0')
    || path.posix.isAbsolute(name)
  ) throw new PackedArchiveError('Unsafe tar entry path')

  const normalized = path.posix.normalize(name)
  if (
    normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('/')
    || normalized === '.'
  ) throw new PackedArchiveError('Unsafe tar entry path')
  return normalized
}

function parsePaxPath(content: Buffer): string | undefined {
  let offset = 0
  let pathValue: string | undefined

  while (offset < content.length) {
    const space = content.indexOf(0x20, offset)
    if (space === -1) throw new PackedArchiveError('Malformed PAX record')

    const lengthText = content.subarray(offset, space).toString('ascii')
    if (!/^\d+$/u.test(lengthText)) throw new PackedArchiveError('Malformed PAX record length')

    const recordLength = Number(lengthText)
    const recordEnd = offset + recordLength
    if (
      !Number.isSafeInteger(recordLength)
      || recordLength <= 0
      || recordEnd > content.length
      || recordEnd <= space + 1
    ) throw new PackedArchiveError('Malformed PAX record length')

    if (content[recordEnd - 1] !== 0x0a) throw new PackedArchiveError('Malformed PAX record')

    const bodyStart = space + 1
    const bodyEnd = recordEnd - 1
    const separator = content.indexOf(0x3d, bodyStart)
    if (separator > bodyStart && separator < bodyEnd) {
      const key = content.subarray(bodyStart, separator).toString('ascii')
      if (key === 'path') {
        pathValue = decodeUtf8(
          content.subarray(separator + 1, bodyEnd),
          'PAX path contains invalid UTF-8 text',
        )
      }
    }

    offset = recordEnd
  }

  return pathValue
}

function tarHeaderPath(header: Buffer): string {
  const name = decodeTarString(header, 0, 100)
  const prefix = decodeTarString(header, 345, 155)
  return normalizedArchivePath(prefix.length === 0 ? name : `${prefix}/${name}`)
}

function decodeLongName(content: Buffer): string {
  const nul = content.indexOf(0)
  return normalizedArchivePath(decodeUtf8(
    content.subarray(0, nul === -1 ? content.length : nul),
    'GNU long-name entry contains invalid UTF-8 text',
  ))
}

export function parsePackedTarArchive(buffer: Buffer): ParsedPackedArchive {
  if (
    buffer.length === 0
    || buffer.length > MAX_PACKED_TAR_BYTES
    || buffer.length % TAR_BLOCK_BYTES !== 0
  ) throw new PackedArchiveError('Invalid tar byte length')

  const entries = new Map<string, PackedArchiveEntry>()
  let offset = 0
  let pendingPaxPath: string | undefined
  let pendingLongName: string | undefined
  let sawEnd = false

  while (offset + TAR_BLOCK_BYTES <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (isZeroBlock(header)) {
      sawEnd = true
      break
    }

    verifyTarChecksum(header)
    const size = parseTarOctal(header, 124, 12)
    const typeByte = header[156] ?? 0
    const type = typeByte === 0 ? '0' : String.fromCharCode(typeByte)
    const contentStart = offset + TAR_BLOCK_BYTES
    const contentEnd = contentStart + size
    if (contentEnd > buffer.length) throw new PackedArchiveError('Tar entry exceeds archive bounds')

    const content = buffer.subarray(contentStart, contentEnd)
    const padded = Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
    const nextOffset = contentStart + padded
    if (nextOffset > buffer.length) throw new PackedArchiveError('Tar padding exceeds archive bounds')

    if (type === 'x') {
      pendingPaxPath = parsePaxPath(content)
      offset = nextOffset
      continue
    }
    if (type === 'g') {
      parsePaxPath(content)
      offset = nextOffset
      continue
    }
    if (type === 'L') {
      pendingLongName = decodeLongName(content)
      offset = nextOffset
      continue
    }

    const name = normalizedArchivePath(pendingPaxPath ?? pendingLongName ?? tarHeaderPath(header))
    pendingPaxPath = undefined
    pendingLongName = undefined

    if (entries.has(name)) throw new PackedArchiveError(`Duplicate tar entry: ${name}`)
    entries.set(name, Object.freeze({
      name,
      type,
      content: Buffer.from(content),
    }))
    offset = nextOffset
  }

  if (!sawEnd) throw new PackedArchiveError('Tar archive has no end marker')
  return Object.freeze({ entries })
}
