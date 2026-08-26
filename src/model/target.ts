import type {
  Evidence,
  ResolvedBundleIdentity,
  ResolvedPackageIdentity,
  TargetResolveRequest,
} from '../protocol/index.js'
import type { Sha256Port } from './digest.js'

export type { Sha256Port } from './digest.js'

export interface AcquiredTargetFacts {
  readonly dsh: {
    readonly name: '@deepseek-ai/dsh'
    readonly version: string
  }
  readonly runtime: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
  readonly profile: {
    readonly name: string
    readonly bundles: readonly ResolvedBundleIdentity[]
    readonly dependencies: readonly ResolvedPackageIdentity[]
    readonly profilePatchHash: string
    readonly homePatchHash: string
    readonly overlayPatchHashes: readonly string[]
  }
  readonly evidence: readonly Evidence[]
  readonly supportStatus?: 'tested' | 'supported' | 'experimental' | 'unsupported'
}

export interface TargetAcquisitionPort {
  acquire(request: TargetResolveRequest): Promise<AcquiredTargetFacts>
}

export type TargetAcquisitionErrorCode =
  | 'TARGET_PROFILE_INVALID'
  | 'TARGET_PROFILE_NOT_FOUND'
  | 'TARGET_DSH_NOT_FOUND'
  | 'TARGET_MANIFEST_INVALID'
  | 'TARGET_BUNDLE_NOT_FOUND'
  | 'TARGET_BUNDLE_PATCH_NOT_FOUND'
  | 'TARGET_DEPENDENCY_NOT_FOUND'
  | 'TARGET_OVERLAY_NOT_FOUND'
  | 'TARGET_EVIDENCE_READ_FAILED'

export class TargetAcquisitionError extends Error {
  readonly code: TargetAcquisitionErrorCode
  readonly locations: readonly string[]

  constructor(
    code: TargetAcquisitionErrorCode,
    message: string,
    locations: readonly string[],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'TargetAcquisitionError'
    this.code = code
    this.locations = Object.freeze([...locations])
  }
}

export interface TargetSemanticProjectionV2 {
  readonly schema: 'dsh-target-v2'
  readonly dsh: {
    readonly name: '@deepseek-ai/dsh'
    readonly version: string
  }
  readonly runtime: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
  readonly profile: {
    readonly name: string
    readonly bundles: readonly ResolvedBundleIdentity[]
    readonly dependencies: readonly ResolvedPackageIdentity[]
    readonly profilePatchHash: string
    readonly homePatchHash: string
    readonly overlayPatchHashes: readonly string[]
  }
}

function freezeBundleIdentity(identity: ResolvedBundleIdentity): ResolvedBundleIdentity {
  return Object.freeze({
    name: identity.name,
    version: identity.version,
    patchHash: identity.patchHash,
  })
}

function freezePackageIdentity(identity: ResolvedPackageIdentity): ResolvedPackageIdentity {
  return Object.freeze({ name: identity.name, version: identity.version })
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function createTargetSemanticProjectionV2(
  facts: AcquiredTargetFacts,
): TargetSemanticProjectionV2 {
  const bundles = Object.freeze(
    facts.profile.bundles
      .filter(identity => identity.name !== 'dsh-toolchain')
      .map(freezeBundleIdentity),
  )
  const dependencies = Object.freeze(
    facts.profile.dependencies
      .filter(identity => identity.name !== 'dsh-toolchain')
      .map(freezePackageIdentity)
      .toSorted(
        (left, right) =>
          compareCodePoints(left.name, right.name) || compareCodePoints(left.version, right.version),
      ),
  )
  const overlayPatchHashes = Object.freeze([...facts.profile.overlayPatchHashes])

  return Object.freeze({
    schema: 'dsh-target-v2',
    dsh: Object.freeze({
      name: '@deepseek-ai/dsh' as const,
      version: facts.dsh.version,
    }),
    runtime: Object.freeze({
      nodeVersion: facts.runtime.nodeVersion,
      platform: facts.runtime.platform,
      arch: facts.runtime.arch,
    }),
    profile: Object.freeze({
      name: facts.profile.name,
      bundles,
      dependencies,
      profilePatchHash: facts.profile.profilePatchHash,
      homePatchHash: facts.profile.homePatchHash,
      overlayPatchHashes,
    }),
  })
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function canonicalizeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeValue)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, canonicalizeValue(child)]),
  ) as { readonly [key: string]: JsonValue }
}

export function canonicalizeTargetProjection(projection: TargetSemanticProjectionV2): string {
  return JSON.stringify(canonicalizeValue(projection as unknown as JsonValue))
}

export async function fingerprintTarget(
  projection: TargetSemanticProjectionV2,
  digest: Sha256Port,
): Promise<string> {
  const value = await digest.sha256Utf8(canonicalizeTargetProjection(projection))
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('SHA-256 digest port must return exactly 64 lowercase hexadecimal characters')
  }
  return `dsh-target-v2:${value}`
}
