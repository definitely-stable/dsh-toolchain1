import path from 'node:path'
import { gunzipSync } from 'node:zlib'

const MAX_TAR_BYTES = 32 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const TAR_BLOCK_BYTES = 512
const NPM_PACKAGE_ROOT = 'package/'
const NPM_MANIFEST_PATH = 'package/package.json'

interface TarEntryView {
  readonly name: string
  readonly type: string
  readonly content: Buffer
}

export type PackedArtifactRuntimeEntrypointInspection =
  | { readonly status: 'present'; readonly entrypoint: string }
  | { readonly status: 'missing'; readonly entrypoint: string }
  | { readonly status: 'not-checkable' }

class PackedArtifactInspectionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodeTarString(buffer: Buffer, start: number, length: number): string {
  const raw = buffer.subarray(start, start + length)
  const nul = raw.indexOf(0)
  return raw.subarray(0, nul === -1 ? raw.length : nul).toString('utf8').trimEnd()
}

function parseTarOctal(buffer: Buffer, start: number, length: number): number {
  const raw = decodeTarString(buffer, start, length).trim()
  if (raw.length === 0) return 0
  if (!/^[0-7]+$/u.test(raw)) throw new PackedArtifactInspectionError('Invalid tar octal field')
  const value = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PackedArtifactInspectionError('Invalid tar numeric field')
  }
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
  if (declared !== actual) throw new PackedArtifactInspectionError('Invalid tar header checksum')
}

function normalizedArchivePath(name: string): string {
  if (
    name.length === 0
    || name.includes('\\')
    || name.includes('\0')
    || path.posix.isAbsolute(name)
  ) throw new PackedArtifactInspectionError('Unsafe tar entry path')

  const normalized = path.posix.normalize(name)
  if (
    normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('/')
    || normalized === '.'
  ) throw new PackedArtifactInspectionError('Unsafe tar entry path')
  return normalized
}

function parsePaxPath(content: Buffer): string | undefined {
  const text = content.toString('utf8')
  let offset = 0
  let pathValue: string | undefined

  while (offset < text.length) {
    const space = text.indexOf(' ', offset)
    if (space === -1) throw new PackedArtifactInspectionError('Malformed PAX record')
    const lengthText = text.slice(offset, space)
    if (!/^\d+$/u.test(lengthText)) throw new PackedArtifactInspectionError('Malformed PAX record length')
    const recordLength = Number(lengthText)
    if (!Number.isSafeInteger(recordLength) || recordLength <= 0 || offset + recordLength > text.length) {
      throw new PackedArtifactInspectionError('Malformed PAX record length')
    }
    const record = text.slice(space + 1, offset + recordLength)
    if (!record.endsWith('\n')) throw new PackedArtifactInspectionError('Malformed PAX record')
    const body = record.slice(0, -1)
    const separator = body.indexOf('=')
    if (separator > 0 && body.slice(0, separator) === 'path') {
      pathValue = body.slice(separator + 1)
    }
    offset += recordLength
  }

  return pathValue
}

function tarHeaderPath(header: Buffer): string {
  const name = decodeTarString(header, 0, 100)
  const prefix = decodeTarString(header, 345, 155)
  return normalizedArchivePath(prefix.length === 0 ? name : `${prefix}/${name}`)
}

