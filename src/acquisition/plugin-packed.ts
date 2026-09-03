import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import type { Sha256Port } from '../model/digest.js'
import type {
  AcquiredPluginRequirement,
  AcquiredPluginSubject,
  PluginPackageRelationship,
} from '../model/plugin.js'
import type { Diagnostic, Evidence } from '../protocol/index.js'

const MAX_PACKED_BYTES = 16 * 1024 * 1024
const MAX_TAR_BYTES = 32 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_PATCH_BYTES = 4 * 1024 * 1024
const DEEPSEEK_PACKAGE_PREFIX = '@deepseek-ai/'
const TAR_BLOCK_BYTES = 512
const NPM_PACKAGE_ROOT = 'package/'
const NPM_MANIFEST_PATH = 'package/package.json'

interface TarEntry {
  readonly name: string
  readonly type: string
  readonly content: Buffer
}

interface ParsedArchive {
  readonly entries: ReadonlyMap<string, TarEntry>
}

type BundlePatchDeclaration =
  | { readonly state: 'missing' }
  | { readonly state: 'invalid' }
  | { readonly state: 'present'; readonly value: string }

class PackedArchiveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PackedArchiveError'
  }
}

function diagnostic(
  code: string,
  summary: string,
  locations: readonly string[] = [],
): Diagnostic {
  return Object.freeze({
    code,
    severity: 'error' as const,
    domain: 'plugin',
    summary,
    ...(locations.length === 0 ? {} : { locations: [...locations] }),
  })
}

