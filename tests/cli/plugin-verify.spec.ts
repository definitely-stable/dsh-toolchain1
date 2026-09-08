import { describe, expect, it, vi } from 'vitest'

import { runCli, type CliDependencies, type CliIo } from '../../src/frontends/cli/index.js'
import type { ApplicationKernel, PluginVerifyOutcome } from '../../src/kernel/index.js'
import type { PluginVerifyResponse, VerificationReport } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const artifactFingerprint = `dsh-plugin-artifact-v1:${'9'.repeat(64)}`

function io() {
  let stdout = ''
  let stderr = ''
  const value: CliIo = {
    stdout: { write: chunk => { stdout += chunk; return true } },
    stderr: { write: chunk => { stderr += chunk; return true } },
  }
  return { value, stdout: () => stdout, stderr: () => stderr }
}

function outcome(status: VerificationReport['status']): PluginVerifyOutcome {
  return {
    snapshotFingerprint: targetFingerprint,
    data: {
      status,
      artifactFingerprint,
      targetFingerprint,
      executionPolicy: 'safe',
      checks: [],
      diagnostics: [],
      cleanup: 'succeeded',
    },
  }
}

function dependencies(status: VerificationReport['status']): CliDependencies {
  const kernel: ApplicationKernel = {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => { throw new Error('unused') }),
    verifyPlugin: vi.fn(async () => outcome(status)),
  }
  return { launchMcp: vi.fn(async () => {}), kernel, requestId: () => 'plugin-verify-cli' }
}

describe('plugin.verify CLI projection', () => {
  it('accepts a packed artifact with repeated Host Service assertions and delegates the canonical safe request', async () => {
    const streams = io()
    const deps = dependencies('verified')

    const code = await runCli([
      'plugin', 'verify',
      '--profile', 'web',
      '--subject', '/candidate/plugin.tgz',
      '--dsh-home', '/tmp/dsh-home',
      '--patch', '/tmp/overlay.yml',
      '--visibility-service', 'candidateService',
      '--visibility-service', 'another/service',
    ], streams.value, deps)

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(deps.kernel?.verifyPlugin).toHaveBeenCalledWith({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/overlay.yml'],
      },
      subject: { kind: 'packed', path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe',
      visibilityAssertions: [
        { kind: 'host-service', name: 'candidateService' },
        { kind: 'host-service', name: 'another/service' },
      ],
    })
    const response = JSON.parse(streams.stdout()) as PluginVerifyResponse
    expect(response).toMatchObject({
      status: 'ok',
      data: { status: 'verified', artifactFingerprint },
    })
  })

  it.each(['failed', 'partial', 'stale', 'cancelled'] as const)(
    'returns exit 1 for semantic %s without changing the Protocol envelope',
    async status => {
      const streams = io()
      const code = await runCli(
        ['plugin', 'verify', '--profile', 'web', '--subject', '/candidate/plugin.tgz'],
        streams.value,
        dependencies(status),
      )
      expect(code).toBe(1)
      expect(JSON.parse(streams.stdout())).toMatchObject({ status: 'ok', data: { status } })
    },
  )

  it('rejects a directory before invoking the kernel', async () => {
    const streams = io()
    const deps = dependencies('verified')

    expect(await runCli(
      ['plugin', 'verify', '--profile', 'web', '--subject', '/candidate/plugin'],
      streams.value,
      deps,
    )).toBe(2)
    expect(streams.stderr()).toContain('packed .tgz')
    expect(deps.kernel?.verifyPlugin).not.toHaveBeenCalled()
  })

  it('accepts repeated Agent Tool assertions after Host Service assertions', async () => {
    const streams = io()
    const deps = dependencies('verified')

    const code = await runCli([
      'plugin', 'verify',
      '--profile', 'web',
      '--subject', '/candidate/plugin.tgz',
      '--visibility-service', 'candidateService',
      '--visibility-tool', 'candidate_tool',
      '--visibility-service', 'another/service',
      '--visibility-tool', 'mcp__github__search',
    ], streams.value, deps)

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(deps.kernel?.verifyPlugin).toHaveBeenCalledWith({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate/plugin.tgz' },
      executionPolicy: 'safe',
      visibilityAssertions: [
        { kind: 'host-service', name: 'candidateService' },
        { kind: 'host-service', name: 'another/service' },
        { kind: 'agent-tool', name: 'candidate_tool' },
        { kind: 'agent-tool', name: 'mcp__github__search' },
      ],
    })
  })

  it('rejects duplicate Agent Tool assertions before invoking the kernel', async () => {
    const streams = io()
    const deps = dependencies('verified')

    expect(await runCli([
      'plugin', 'verify',
      '--profile', 'web',
      '--subject', '/candidate/plugin.tgz',
      '--visibility-tool', 'candidate_tool',
      '--visibility-tool', 'candidate_tool',
    ], streams.value, deps)).toBe(2)
    expect(streams.stderr()).toContain('invalid plugin verify request')
    expect(deps.kernel?.verifyPlugin).not.toHaveBeenCalled()
  })

  it('rejects Agent Tool assertions for plugin check before invoking the kernel', async () => {
    const streams = io()
    const deps = dependencies('verified')

    expect(await runCli([
      'plugin', 'check',
      '--profile', 'web',
      '--subject', '/candidate/plugin.tgz',
      '--visibility-tool', 'candidate_tool',
    ], streams.value, deps)).toBe(2)
    expect(streams.stderr()).toContain('verification options')
    expect(deps.kernel?.checkPlugin).not.toHaveBeenCalled()
  })
})
