import { open, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { Sha256Port } from '../model/digest.js'
import type {
  AcquiredPluginRequirement,
  AcquiredPluginSubject,
  PluginPackageRelationship,
  PluginSubjectAcquisitionPort,
} from '../model/plugin.js'
import type { Diagnostic, Evidence, PluginSubjectRequest } from '../protocol/index.js'

const MAX_PLUGIN_MANIFEST_BYTES = 1024 * 1024
const MAX_PLUGIN_BUNDLE_PATCH_BYTES = 4 * 1024 * 1024
const DEEPSEEK_PACKAGE_PREFIX = '@deepseek-ai/'

class SubjectReadError extends Error {
  readonly kind: 'missing' | 'invalid' | 'limit' | 'read-failed'

  constructor(
    kind: SubjectReadError['kind'],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'SubjectReadError'
    this.kind = kind
  }
}

type BundlePatchDeclaration =
  | { readonly state: 'missing' }
  | { readonly state: 'invalid' }
  | { readonly state: 'present'; readonly value: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
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

async function readBoundedUtf8(location: string, maxBytes: number): Promise<string> {
  let handle
  try {
    handle = await open(location, 'r')
  } catch (cause) {
    throw new SubjectReadError(
      isMissing(cause) ? 'missing' : 'read-failed',
      `Could not open ${location}`,
      { cause },
    )
  }

  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      throw new SubjectReadError('invalid', `Expected a regular file at ${location}`)
    }
    if (stats.size > maxBytes) {
      throw new SubjectReadError('limit', `File exceeds the ${maxBytes}-byte acquisition limit: ${location}`)
    }
    const content = await handle.readFile('utf8')
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      throw new SubjectReadError('limit', `File exceeds the ${maxBytes}-byte acquisition limit: ${location}`)
    }
    return content
  } catch (cause) {
    if (cause instanceof SubjectReadError) throw cause
    throw new SubjectReadError('read-failed', `Could not read ${location}`, { cause })
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
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
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'peerDependencies must be an object when present.',
      [manifestLocation],
    ))
  }
  if (meta !== undefined && !isRecord(meta)) {
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'peerDependenciesMeta must be an object when present.',
      [manifestLocation],
    ))
  }
  if (dependencies !== undefined && !isRecord(dependencies)) {
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'dependencies must be an object when present.',
      [manifestLocation],
    ))
  }

  if (isRecord(peers)) {
    for (const [packageName, range] of Object.entries(peers)) {
      if (!packageName.startsWith(DEEPSEEK_PACKAGE_PREFIX)) continue
      if (typeof range !== 'string' || range.length === 0) {
        diagnostics.push(diagnostic(
          'PLUGIN_MANIFEST_INVALID',
          `Peer requirement ${packageName} must use a non-empty string range.`,
          [manifestLocation],
        ))
        continue
      }

      let relationship: PluginPackageRelationship = 'host-peer-required'
      if (isRecord(meta) && packageName in meta) {
        const packageMeta = meta[packageName]
        if (!isRecord(packageMeta)) {
          diagnostics.push(diagnostic(
            'PLUGIN_MANIFEST_INVALID',
            `peerDependenciesMeta.${packageName} must be an object.`,
            [manifestLocation],
          ))
        } else if ('optional' in packageMeta && typeof packageMeta.optional !== 'boolean') {
          diagnostics.push(diagnostic(
            'PLUGIN_MANIFEST_INVALID',
            `peerDependenciesMeta.${packageName}.optional must be boolean when present.`,
            [manifestLocation],
          ))
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
        diagnostics.push(diagnostic(
          'PLUGIN_MANIFEST_INVALID',
          `Artifact dependency ${packageName} must use a non-empty string range.`,
          [manifestLocation],
        ))
        continue
      }
      requirements.push(Object.freeze({
        packageName,
        range,
        relationship: 'artifact-dependency' as const,
      }))
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

function completenessForIdentity(
  packageName: string | undefined,
  packageVersion: string | undefined,
  diagnostics: readonly Diagnostic[],
): 'complete' | 'partial' | 'invalid' {
  if (packageName === undefined || packageVersion === undefined) return 'invalid'
  return diagnostics.length === 0 ? 'complete' : 'partial'
}

export async function acquirePluginDirectory(
  subjectRoot: string,
  digest: Sha256Port,
): Promise<AcquiredPluginSubject> {
  let canonicalRoot: string
  try {
    canonicalRoot = await realpath(subjectRoot)
  } catch {
    return Object.freeze({
      completeness: 'invalid' as const,
      requirements: Object.freeze([]),
      evidence: Object.freeze([]),
      diagnostics: Object.freeze([diagnostic(
        'PLUGIN_SUBJECT_READ_FAILED',
        'Plugin subject directory could not be resolved.',
        [subjectRoot],
      )]),
    })
  }

  const manifestLocation = path.join(canonicalRoot, 'package.json')
  let manifestContent: string
  try {
    manifestContent = await readBoundedUtf8(manifestLocation, MAX_PLUGIN_MANIFEST_BYTES)
  } catch (error) {
    const code = error instanceof SubjectReadError && error.kind === 'limit'
      ? 'PLUGIN_MANIFEST_LIMIT_EXCEEDED'
      : 'PLUGIN_MANIFEST_READ_FAILED'
    return Object.freeze({
      completeness: 'invalid' as const,
      requirements: Object.freeze([]),
      evidence: Object.freeze([]),
      diagnostics: Object.freeze([diagnostic(code, 'Plugin package.json could not be acquired.', [manifestLocation])]),
    })
  }

  const manifestHash = await digest.sha256Utf8(manifestContent)
  const manifestEvidence: Evidence = Object.freeze({
    id: 'plugin:manifest',
    kind: 'manifest',
    strength: 'authoritative',
    contentHash: manifestHash,
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
      evidence: Object.freeze([manifestEvidence]),
      diagnostics: Object.freeze([diagnostic(
        'PLUGIN_MANIFEST_INVALID',
        'Plugin package.json is not a valid JSON object.',
        [manifestLocation],
      )]),
    })
  }

  const diagnostics: Diagnostic[] = []
  const packageName = typeof manifest.name === 'string' && manifest.name.length > 0
    ? manifest.name
    : undefined
  const packageVersion = typeof manifest.version === 'string' && manifest.version.length > 0
    ? manifest.version
    : undefined
  if (packageName === undefined || packageVersion === undefined) {
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'Plugin package.json must declare non-empty name and version strings.',
      [manifestLocation],
    ))
  }

  const requirements = deepseekRequirements(manifest, diagnostics, manifestLocation)
  const evidence: Evidence[] = [manifestEvidence]
  let bundlePatchHash: string | undefined
  const patch = bundlePatchDeclaration(manifest)

  if (patch.state === 'missing') {
    diagnostics.push(diagnostic(
      'PLUGIN_BUNDLE_PATCH_MISSING',
      'Plugin manifest does not declare dsh.bundle.patch.',
      [manifestLocation],
    ))
  } else if (patch.state === 'invalid') {
    diagnostics.push(diagnostic(
      'PLUGIN_MANIFEST_INVALID',
      'dsh.bundle.patch must be a non-empty string when present.',
      [manifestLocation],
    ))
  } else if (path.isAbsolute(patch.value)) {
    diagnostics.push(diagnostic(
      'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT',
      'dsh.bundle.patch must resolve inside the plugin subject root.',
      [patch.value],
    ))
  } else {
    const lexicalPatch = path.resolve(canonicalRoot, patch.value)
    if (!pathIsWithin(canonicalRoot, lexicalPatch)) {
      diagnostics.push(diagnostic(
        'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT',
        'dsh.bundle.patch resolves outside the plugin subject root.',
        [lexicalPatch],
      ))
    } else {
      let canonicalPatch: string | undefined
      try {
        canonicalPatch = await realpath(lexicalPatch)
      } catch (cause) {
        diagnostics.push(diagnostic(
          isMissing(cause) ? 'PLUGIN_BUNDLE_PATCH_MISSING' : 'PLUGIN_BUNDLE_PATCH_READ_FAILED',
          'Declared dsh.bundle.patch could not be resolved.',
          [lexicalPatch],
        ))
      }

      if (canonicalPatch !== undefined) {
        if (!pathIsWithin(canonicalRoot, canonicalPatch)) {
          diagnostics.push(diagnostic(
            'PLUGIN_BUNDLE_PATCH_OUTSIDE_ROOT',
            'Resolved dsh.bundle.patch escapes the plugin subject root.',
            [canonicalPatch],
          ))
        } else {
          try {
            const patchContent = await readBoundedUtf8(canonicalPatch, MAX_PLUGIN_BUNDLE_PATCH_BYTES)
            bundlePatchHash = await digest.sha256Utf8(patchContent)
            evidence.push(Object.freeze({
              id: 'plugin:bundle-patch',
              kind: 'composed-config',
              strength: 'authoritative',
              contentHash: bundlePatchHash,
              location: canonicalPatch,
            }))
          } catch (error) {
            diagnostics.push(diagnostic(
              error instanceof SubjectReadError && error.kind === 'limit'
                ? 'PLUGIN_BUNDLE_PATCH_LIMIT_EXCEEDED'
                : 'PLUGIN_BUNDLE_PATCH_READ_FAILED',
              'Declared dsh.bundle.patch could not be read safely.',
              [canonicalPatch],
            ))
          }
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

export function createPluginDirectoryAcquisition(
  digest: Sha256Port,
): PluginSubjectAcquisitionPort {
  return Object.freeze({
    acquire: (subject: PluginSubjectRequest) => acquirePluginDirectory(subject.path, digest),
  })
}
