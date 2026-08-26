import { describe, expect, it, vi } from 'vitest'

import {
  createApplicationKernel,
  type ApplicationKernel,
} from '../../src/kernel/index.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type {
  AcquiredTargetFacts,
  TargetAcquisitionPort,
} from '../../src/model/target.js'
import type {
  TargetResolveRequest,
  TargetResolveResult,
} from '../../src/protocol/index.js'

type M1ApplicationKernel = ApplicationKernel & {
  resolveTarget(request: TargetResolveRequest): Promise<TargetResolveResult>
}

type M1KernelFactory = (options: {
  readonly targetAcquisition: TargetAcquisitionPort
  readonly digest: Sha256Port
  readonly now?: () => string
}) => M1ApplicationKernel

const createM1Kernel = createApplicationKernel as unknown as M1KernelFactory

function acquiredFacts(): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: '1'.repeat(64) },
        { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', patchHash: '2'.repeat(64) },
      ],
      dependencies: [
        { name: 'dsh-toolchain', version: '0.0.0' },
        { name: 'user-plugin', version: '1.2.3' },
      ],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: ['d'.repeat(64)],
    },
    evidence: [
      {
        id: 'manifest:profile',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: 'e'.repeat(64),
        location: '/evidence/profile/package.json',
      },
    ],
    supportStatus: 'tested',
  }
}

describe('application kernel target resolution', () => {
  it('acquires once and returns an immutable snapshot bound to semantic target identity', async () => {
    const request: TargetResolveRequest = {
      profile: 'web',
      dshHome: '/private/acquisition/home',
      dshPackageRoot: '/private/acquisition/dsh',
      patches: ['/private/acquisition/overlay.yml'],
    }
    const targetAcquisition: TargetAcquisitionPort = {
      acquire: vi.fn(async () => acquiredFacts()),
    }
    let digestInput = ''
    const digest: Sha256Port = {
      sha256Utf8: vi.fn(async (value) => {
        digestInput = value
        return 'a'.repeat(64)
      }),
    }
    const kernel = createM1Kernel({
      targetAcquisition,
      digest,
      now: () => '2026-08-26T17:00:00.000Z',
    })

    const result = await kernel.resolveTarget(request)

    expect(targetAcquisition.acquire).toHaveBeenCalledOnce()
    expect(targetAcquisition.acquire).toHaveBeenCalledWith(request)
    expect(result.snapshot.fingerprint).toBe(`dsh-target-v2:${'a'.repeat(64)}`)
    expect(result.snapshot.createdAt).toBe('2026-08-26T17:00:00.000Z')
    expect(result.snapshot.profile.dependencies).toEqual([
      { name: 'user-plugin', version: '1.2.3' },
    ])
    expect(result.snapshot.profile.overlayPatchHashes).toEqual(['d'.repeat(64)])
    expect(result.snapshot.supportStatus).toBe('tested')
    expect(digestInput).not.toContain('/private/acquisition/home')
    expect(digestInput).not.toContain('/private/acquisition/dsh')
    expect(digestInput).not.toContain('/private/acquisition/overlay.yml')
    expect(digestInput).not.toContain('dsh-toolchain')

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.snapshot)).toBe(true)
    expect(Object.isFrozen(result.snapshot.dsh)).toBe(true)
    expect(Object.isFrozen(result.snapshot.runtime)).toBe(true)
    expect(Object.isFrozen(result.snapshot.profile)).toBe(true)
    expect(Object.isFrozen(result.snapshot.profile.bundles)).toBe(true)
    expect(Object.isFrozen(result.snapshot.profile.dependencies)).toBe(true)
    expect(Object.isFrozen(result.snapshot.profile.overlayPatchHashes)).toBe(true)
    expect(Object.isFrozen(result.snapshot.evidence)).toBe(true)
    expect(Object.isFrozen(result.snapshot.evidence[0])).toBe(true)
  })

  it('does not let capture time change the semantic fingerprint', async () => {
    const targetAcquisition: TargetAcquisitionPort = {
      acquire: async () => acquiredFacts(),
    }
    const digest: Sha256Port = {
      sha256Utf8: async () => 'd'.repeat(64),
    }
    const first = createM1Kernel({
      targetAcquisition,
      digest,
      now: () => '2026-08-26T17:00:00.000Z',
    })
    const second = createM1Kernel({
      targetAcquisition,
      digest,
      now: () => '2026-08-27T17:00:00.000Z',
    })

    const left = await first.resolveTarget({ profile: 'web' })
    const right = await second.resolveTarget({ profile: 'web' })

    expect(left.snapshot.createdAt).not.toBe(right.snapshot.createdAt)
    expect(left.snapshot.fingerprint).toBe(right.snapshot.fingerprint)
  })
})
