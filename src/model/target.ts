import type { Evidence, ResolvedPackageIdentity } from '../protocol/index.js'
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
    readonly bundles: readonly ResolvedPackageIdentity[]
    readonly dependencies: readonly ResolvedPackageIdentity[]
    readonly patchHash: string
  }
  readonly evidence: readonly Evidence[]
  readonly supportStatus?: 'tested' | 'supported' | 'experimental' | 'unsupported'
}

export interface TargetSemanticProjectionV1 {
  readonly schema: 'dsh-target-v1'
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
    readonly bundles: readonly ResolvedPackageIdentity[]
    readonly dependencies: readonly ResolvedPackageIdentity[]
    readonly patchHash: string
  }
}

function freezeIdentity(identity: ResolvedPackageIdentity): ResolvedPackageIdentity {
  return Object.freeze({ name: identity.name, version: identity.version })
}

export function createTargetSemanticProjectionV1(
  facts: AcquiredTargetFacts,
): TargetSemanticProjectionV1 {
  const bundles = Object.freeze(facts.profile.bundles.map(freezeIdentity))
  const dependencies = Object.freeze(
    facts.profile.dependencies
      .filter(identity => identity.name !== 'dsh-toolchain')
      .map(freezeIdentity)
      .toSorted((left, right) =>
        left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
      ),
  )

  return Object.freeze({
    schema: 'dsh-target-v1',
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
      patchHash: facts.profile.patchHash,
    }),
  })
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function canonicalizeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeValue)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeValue(child)]),
  ) as { readonly [key: string]: JsonValue }
}

export function canonicalizeTargetProjection(projection: TargetSemanticProjectionV1): string {
  return JSON.stringify(canonicalizeValue(projection as unknown as JsonValue))
}

export async function fingerprintTarget(
  projection: TargetSemanticProjectionV1,
  digest: Sha256Port,
): Promise<string> {
  const value = await digest.sha256Utf8(canonicalizeTargetProjection(projection))
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('SHA-256 digest port must return exactly 64 lowercase hexadecimal characters')
  }
  return `dsh-target-v1:${value}`
}