function parseTar(buffer: Buffer): ReadonlyMap<string, TarEntryView> {
  if (buffer.length === 0 || buffer.length > MAX_TAR_BYTES || buffer.length % TAR_BLOCK_BYTES !== 0) {
    throw new PackedArtifactInspectionError('Invalid tar byte length')
  }

  const entries = new Map<string, TarEntryView>()
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
    if (contentEnd > buffer.length) throw new PackedArtifactInspectionError('Tar entry exceeds archive bounds')
    const content = buffer.subarray(contentStart, contentEnd)
    const padded = Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
    const nextOffset = contentStart + padded
    if (nextOffset > buffer.length) throw new PackedArtifactInspectionError('Tar padding exceeds archive bounds')

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
      const nul = content.indexOf(0)
      const raw = content.subarray(0, nul === -1 ? content.length : nul).toString('utf8').trimEnd()
      pendingLongName = normalizedArchivePath(raw)
      offset = nextOffset
      continue
    }

    const name = normalizedArchivePath(pendingPaxPath ?? pendingLongName ?? tarHeaderPath(header))
    pendingPaxPath = undefined
    pendingLongName = undefined
    if (entries.has(name)) throw new PackedArtifactInspectionError(`Duplicate tar entry: ${name}`)
    entries.set(name, Object.freeze({ name, type, content: Buffer.from(content) }))
    offset = nextOffset
  }

  if (!sawEnd) throw new PackedArtifactInspectionError('Tar archive has no end marker')
  return entries
}

function declaredRuntimeEntrypoint(manifest: Record<string, unknown>): string | undefined {
  const exportsValue = manifest.exports
  if (exportsValue !== undefined) {
    if (typeof exportsValue === 'string' && exportsValue.length > 0) return exportsValue
    if (isRecord(exportsValue)) {
      const rootExport = exportsValue['.']
      if (typeof rootExport === 'string' && rootExport.length > 0) return rootExport
    }
    return undefined
  }

  const main = manifest.main
  return typeof main === 'string' && main.length > 0 ? main : undefined
}

function entrypointArchivePath(value: string): string | undefined {
  if (
    value.includes('\\')
    || value.includes('\0')
    || value.includes('*')
    || path.posix.isAbsolute(value)
  ) return undefined

  const withoutDot = value.startsWith('./') ? value.slice(2) : value
  const normalized = path.posix.normalize(withoutDot)
  if (
    normalized.length === 0
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.startsWith('/')
    || path.posix.extname(normalized).length === 0
  ) return undefined

  const joined = path.posix.normalize(path.posix.join(NPM_PACKAGE_ROOT, normalized))
  return joined.startsWith(NPM_PACKAGE_ROOT) ? joined : undefined
}

/**
 * Adds one conservative package-integrity check over archive bytes that packed
 * acquisition has already validated. Only unambiguous file entrypoints are
 * checked; conditional exports and extension/directory resolution are left to
 * the runtime rather than guessed by Toolchain.
 */
export function inspectPackedArtifactRuntimeEntrypoint(
  packedBytes: Uint8Array,
): PackedArtifactRuntimeEntrypointInspection {
  const bytes = Buffer.from(packedBytes)
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Object.freeze({ status: 'not-checkable' as const })

  try {
    const tar = gunzipSync(bytes, { maxOutputLength: MAX_TAR_BYTES })
    const entries = parseTar(tar)
    const manifestEntry = entries.get(NPM_MANIFEST_PATH)
    if (
      manifestEntry === undefined
      || manifestEntry.type !== '0'
      || manifestEntry.content.length > MAX_MANIFEST_BYTES
    ) return Object.freeze({ status: 'not-checkable' as const })

    const parsed = JSON.parse(manifestEntry.content.toString('utf8')) as unknown
    if (!isRecord(parsed)) return Object.freeze({ status: 'not-checkable' as const })
    const declared = declaredRuntimeEntrypoint(parsed)
    if (declared === undefined) return Object.freeze({ status: 'not-checkable' as const })
    const entrypoint = entrypointArchivePath(declared)
    if (entrypoint === undefined) return Object.freeze({ status: 'not-checkable' as const })

    const runtimeEntry = entries.get(entrypoint)
    if (runtimeEntry === undefined) {
      return Object.freeze({ status: 'missing' as const, entrypoint })
    }
    if (runtimeEntry.type !== '0') return Object.freeze({ status: 'not-checkable' as const })
    return Object.freeze({ status: 'present' as const, entrypoint })
  } catch {
    return Object.freeze({ status: 'not-checkable' as const })
  }
}
