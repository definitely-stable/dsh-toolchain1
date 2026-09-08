import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'

export const MAX_VERIFICATION_PACKED_BYTES = 16 * 1024 * 1024

export type VerificationArtifactErrorCode =
  | 'VERIFY_ARTIFACT_READ_FAILED'
  | 'VERIFY_ARTIFACT_LIMIT_EXCEEDED'
  | 'VERIFY_ARTIFACT_STALE'

export class VerificationArtifactError extends Error {
  readonly code: VerificationArtifactErrorCode

  constructor(code: VerificationArtifactErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VerificationArtifactError'
    this.code = code
  }
}

export interface PackedArtifactObservation {
  readonly fingerprint: string
  readonly contentHash: string
  readonly location: string
  readonly bytes: Buffer
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value)
}

export async function fingerprintPackedArtifact(
  packedPath: string,
  expectedContentHash: string,
): Promise<PackedArtifactObservation> {
  if (!isSha256(expectedContentHash)) {
    throw new VerificationArtifactError(
      'VERIFY_ARTIFACT_STALE',
      'Expected packed artifact content hash is not a canonical SHA-256 value.',
    )
  }

  let location: string
  try {
    location = await realpath(packedPath)
  } catch (cause) {
    throw new VerificationArtifactError(
      'VERIFY_ARTIFACT_READ_FAILED',
      'Packed verification artifact could not be resolved.',
      { cause },
    )
  }

  let handle
  try {
    handle = await open(location, 'r')
  } catch (cause) {
    throw new VerificationArtifactError(
      'VERIFY_ARTIFACT_READ_FAILED',
      'Packed verification artifact could not be opened.',
      { cause },
    )
  }

  try {
    let stats
    try {
      stats = await handle.stat()
    } catch (cause) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_READ_FAILED',
        'Packed verification artifact metadata could not be read.',
        { cause },
      )
    }

    if (!stats.isFile()) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_READ_FAILED',
        'Packed verification artifact must be a regular file.',
      )
    }
    if (stats.size > MAX_VERIFICATION_PACKED_BYTES) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_LIMIT_EXCEEDED',
        'Packed verification artifact exceeds the bounded acquisition limit.',
      )
    }

    let bytes: Buffer
    try {
      bytes = await handle.readFile()
    } catch (cause) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_READ_FAILED',
        'Packed verification artifact bytes could not be read.',
        { cause },
      )
    }
    if (bytes.length > MAX_VERIFICATION_PACKED_BYTES) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_LIMIT_EXCEEDED',
        'Packed verification artifact exceeds the bounded acquisition limit.',
      )
    }

    const contentHash = sha256(bytes)
    if (contentHash !== expectedContentHash) {
      throw new VerificationArtifactError(
        'VERIFY_ARTIFACT_STALE',
        'Packed verification artifact changed after authoritative acquisition.',
      )
    }

    return Object.freeze({
      fingerprint: `dsh-plugin-artifact-v1:${contentHash}`,
      contentHash,
      location,
      bytes: Buffer.from(bytes),
    })
  } finally {
    await handle.close().catch(() => undefined)
  }
}
