import { describe, expect, it, vi } from 'vitest'

import {
  createDshAmbientTargetBinding,
  provenRunningProfile,
  type DshStartupTargetIdentity,
} from '../../src/integrations/dsh/runtime-target-binding.js'
import type { TargetResolveResult } from '../../src/protocol/index.js'

const TARGET = `dsh-target-v2:${'a'.repeat(64)}`
const OTHER_TARGET = `dsh-target-v2:${'b'.repeat(64)}`
const LIFECYCLE = `dsh-profile-lifecycle-v1:${'c'.repeat(64)}`
const OTHER_LIFECYCLE = `dsh-profile-lifecycle-v1:${'d'.repeat(64)}`

/**
 * The binding reads exactly two fields of a resolved target — the fingerprint pair it must prove —
 * so the stub stays minimal instead of restating a whole snapshot the port never inspects.
 */
function resolved(fingerprint: string, lifecycleFingerprint?: string): TargetResolveResult {
  return {
    snapshot: {
      fingerprint,
      ...(lifecycleFingerprint === undefined
        ? {}
        : { profileLifecycle: { patchReload: 'live', fingerprint: lifecycleFingerprint } }),
    },
  } as unknown as TargetResolveResult
}

function identity(targetFingerprint: string, lifecycleFingerprint?: string): DshStartupTargetIdentity {
  return Object.freeze({
    targetFingerprint,
    ...(lifecycleFingerprint === undefined ? {} : { lifecycleFingerprint }),
  })
}

function binding(options: {
  readonly host?: { readonly dshHome: string, readonly runningProfile?: string }
  readonly startupIdentity?: Promise<DshStartupTargetIdentity | undefined>
  readonly resolveTarget?: (request: { readonly profile: string }) => Promise<TargetResolveResult>
}) {
  return createDshAmbientTargetBinding({
    ...(options.host === undefined ? {} : { host: options.host }),
    startupIdentity: options.startupIdentity ?? Promise.resolve(undefined),
    resolveTarget: (options.resolveTarget ?? (async () => resolved(TARGET))) as never,
  })
}

describe('implicit runtime target binding', () => {
  it('resolves an explicit profile inside the Host home, and canonically without one', async () => {
    await expect(binding({ host: { dshHome: '/dsh-home' } }).targetRequest('web'))
      .resolves.toEqual({ profile: 'web', dshHome: '/dsh-home' })
    // Without an authoritative Host home the request is exactly the caller's profile: the adapter
    // must not invent an acquisition hint the Host never proved.
    await expect(binding({}).targetRequest('web')).resolves.toEqual({ profile: 'web' })
  })

  it('binds the running target only after proving the mount-time epoch', async () => {
    const resolveTarget = vi.fn(async () => resolved(TARGET, LIFECYCLE))
    const request = await binding({
      host: { dshHome: '/dsh-home', runningProfile: 'web' },
      startupIdentity: Promise.resolve(identity(TARGET, LIFECYCLE)),
      resolveTarget,
    }).targetRequest()

    expect(request).toEqual({ profile: 'web', dshHome: '/dsh-home' })
    expect(resolveTarget).toHaveBeenCalledWith({ profile: 'web', dshHome: '/dsh-home' })
  })

  it('fails closed when no running target can be proven', async () => {
    const cases: readonly [string, ReturnType<typeof binding>][] = [
      ['no authoritative Host home', binding({ startupIdentity: Promise.resolve(identity(TARGET)) })],
      [
        'no provable running profile',
        binding({
          host: { dshHome: '/dsh-home' },
          startupIdentity: Promise.resolve(identity(TARGET)),
        }),
      ],
      [
        'no captured startup epoch',
        binding({ host: { dshHome: '/dsh-home', runningProfile: 'web' } }),
      ],
      [
        'a rejected startup capture',
        binding({
          host: { dshHome: '/dsh-home', runningProfile: 'web' },
          startupIdentity: Promise.reject(new Error('capture failed')),
        }),
      ],
      [
        'an unresolvable running target',
        binding({
          host: { dshHome: '/dsh-home', runningProfile: 'web' },
          startupIdentity: Promise.resolve(identity(TARGET)),
          resolveTarget: async () => { throw new Error('profile disappeared') },
        }),
      ],
    ]

    for (const [label, port] of cases) {
      await expect(port.targetRequest(), label).rejects.toMatchObject({
        name: 'DshTargetBindingError',
        code: 'TARGET_RUNTIME_BINDING_UNAVAILABLE',
      })
      // The failure has to name the recovery, because the caller's only way forward is an explicit
      // profile.
      await expect(port.targetRequest(), label).rejects.toThrow(/explicit profile/i)
    }
  })

  it('refuses to re-bind a target whose epoch moved after mount', async () => {
    const changed = binding({
      host: { dshHome: '/dsh-home', runningProfile: 'web' },
      startupIdentity: Promise.resolve(identity(TARGET)),
      resolveTarget: async () => resolved(OTHER_TARGET),
    })
    await expect(changed.targetRequest()).rejects.toMatchObject({
      code: 'TARGET_RUNTIME_BINDING_CHANGED',
    })

    // A lifecycle-aware mount epoch must match on both axes: a newly present lifecycle identity and
    // a disappeared one are both drift, not a fresh binding.
    const addedLifecycle = binding({
      host: { dshHome: '/dsh-home', runningProfile: 'web' },
      startupIdentity: Promise.resolve(identity(TARGET)),
      resolveTarget: async () => resolved(TARGET, LIFECYCLE),
    })
    await expect(addedLifecycle.targetRequest()).rejects.toMatchObject({
      code: 'TARGET_RUNTIME_BINDING_CHANGED',
    })

    const removedLifecycle = binding({
      host: { dshHome: '/dsh-home', runningProfile: 'web' },
      startupIdentity: Promise.resolve(identity(TARGET, LIFECYCLE)),
      resolveTarget: async () => resolved(TARGET),
    })
    await expect(removedLifecycle.targetRequest()).rejects.toMatchObject({
      code: 'TARGET_RUNTIME_BINDING_CHANGED',
    })

    const movedLifecycle = binding({
      host: { dshHome: '/dsh-home', runningProfile: 'web' },
      startupIdentity: Promise.resolve(identity(TARGET, LIFECYCLE)),
      resolveTarget: async () => resolved(TARGET, OTHER_LIFECYCLE),
    })
    await expect(movedLifecycle.targetRequest()).rejects.toMatchObject({
      code: 'TARGET_RUNTIME_BINDING_CHANGED',
    })
  })
})

describe('provable running profile', () => {
  it('accepts only an official profile invocation without ordered overlays', () => {
    expect(provenRunningProfile(['node', '/dsh/bin.js', '--profile', 'web'])).toBe('web')
    expect(provenRunningProfile(['node', '/dsh/bin.js', 'web'])).toBe('web')
    expect(provenRunningProfile(['node', '/dsh/bin.js', '--profile=web'])).toBe('web')

    // Upstream publishes no boot-time overlay attestation, so an invocation with overlays has no
    // running target Toolchain can prove.
    expect(provenRunningProfile(['node', '/dsh/bin.js', '--profile', 'web', '--patch', 'a.yml']))
      .toBeUndefined()
    expect(provenRunningProfile(['node', '/dsh/bin.js', 'plugin', '--profile', 'web'])).toBeUndefined()
    expect(provenRunningProfile(['node', '/dsh/bin.js'])).toBeUndefined()
  })
})
