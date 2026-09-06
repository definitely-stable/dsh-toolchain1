import type { Sha256Port } from '../model/digest.js'
import type { AcquiredPluginSubject } from '../model/plugin.js'
import { acquirePluginPacked } from './plugin-packed.js'

export interface AcquiredPackedArtifact {
  readonly location: string
  readonly contentHash: string
}

export interface AcquiredPluginPackedWithArtifact {
  readonly subject: AcquiredPluginSubject
  readonly artifact?: AcquiredPackedArtifact
}

function authoritativePackedArtifact(
  subject: AcquiredPluginSubject,
): AcquiredPackedArtifact | undefined {
  if (subject.completeness !== 'complete') return undefined

  const matches = subject.evidence.filter(evidence => evidence.id === 'plugin:packed-artifact')
  if (matches.length !== 1) return undefined

  const evidence = matches[0]
  if (evidence === undefined) return undefined
  const contentHash = evidence.contentHash
  if (
    evidence.kind !== 'package'
    || evidence.strength !== 'authoritative'
    || typeof evidence.location !== 'string'
    || evidence.location.length === 0
    || typeof contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(contentHash)
  ) return undefined

  return Object.freeze({
    location: evidence.location,
    contentHash,
  })
}

/**
 * Acquires one packed subject and exposes the exact authoritative artifact
 * observation produced by that same bounded acquisition pass.
 *
 * This adapter intentionally performs no filesystem or archive IO of its own.
 */
export async function acquirePluginPackedWithArtifact(
  packedPath: string,
  digest: Sha256Port,
): Promise<AcquiredPluginPackedWithArtifact> {
  const subject = await acquirePluginPacked(packedPath, digest)
  const artifact = authoritativePackedArtifact(subject)
  return Object.freeze({
    subject,
    ...(artifact === undefined ? {} : { artifact }),
  })
}
