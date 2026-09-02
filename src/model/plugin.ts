import type { Diagnostic, Evidence, PluginSubjectRequest } from '../protocol/index.js'
import type { Sha256Port } from './digest.js'

export type PluginPackageRelationship =
  | 'host-peer-required'
  | 'host-peer-optional'
  | 'artifact-dependency'

export interface AcquiredPluginRequirement {
  readonly packageName: string
  readonly range: string
  readonly relationship: PluginPackageRelationship
}

export type PluginSubjectCompleteness = 'complete' | 'partial' | 'invalid'

export interface AcquiredPluginSubject {
  readonly completeness: PluginSubjectCompleteness
  readonly packageName?: string
  readonly packageVersion?: string
  readonly bundlePatchHash?: string
  readonly requirements: readonly AcquiredPluginRequirement[]
  readonly evidence: readonly Evidence[]
  readonly diagnostics: readonly Diagnostic[]
}

export interface PluginSubjectAcquisitionPort {
  acquire(subject: PluginSubjectRequest): Promise<AcquiredPluginSubject>
}

export interface PluginSubjectSemanticProjectionV1 {
  readonly schema: 'dsh-plugin-subject-v1'
  readonly package: {
    readonly name: string
    readonly version: string
  }
  readonly bundlePatchHash?: string
  readonly requirements: readonly AcquiredPluginRequirement[]
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function freezeRequirement(requirement: AcquiredPluginRequirement): AcquiredPluginRequirement {
  return Object.freeze({
    packageName: requirement.packageName,
    range: requirement.range,
    relationship: requirement.relationship,
  })
}

function normalizedRequirements(
  requirements: readonly AcquiredPluginRequirement[],
): readonly AcquiredPluginRequirement[] {
  const bySemanticKey = new Map<string, AcquiredPluginRequirement>()
  for (const requirement of requirements) {
    const normalized = freezeRequirement(requirement)
    const key = `${normalized.relationship}\u0000${normalized.packageName}\u0000${normalized.range}`
    bySemanticKey.set(key, normalized)
  }

  return Object.freeze(
    [...bySemanticKey.values()].toSorted((left, right) =>
      compareCodePoints(left.relationship, right.relationship)
      || compareCodePoints(left.packageName, right.packageName)
      || compareCodePoints(left.range, right.range)),
  )
}

export function createPluginSubjectSemanticProjection(
  facts: AcquiredPluginSubject,
): PluginSubjectSemanticProjectionV1 | undefined {
  if (
    typeof facts.packageName !== 'string'
    || facts.packageName.length === 0
    || typeof facts.packageVersion !== 'string'
    || facts.packageVersion.length === 0
  ) return undefined

  const requirements = normalizedRequirements(facts.requirements)
  return Object.freeze({
    schema: 'dsh-plugin-subject-v1' as const,
    package: Object.freeze({
      name: facts.packageName,
      version: facts.packageVersion,
    }),
    ...(facts.bundlePatchHash === undefined ? {} : { bundlePatchHash: facts.bundlePatchHash }),
    requirements,
  })
}

export function canonicalizePluginSubjectProjection(
  projection: PluginSubjectSemanticProjectionV1,
): string {
  return JSON.stringify(projection)
}

export async function fingerprintPluginSubject(
  projection: PluginSubjectSemanticProjectionV1,
  digest: Sha256Port,
): Promise<string> {
  const value = await digest.sha256Utf8(canonicalizePluginSubjectProjection(projection))
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('SHA-256 digest port must return exactly 64 lowercase hexadecimal characters')
  }
  return `dsh-plugin-subject-v1:${value}`
}
