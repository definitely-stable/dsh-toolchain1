import { describe, expect, it, vi } from 'vitest'

import { runCli, type CliDependencies, type CliIo } from '../../src/frontends/cli/index.js'
import type { ApplicationKernel, PluginCheckOutcome } from '../../src/kernel/index.js'
import type { PluginCheckResponse } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
const subjectFingerprint = `dsh-plugin-subject-v1:${'c'.repeat(64)}`

function io() {
  let stdout = ''
  let stderr = ''
  const value: CliIo = {
    stdout: { write: chunk => { stdout += chunk; return true } },
    stderr: { write: chunk => { stderr += chunk; return true } },
  }
  return { value, stdout: () => stdout, stderr: () => stderr }
}

function outcome(verdict: PluginCheckOutcome['data']['verdict']): PluginCheckOutcome {
  return {
    snapshotFingerprint: targetFingerprint,
    data: {
      contractIndexFingerprint,
      subjectFingerprint,
      subjectCompleteness: 'complete',
      ruleset: 'plugin-static-alpha-v1',
      scopeComplete: false,
      verdict,
      requirements: [],
      evidence: [],
      candidateCodeExecuted: false,
    },
    diagnostics: [],
  }
}

function dependencies(verdict: PluginCheckOutcome['data']['verdict']): CliDependencies {
  const kernel: ApplicationKernel = {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => outcome(verdict)),
  }
  return { launchMcp: vi.fn(async () => {}), kernel, requestId: () => 'plugin-cli-request' }
}

describe('plugin.check CLI projection', () => {
  it('parses one exact target plus plugin directory and returns zero only for compatible-in-scope', async () => {
    const streams = io()
    const deps = dependencies('compatible-in-scope')

    const code = await runCli([
      'plugin', 'check',
      '--profile', 'web',
      '--subject', '/candidate',
      '--dsh-home', '/tmp/dsh-home',
      '--patch', '/tmp/overlay.yml',
    ], streams.value, deps)

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(deps.kernel?.checkPlugin).toHaveBeenCalledWith({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/overlay.yml'],
      },
      subject: { kind: 'directory', path: '/candidate' },
    })
    const response = JSON.parse(streams.stdout()) as PluginCheckResponse
    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'plugin-cli-request',
      status: 'ok',
      snapshotFingerprint: targetFingerprint,
      data: {
        verdict: 'compatible-in-scope',
        scopeComplete: false,
        candidateCodeExecuted: false,
      },
    })
  })

  it('classifies a .tgz path as one packed plugin subject without inspecting or extracting it in the CLI layer', async () => {
    const streams = io()
    const deps = dependencies('unproven')

    const code = await runCli(
      ['plugin', 'check', '--profile', 'web', '--subject', '/candidate/example-plugin.tgz'],
      streams.value,
      deps,
    )

    expect(code).toBe(1)
    expect(streams.stderr()).toBe('')
    expect(deps.kernel?.checkPlugin).toHaveBeenCalledWith({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate/example-plugin.tgz' },
    })
  })

  it('keeps Protocol status ok for an incompatible plugin but fails the CLI process for CI use', async () => {
    const streams = io()
    const code = await runCli(
      ['plugin', 'check', '--profile', 'web', '--subject', '/candidate'],
      streams.value,
      dependencies('incompatible'),
    )

    expect(code).toBe(1)
    const response = JSON.parse(streams.stdout()) as PluginCheckResponse
    expect(response).toMatchObject({ status: 'ok', data: { verdict: 'incompatible' } })
  })

  it('rejects a missing plugin subject before invoking the kernel', async () => {
    const streams = io()
    const deps = dependencies('compatible-in-scope')

    const code = await runCli(
      ['plugin', 'check', '--profile', 'web'],
      streams.value,
      deps,
    )

    expect(code).toBe(2)
    expect(streams.stderr()).toContain('--subject is required')
    expect(deps.kernel?.checkPlugin).not.toHaveBeenCalled()
  })
})
