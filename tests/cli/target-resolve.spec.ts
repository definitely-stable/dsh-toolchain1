import { describe, expect, it, vi } from 'vitest'

import type { ApplicationKernel } from '../../src/kernel/index.js'
import { TargetAcquisitionError } from '../../src/model/target.js'
import type { TargetResolveResult, TargetResolveResponse } from '../../src/protocol/index.js'
import { runCli, type CliDependencies, type CliIo } from '../../src/frontends/cli/index.js'

function io() {
  let stdout = ''
  let stderr = ''
  const value: CliIo = {
    stdout: { write: chunk => { stdout += chunk; return true } },
    stderr: { write: chunk => { stderr += chunk; return true } },
  }
  return { value, stdout: () => stdout, stderr: () => stderr }
}

function result(): TargetResolveResult {
  return {
    snapshot: {
      fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      createdAt: '2026-08-26T17:00:00.000Z',
      dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
      profile: {
        name: 'web',
        bundles: [{
          name: '@deepseek-ai/dsh-base',
          version: '0.1.1-rc.2',
          patchHash: '1'.repeat(64),
        }],
        dependencies: [],
        profilePatchHash: 'b'.repeat(64),
        homePatchHash: 'c'.repeat(64),
        overlayPatchHashes: ['d'.repeat(64), 'e'.repeat(64)],
      },
      evidence: [],
    },
  }
}

function dependencies(resolveTarget: ApplicationKernel['resolveTarget']): CliDependencies {
  const kernel = {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget,
  } as ApplicationKernel

  return {
    launchMcp: vi.fn(async () => {}),
    kernel,
    requestId: () => 'request-test-1',
  } as CliDependencies
}

describe('target resolve CLI projection', () => {
  it('forwards only the canonical request including ordered repeatable patch hints', async () => {
    const streams = io()
    const resolveTarget = vi.fn(async () => result())

    const code = await runCli([
      'target', 'resolve',
      '--profile', 'web',
      '--dsh-home', '/tmp/dsh-home',
      '--dsh-package-root', '/tmp/dsh-package',
      '--patch', '/tmp/a.yml',
      '--patch', '/tmp/b.yml',
    ], streams.value, dependencies(resolveTarget))

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(resolveTarget).toHaveBeenCalledOnce()
    expect(resolveTarget).toHaveBeenCalledWith({
      profile: 'web',
      dshHome: '/tmp/dsh-home',
      dshPackageRoot: '/tmp/dsh-package',
      patches: ['/tmp/a.yml', '/tmp/b.yml'],
    })

    const response = JSON.parse(streams.stdout()) as TargetResolveResponse
    expect(response).toEqual({
      protocolVersion: '1',
      requestId: 'request-test-1',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      status: 'ok',
      data: result(),
      diagnostics: [],
    })
  })

  it('rejects a missing profile through the shared Protocol validator with exit code 2', async () => {
    const streams = io()
    const resolveTarget = vi.fn(async () => result())

    const code = await runCli(
      ['target', 'resolve'],
      streams.value,
      dependencies(resolveTarget),
    )

    expect(code).toBe(2)
    expect(streams.stdout()).toBe('')
    expect(streams.stderr()).toContain('--profile must be a valid profile for target resolve')
    expect(resolveTarget).not.toHaveBeenCalled()
  })

  it('rejects target-only patch hints outside target resolve', async () => {
    const streams = io()
    const code = await runCli(
      ['--version', '--patch', '/tmp/a.yml'],
      streams.value,
      dependencies(async () => result()),
    )

    expect(code).toBe(2)
    expect(streams.stderr()).toContain('target options require the target resolve command')
  })

  it('maps expected acquisition failures to TargetResolveFailureResponse and exit code 1', async () => {
    const streams = io()
    const failure = new TargetAcquisitionError(
      'TARGET_PROFILE_NOT_FOUND',
      'DSH profile web does not exist',
      ['/tmp/dsh-home/profiles/web/package.json'],
    )

    const code = await runCli(
      ['target', 'resolve', '--profile', 'web'],
      streams.value,
      dependencies(async () => { throw failure }),
    )

    expect(code).toBe(1)
    expect(streams.stderr()).toBe('')
    expect(JSON.parse(streams.stdout())).toEqual({
      protocolVersion: '1',
      requestId: 'request-test-1',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
        summary: 'DSH profile web does not exist',
        locations: ['/tmp/dsh-home/profiles/web/package.json'],
      }],
    })
  })

  it('advertises implemented target, contract, and plugin verification commands', async () => {
    const streams = io()
    const code = await runCli(['--help'], streams.value, dependencies(async () => result()))

    expect(code).toBe(0)
    expect(streams.stdout()).toContain('target resolve')
    expect(streams.stdout()).toContain('--patch <path>')
    expect(streams.stdout()).toContain('contract search')
    expect(streams.stdout()).toContain('contract inspect')
    expect(streams.stdout()).toContain('plugin verify')
  })
})
