import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessRequest } from '../../src/verification/process.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function target(): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-06T12:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
  }
}

describe('packed verification cleanup lifecycle', () => {
  it('retains cleanup failure after a primary install failure', async () => {
    const outer = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-cleanup-red-'))
    roots.push(outer)
    const artifactPath = path.join(outer, 'candidate.tgz')
    const bytes = Buffer.from('candidate')
    await writeFile(artifactPath, bytes)
    const workerRoot = path.join(outer, 'worker')
    const calls: VerificationProcessRequest[] = []

    const execution = await runPackedPluginVerification({
      artifact: {
        path: artifactPath,
        expectedContentHash: createHash('sha256').update(bytes).digest('hex'),
      },
      target: target(),
      executionPolicy: 'safe',
    }, {
      parentEnv: { PATH: process.env.PATH },
      createTemporaryRoot: async () => {
        await mkdir(workerRoot, { recursive: true })
        return workerRoot
      },
      processRunner: async request => {
        calls.push(request)
        return { kind: 'exited', code: 1, stdout: '', stderr: 'install failed' }
      },
      cleanupTemporaryRoot: async () => {
        throw new Error('cleanup denied')
      },
    })

    expect(calls).toHaveLength(1)
    expect(execution.terminal).toBe('failed')
    expect(execution.cleanup).toBe('failed')
    expect(execution.diagnostics.map(item => item.code)).toEqual([
      'VERIFY_INSTALL_FAILED',
      'VERIFY_CLEANUP_FAILED',
    ])
    expect(execution.checks.find(item => item.id === 'install')).toMatchObject({ status: 'failed' })
  })
})
