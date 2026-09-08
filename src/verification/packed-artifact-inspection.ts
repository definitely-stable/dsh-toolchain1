import path from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  MAX_PACKED_TAR_BYTES,
  parsePackedTarArchive,
} from '../acquisition/packed-archive.js'

const MAX_MANIFEST_BYTES = 1024 * 1024
const NPM_PACKAGE_ROOT = 'package/'
const NPM_MANIFEST_PATH = 'package/package.json'

type DeclaredRuntimeEntrypoint =
  | { readonly kind: 'exports'; readonly value: string }
  | { readonly kind: 'main'; readonly value: string }

export type PackedArtifactRuntimeEntrypointInspection =
  | { readonly status: 'present'; readonly entrypoint: string }
  | { readonly status: 'missing'; readonly entrypoint: string }
  | { readonly status: 'not-checkable' }
  | { readonly status: 'failed' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function declaredRuntimeEntrypoint(manifest: Record<string, unknown>): DeclaredRuntimeEntrypoint | undefined {
  const exportsValue = manifest.exports
  if (exportsValue !== undefined) {
    if (typeof exportsValue === 'string' && exportsValue.length > 0) {
      return Object.freeze({ kind: 'exports' as const, value: exportsValue })
    }
    if (isRecord(exportsValue)) {
      const rootExport = exportsValue['.']
      if (typeof rootExport === 'string' && rootExport.length > 0) {
        return Object.freeze({ kind: 'exports' as const, value: rootExport })
      }
    }
    return undefined
  }

  const main = manifest.main
  return typeof main === 'string' && main.length > 0
    ? Object.freeze({ kind: 'main' as const, value: main })
    : undefined
}

function hasInvalidExportsSegment(value: string): boolean {
  if (!value.startsWith('./')) return true
  const relative = value.slice(2)
  if (
    relative.length === 0
    || relative.includes('%')
    || relative.includes('?')
    || relative.includes('#')
  ) return true
  return relative.split('/').some(segment =>
    segment.length === 0
    || segment === '.'
    || segment === '..'
    || segment.toLowerCase() === 'node_modules')
}

function entrypointArchivePath(declared: DeclaredRuntimeEntrypoint): string | undefined {
  const { kind, value } = declared
  if (
    value.includes('\\')
    || value.includes('\0')
    || value.includes('*')
    || path.posix.isAbsolute(value)
    || (kind === 'exports' && hasInvalidExportsSegment(value))
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
 *
 * `not-checkable` is reserved for intentional deferral. A malformed archive or
 * manifest is an inspection fault and returns `failed` so the worker can fail
 * the package stage closed rather than silently strengthening the claim.
 */
export function inspectPackedArtifactRuntimeEntrypoint(
  packedBytes: Uint8Array,
): PackedArtifactRuntimeEntrypointInspection {
  const bytes = Buffer.from(packedBytes)
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return Object.freeze({ status: 'not-checkable' as const })

  try {
    const tar = gunzipSync(bytes, { maxOutputLength: MAX_PACKED_TAR_BYTES })
    const archive = parsePackedTarArchive(tar)
    const manifestEntry = archive.entries.get(NPM_MANIFEST_PATH)
    if (
      manifestEntry === undefined
      || manifestEntry.type !== '0'
      || manifestEntry.content.length > MAX_MANIFEST_BYTES
    ) return Object.freeze({ status: 'failed' as const })

    const parsed = JSON.parse(manifestEntry.content.toString('utf8')) as unknown
    if (!isRecord(parsed)) return Object.freeze({ status: 'failed' as const })

    const declared = declaredRuntimeEntrypoint(parsed)
    if (declared === undefined) return Object.freeze({ status: 'not-checkable' as const })

    const entrypoint = entrypointArchivePath(declared)
    if (entrypoint === undefined) return Object.freeze({ status: 'not-checkable' as const })

    const runtimeEntry = archive.entries.get(entrypoint)
    if (runtimeEntry === undefined) {
      return Object.freeze({ status: 'missing' as const, entrypoint })
    }
    if (runtimeEntry.type !== '0') return Object.freeze({ status: 'not-checkable' as const })
    return Object.freeze({ status: 'present' as const, entrypoint })
  } catch {
    return Object.freeze({ status: 'failed' as const })
  }
}
