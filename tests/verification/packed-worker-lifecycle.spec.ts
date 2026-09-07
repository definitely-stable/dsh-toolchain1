import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessOutcome, VerificationProcessRequest } from '../../src/verification/process.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const roots: string[] = []
const lifecycleFingerprint = `dsh-profile-lifecycle-v1:${'f'.repeat(64)}`

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function target(): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-07T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'headless',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    profileLifecycle: {
      patchReload: 'startup',
      fingerprint: lifecycleFingerprint,
    },
    evidence: [],
  }
}

function successfulOutcomes(profile: string): readonly VerificationProcessOutcome[] {
  const marker = `DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:${sha256(Buffer.from(`profile:${profile}`))}`
  return [
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: 'composed', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: `${marker}\n`, stderr: '' },
  ]
}

describe('packed plugin verification lifecycle binding', () => {
  it('echoes the lifecycle identity from the exact input snapshot', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-worker-lifecycle-'))
    roots.push(root)
    const artifactPath = path.join(root, 'candidate.tgz')
    const artifactBytes = Buffer.from('packed-candidate-lifecycle-v1')
    await writeFile(artifactPath, artifactBytes)

    const queue = [...successfulOutcomes('headless')]
    const calls: VerificationProcessRequest[] = []
    const execution = await runPackedPluginVerification({
      artifact: {
        path: artifactPath,
        expectedContentHash: sha256(artifactBytes),
      },
      target: target(),
      executionPolicy: 'safe',
    }, {
      processRunner: async (request: VerificationProcessRequest) => {
        calls.push(request)
        return queue.shift() ?? { kind: 'exited', code: 0, stdout: '', stderr: '' }
      },
      parentEnv: { PATH: process.env.PATH },
      createTemporaryRoot: async () => {
        const workerRoot = path.join(root, 'worker')
        await mkdir(workerRoot, { recursive: true })
        return workerRoot
      },
      cleanupTemporaryRoot: async temporaryRoot => {
        await rm(temporaryRoot, { recursive: true, force: true })
      },
    })

    expect(calls).toHaveLength(5)
    expect(execution.terminal).toBe('completed')
    expect(execution.targetFingerprint).toBe(target().fingerprint)
    expect(execution.lifecycleFingerprint).toBe(lifecycleFingerprint)
  })
})
