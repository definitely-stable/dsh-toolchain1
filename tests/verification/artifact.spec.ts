import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_VERIFICATION_PACKED_BYTES,
  VerificationArtifactError,
  fingerprintPackedArtifact,
} from '../../src/verification/artifact.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-verify-artifact-'))
  roots.push(root)
  return root
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('packed verification artifact identity', () => {
  it('binds exact bytes rather than path or machine metadata', async () => {
    const root = await fixture()
    const left = path.join(root, 'left.tgz')
    const nested = path.join(root, 'nested')
    const right = path.join(nested, 'right.tgz')
    const bytes = Buffer.from('same packed artifact bytes', 'utf8')
    await mkdir(nested)
    await writeFile(left, bytes)
    await writeFile(right, bytes)

    const expectedContentHash = sha256(bytes)
    const first = await fingerprintPackedArtifact(left, expectedContentHash)
    const second = await fingerprintPackedArtifact(right, expectedContentHash)

    expect(first.fingerprint).toBe(`dsh-plugin-artifact-v1:${expectedContentHash}`)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(first.contentHash).toBe(expectedContentHash)
    expect(second.contentHash).toBe(expectedContentHash)
    expect(first.location).not.toBe(second.location)
  })

  it('changes identity for one-byte drift', async () => {
    const root = await fixture()
    const packed = path.join(root, 'candidate.tgz')
    const before = Buffer.from('artifact-A', 'utf8')
    const after = Buffer.from('artifact-B', 'utf8')
    await writeFile(packed, before)

    const first = await fingerprintPackedArtifact(packed, sha256(before))
    await writeFile(packed, after)
    const second = await fingerprintPackedArtifact(packed, sha256(after))

    expect(first.fingerprint).not.toBe(second.fingerprint)
  })

  it('fails closed on content drift against the authoritative packed-acquisition hash', async () => {
    const root = await fixture()
    const packed = path.join(root, 'candidate.tgz')
    const acquiredBytes = Buffer.from('acquired bytes', 'utf8')
    const changedBytes = Buffer.from('changed bytes', 'utf8')
    await writeFile(packed, changedBytes)

    await expect(fingerprintPackedArtifact(packed, sha256(acquiredBytes))).rejects.toMatchObject({
      name: 'VerificationArtifactError',
      code: 'VERIFY_ARTIFACT_STALE',
    })
  })

  it('rejects missing and non-file inputs as read failures', async () => {
    const root = await fixture()
    const directory = path.join(root, 'directory.tgz')
    await mkdir(directory)

    for (const candidate of [path.join(root, 'missing.tgz'), directory]) {
      await expect(fingerprintPackedArtifact(candidate, '0'.repeat(64))).rejects.toBeInstanceOf(VerificationArtifactError)
      await expect(fingerprintPackedArtifact(candidate, '0'.repeat(64))).rejects.toMatchObject({
        code: 'VERIFY_ARTIFACT_READ_FAILED',
      })
    }
  })

  it('rejects packed input above the shared 16 MiB acquisition ceiling', async () => {
    const root = await fixture()
    const packed = path.join(root, 'oversized.tgz')
    await writeFile(packed, Buffer.alloc(MAX_VERIFICATION_PACKED_BYTES + 1, 0x61))

    await expect(fingerprintPackedArtifact(packed, '0'.repeat(64))).rejects.toMatchObject({
      code: 'VERIFY_ARTIFACT_LIMIT_EXCEEDED',
    })
  })

  it('rejects malformed expected hash before treating it as an artifact identity', async () => {
    const root = await fixture()
    const packed = path.join(root, 'candidate.tgz')
    await writeFile(packed, 'bytes', 'utf8')

    await expect(fingerprintPackedArtifact(packed, 'not-a-sha256')).rejects.toMatchObject({
      code: 'VERIFY_ARTIFACT_STALE',
    })
  })
})