function invalidSubject(
  code: string,
  summary: string,
  location: string,
  evidence: readonly Evidence[] = [],
): AcquiredPluginSubject {
  return Object.freeze({
    completeness: 'invalid' as const,
    requirements: Object.freeze([]),
    evidence: Object.freeze([...evidence]),
    diagnostics: Object.freeze([diagnostic(code, summary, [location])]),
  })
}

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
  const text = content.toString('utf8')
  let offset = 0
  let pathValue: string | undefined

  while (offset < text.length) {
    const space = text.indexOf(' ', offset)
    if (space === -1) throw new PackedArchiveError('Malformed PAX record')
    const lengthText = text.slice(offset, space)
    if (!/^\d+$/u.test(lengthText)) throw new PackedArchiveError('Malformed PAX record length')
    const recordLength = Number(lengthText)
    if (!Number.isSafeInteger(recordLength) || recordLength <= 0 || offset + recordLength > text.length) {
      throw new PackedArchiveError('Malformed PAX record length')
    }
    const record = text.slice(space + 1, offset + recordLength)
    if (!record.endsWith('\n')) throw new PackedArchiveError('Malformed PAX record')
    const body = record.slice(0, -1)
    const separator = body.indexOf('=')
    if (separator > 0) {
      const key = body.slice(0, separator)
      const value = body.slice(separator + 1)
      if (key === 'path') pathValue = value
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

function parseTar(buffer: Buffer): ParsedArchive {
  if (buffer.length === 0 || buffer.length > MAX_TAR_BYTES || buffer.length % TAR_BLOCK_BYTES !== 0) {
    throw new PackedArchiveError('Invalid tar byte length')
  }

  const entries = new Map<string, TarEntry>()
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
      // Global PAX metadata that does not alter individual entry paths is irrelevant
      // to static plugin acquisition. Parse it only to reject malformed bytes.
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

    if (entries.has(name)) throw new PackedArchiveError(`Duplicate tar entry: ${name}`)
    entries.set(name, Object.freeze({ name, type, content: Buffer.from(content) }))
    offset = nextOffset
  }

  if (!sawEnd) throw new PackedArchiveError('Tar archive has no end marker')
  return Object.freeze({ entries })
}

async function readPackedBytes(location: string): Promise<{ readonly location: string; readonly bytes: Buffer }> {
  let canonicalLocation: string
  try {
    canonicalLocation = await realpath(location)
  } catch (cause) {
    throw new PackedArchiveError('Packed plugin artifact could not be resolved.', { cause })
  }

  let handle
  try {
    handle = await open(canonicalLocation, 'r')
  } catch (cause) {
    throw new PackedArchiveError('Packed plugin artifact could not be opened.', { cause })
  }

  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new PackedArchiveError('Packed plugin artifact must be a regular file.')
    if (stats.size > MAX_PACKED_BYTES) throw new PackedArchiveError('Packed plugin artifact exceeds the acquisition limit.')
    const bytes = await handle.readFile()
    if (bytes.length > MAX_PACKED_BYTES) throw new PackedArchiveError('Packed plugin artifact exceeds the acquisition limit.')
    return Object.freeze({ location: canonicalLocation, bytes })
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function artifactEvidence(location: string, bytes: Buffer): Evidence {
  return Object.freeze({
    id: 'plugin:packed-artifact',
    kind: 'package' as const,
    strength: 'authoritative' as const,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    location,
  })
}

function deepseekRequirements(
  manifest: Record<string, unknown>,
  diagnostics: Diagnostic[],
  manifestLocation: string,
): AcquiredPluginRequirement[] {
  const requirements: AcquiredPluginRequirement[] = []
  const peers = manifest.peerDependencies
  const meta = manifest.peerDependenciesMeta
  const dependencies = manifest.dependencies

  if (peers !== undefined && !isRecord(peers)) {
    diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', 'peerDependencies must be an object when present.', [manifestLocation]))
  }
  if (meta !== undefined && !isRecord(meta)) {
    diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', 'peerDependenciesMeta must be an object when present.', [manifestLocation]))
  }
  if (dependencies !== undefined && !isRecord(dependencies)) {
    diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', 'dependencies must be an object when present.', [manifestLocation]))
  }

  if (isRecord(peers)) {
    for (const [packageName, range] of Object.entries(peers)) {
      if (!packageName.startsWith(DEEPSEEK_PACKAGE_PREFIX)) continue
      if (typeof range !== 'string' || range.length === 0) {
        diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', `Peer requirement ${packageName} must use a non-empty string range.`, [manifestLocation]))
        continue
      }
      let relationship: PluginPackageRelationship = 'host-peer-required'
      if (isRecord(meta) && packageName in meta) {
        const packageMeta = meta[packageName]
        if (!isRecord(packageMeta)) {
          diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', `peerDependenciesMeta.${packageName} must be an object.`, [manifestLocation]))
        } else if ('optional' in packageMeta && typeof packageMeta.optional !== 'boolean') {
          diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', `peerDependenciesMeta.${packageName}.optional must be boolean when present.`, [manifestLocation]))
        } else if (packageMeta.optional === true) {
          relationship = 'host-peer-optional'
        }
      }
      requirements.push(Object.freeze({ packageName, range, relationship }))
    }
  }

  if (isRecord(dependencies)) {
    for (const [packageName, range] of Object.entries(dependencies)) {
      if (!packageName.startsWith(DEEPSEEK_PACKAGE_PREFIX)) continue
      if (typeof range !== 'string' || range.length === 0) {
        diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', `Artifact dependency ${packageName} must use a non-empty string range.`, [manifestLocation]))
        continue
      }
      requirements.push(Object.freeze({ packageName, range, relationship: 'artifact-dependency' as const }))
    }
  }

  return requirements
}

function bundlePatchDeclaration(manifest: Record<string, unknown>): BundlePatchDeclaration {
  const dsh = manifest.dsh
  if (dsh === undefined) return { state: 'missing' }
  if (!isRecord(dsh)) return { state: 'invalid' }
  const bundle = dsh.bundle
  if (bundle === undefined) return { state: 'missing' }
  if (!isRecord(bundle)) return { state: 'invalid' }
  const patch = bundle.patch
  if (patch === undefined) return { state: 'missing' }
  if (typeof patch !== 'string' || patch.length === 0) return { state: 'invalid' }
  return { state: 'present', value: patch }
}

function patchArchivePath(value: string): string | undefined {
  if (value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return undefined
  const relative = path.posix.normalize(value)
  if (relative === '..' || relative.startsWith('../') || relative === '.') return undefined
  const joined = path.posix.normalize(path.posix.join(NPM_PACKAGE_ROOT, relative))
  return joined.startsWith(NPM_PACKAGE_ROOT) ? joined : undefined
}

function completenessForIdentity(
  packageName: string | undefined,
  packageVersion: string | undefined,
  diagnostics: readonly Diagnostic[],
): 'complete' | 'partial' | 'invalid' {
  if (packageName === undefined || packageVersion === undefined) return 'invalid'
  return diagnostics.length === 0 ? 'complete' : 'partial'
}

function regularEntry(
  archive: ParsedArchive,
  entryPath: string,
): TarEntry | undefined {
  const entry = archive.entries.get(entryPath)
  if (entry === undefined) return undefined
  if (entry.type !== '0') throw new PackedArchiveError(`Required archive entry is not a regular file: ${entryPath}`)
  return entry
}

export async function acquirePluginPacked(
  packedPath: string,
  digest: Sha256Port,
): Promise<AcquiredPluginSubject> {
  let packed
  try {
    packed = await readPackedBytes(packedPath)
  } catch {
    return invalidSubject(
      'PLUGIN_PACKED_READ_FAILED',
      'Packed plugin artifact could not be acquired safely.',
      packedPath,
    )
  }

  const packedEvidence = artifactEvidence(packed.location, packed.bytes)
  let archive: ParsedArchive
  try {
    const tar = gunzipSync(packed.bytes, { maxOutputLength: MAX_TAR_BYTES })
    archive = parseTar(tar)
  } catch {
    return invalidSubject(
      'PLUGIN_PACKED_INVALID',
      'Packed plugin artifact is not a valid bounded npm-style .tgz archive.',
      packed.location,
      [packedEvidence],
    )
  }

  let manifestEntry: TarEntry | undefined
  try {
    manifestEntry = regularEntry(archive, NPM_MANIFEST_PATH)
  } catch {
    return invalidSubject(
      'PLUGIN_PACKED_INVALID',
      'Packed plugin package.json must be stored as regular archive bytes.',
      packed.location,
      [packedEvidence],
    )
  }
  if (manifestEntry === undefined || manifestEntry.content.length > MAX_MANIFEST_BYTES) {
    return invalidSubject(
      manifestEntry === undefined ? 'PLUGIN_MANIFEST_READ_FAILED' : 'PLUGIN_MANIFEST_LIMIT_EXCEEDED',
      'Packed plugin package.json could not be acquired.',
      `${packed.location}!/${NPM_MANIFEST_PATH}`,
      [packedEvidence],
    )
  }

  const manifestContent = manifestEntry.content.toString('utf8')
  const manifestLocation = `${packed.location}!/${NPM_MANIFEST_PATH}`
  const manifestEvidence: Evidence = Object.freeze({
    id: 'plugin:manifest',
    kind: 'manifest',
    strength: 'authoritative',
    contentHash: await digest.sha256Utf8(manifestContent),
    location: manifestLocation,
  })

  let manifest: Record<string, unknown>
  try {
    const parsed = JSON.parse(manifestContent) as unknown
    if (!isRecord(parsed)) throw new TypeError('package.json root must be an object')
    manifest = parsed
  } catch {
    return Object.freeze({
      completeness: 'invalid' as const,
      requirements: Object.freeze([]),
      evidence: Object.freeze([packedEvidence, manifestEvidence]),
      diagnostics: Object.freeze([diagnostic(
        'PLUGIN_MANIFEST_INVALID',
        'Packed plugin package.json is not a valid JSON object.',
        [manifestLocation],
      )]),
    })
  }

  const diagnostics: Diagnostic[] = []
  const packageName = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : undefined
  const packageVersion = typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : undefined
  if (packageName === undefined || packageVersion === undefined) {
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'Plugin package.json must declare non-empty name and version strings.',
      [manifestLocation],
    ))
  }

  const requirements = deepseekRequirements(manifest, diagnostics, manifestLocation)
  const evidence: Evidence[] = [packedEvidence, manifestEvidence]
  let bundlePatchHash: string | undefined
  const patch = bundlePatchDeclaration(manifest)

  if (patch.state === 'missing') {
    diagnostics.push(diagnostic('PLUGIN_BUNDLE_PATCH_MISSING', 'Plugin manifest does not declare dsh.bundle.patch.', [manifestLocation]))
  } else if (patch.state === 'invalid') {
    diagnostics.push(diagnostic('PLUGIN_MANIFEST_INVALID', 'dsh.bundle.patch must be a non-empty string when present.', [manifestLocation]))
  } else {
    const patchPath = patchArchivePath(patch.value)
    if (patchPath === undefined) {
      diagnostics.push(diagnostic('PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT', 'dsh.bundle.patch must resolve inside the packed plugin package root.', [patch.value]))
    } else {
      let patchEntry: TarEntry | undefined
      try {
        patchEntry = regularEntry(archive, patchPath)
      } catch {
        diagnostics.push(diagnostic('PLUGIN_PACKED_INVALID', 'Declared dsh.bundle.patch must be stored as regular archive bytes.', [`${packed.location}!/${patchPath}`]))
      }
      if (patchEntry === undefined && !diagnostics.some(item => item.code === 'PLUGIN_PACKED_INVALID')) {
        diagnostics.push(diagnostic('PLUGIN_BUNDLE_PATCH_MISSING', 'Declared dsh.bundle.patch is missing from the packed plugin artifact.', [`${packed.location}!/${patchPath}`]))
      } else if (patchEntry !== undefined) {
        if (patchEntry.content.length > MAX_PATCH_BYTES) {
          diagnostics.push(diagnostic('PLUGIN_BUNDLE_PATCH_LIMIT_EXCEEDED', 'Declared dsh.bundle.patch exceeds the acquisition limit.', [`${packed.location}!/${patchPath}`]))
        } else {
          const patchContent = patchEntry.content.toString('utf8')
          bundlePatchHash = await digest.sha256Utf8(patchContent)
          evidence.push(Object.freeze({
            id: 'plugin:bundle-patch',
            kind: 'composed-config',
            strength: 'authoritative',
            contentHash: bundlePatchHash,
            location: `${packed.location}!/${patchPath}`,
          }))
        }
      }
    }
  }

  return Object.freeze({
    completeness: completenessForIdentity(packageName, packageVersion, diagnostics),
    ...(packageName === undefined ? {} : { packageName }),
    ...(packageVersion === undefined ? {} : { packageVersion }),
    ...(bundlePatchHash === undefined ? {} : { bundlePatchHash }),
    requirements: Object.freeze([...requirements]),
    evidence: Object.freeze([...evidence]),
    diagnostics: Object.freeze([...diagnostics]),
  })
}
