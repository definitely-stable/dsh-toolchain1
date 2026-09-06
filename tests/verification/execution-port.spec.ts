import { describe, expect, it, vi } from 'vitest'

import {
  createPackedPluginVerificationExecutionPort,
  type PackedPluginVerificationRunner,
} from '../../src/verification/execution-port.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const artifactHash = '9'.repeat(64)
const artifactFingerprint = `dsh-plugin-artifact-v1:${artifactHash}`

function target(): TargetSnapshot {
  return {
    fingerprint: targetFingerprint,
    createdAt: '2026-09-06T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: artifactHash,
      homePatchHash: artifactHash,
      overlayPatchHashes: [],
    },
    evidence: [],
  }
}

describe('packed plugin verification execution port', () => {
  it('maps the runtime-neutral kernel input to the M4.1 worker and strips worker-only runtime metadata', async () => {
    const signal = new AbortController().signal
    const runner: PackedPluginVerificationRunner = vi.fn(async () => ({
      artifactFingerprint,
      targetFingerprint,
      executionPolicy: 'safe',
      runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
      checks: [{ id: 'package', status: 'passed' }],
      diagnostics: [],
      cleanup: 'succeeded',
      terminal: 'completed',
    }))
    const port = createPackedPluginVerificationExecutionPort(runner)
    const snapshot = target()

    const result = await port.verify({
      artifactPath: '/candidate/plugin.tgz',
      expectedContentHash: artifactHash,
      target: snapshot,
      executionPolicy: 'safe',
    }, signal)

    expect(runner).toHaveBeenCalledWith({
      artifact: {
        path: '/candidate/plugin.tgz',
        expectedContentHash: artifactHash,
      },
      target: snapshot,
      executionPolicy: 'safe',
    }, signal)
    expect(result).toEqual({
      artifactFingerprint,
      targetFingerprint,
      executionPolicy: 'safe',
      checks: [{ id: 'package', status: 'passed' }],
      diagnostics: [],
      cleanup: 'succeeded',
      terminal: 'completed',
    })
    expect(result).not.toHaveProperty('runtime')
  })
})
