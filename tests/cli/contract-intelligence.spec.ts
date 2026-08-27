import { describe, expect, it, vi } from 'vitest'

import { runCli, type CliDependencies, type CliIo } from '../../src/frontends/cli/index.js'
import type { ApplicationKernel } from '../../src/kernel/index.js'
import type { ContractInspectResponse, ContractSearchResponse } from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`

function io() {
  let stdout = ''
  let stderr = ''
  const value: CliIo = {
    stdout: { write: chunk => { stdout += chunk; return true } },
    stderr: { write: chunk => { stderr += chunk; return true } },
  }
  return { value, stdout: () => stdout, stderr: () => stderr }
}

function dependencies(
  searchContracts: ApplicationKernel['searchContracts'],
  inspectContract: ApplicationKernel['inspectContract'],
): CliDependencies {
  const kernel = {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('target resolve is not used by contract CLI tests') }),
    searchContracts,
    inspectContract,
  } as ApplicationKernel

  return {
    launchMcp: vi.fn(async () => {}),
    kernel,
    requestId: () => 'contract-cli-request',
  }
}

function searchOutcome(): Awaited<ReturnType<ApplicationKernel['searchContracts']>> {
  return {
    snapshotFingerprint: targetFingerprint,
    data: {
      contractIndexFingerprint,
      matches: [{
        id: 'package:@deepseek-ai/dsh-tools',
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: 'package:@deepseek-ai/dsh-tools',
        availability: 'unknown',
        score: 200,
        evidenceIds: ['manifest:tools'],
      }],
      evidence: [],
    },
  }
}

function inspectOutcome(): Awaited<ReturnType<ApplicationKernel['inspectContract']>> {
  return {
    snapshotFingerprint: targetFingerprint,
    data: {
      contractIndexFingerprint,
      contract: {
        id: 'package:@deepseek-ai/dsh-tools',
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: 'package:@deepseek-ai/dsh-tools',
        availability: 'unknown',
        facts: [],
        evidenceIds: ['manifest:tools'],
      },
      evidence: [],
    },
  }
}

describe('Contract Intelligence CLI projection', () => {
  it('parses contract search into the canonical Protocol request and renders success JSON', async () => {
    const streams = io()
    const searchContracts = vi.fn(async () => searchOutcome())
    const inspectContract = vi.fn(async () => inspectOutcome())

    const code = await runCli([
      'contract', 'search',
      '--profile', 'web',
      '--query', 'ToolDefinition',
      '--kind', 'package',
      '--kind', 'tool',
      '--limit', '5',
      '--dsh-home', '/tmp/dsh-home',
      '--patch', '/tmp/overlay.yml',
    ], streams.value, dependencies(searchContracts, inspectContract))

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(searchContracts).toHaveBeenCalledWith({
      target: {
        profile: 'web',
        dshHome: '/tmp/dsh-home',
        patches: ['/tmp/overlay.yml'],
      },
      query: 'ToolDefinition',
      kinds: ['package', 'tool'],
      limit: 5,
    })

    const response = JSON.parse(streams.stdout()) as ContractSearchResponse
    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'contract-cli-request',
      snapshotFingerprint: targetFingerprint,
      status: 'ok',
      data: { contractIndexFingerprint },
      diagnostics: [],
    })
  })

  it('parses contract inspect into the canonical Protocol request and renders success JSON', async () => {
    const streams = io()
    const searchContracts = vi.fn(async () => searchOutcome())
    const inspectContract = vi.fn(async () => inspectOutcome())

    const code = await runCli([
      'contract', 'inspect',
      '--profile', 'web',
      '--contract-index', contractIndexFingerprint,
      '--contract-id', 'package:@deepseek-ai/dsh-tools',
    ], streams.value, dependencies(searchContracts, inspectContract))

    expect(code).toBe(0)
    expect(streams.stderr()).toBe('')
    expect(inspectContract).toHaveBeenCalledWith({
      target: { profile: 'web' },
      contractIndexFingerprint,
      contractId: 'package:@deepseek-ai/dsh-tools',
    })

    const response = JSON.parse(streams.stdout()) as ContractInspectResponse
    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'contract-cli-request',
      snapshotFingerprint: targetFingerprint,
      status: 'ok',
      data: {
        contractIndexFingerprint,
        contract: { id: 'package:@deepseek-ai/dsh-tools' },
      },
      diagnostics: [],
    })
  })

  it('rejects missing query and invalid search limit before invoking the kernel', async () => {
    const searchContracts = vi.fn(async () => searchOutcome())
    const inspectContract = vi.fn(async () => inspectOutcome())

    const missingQuery = io()
    expect(await runCli(
      ['contract', 'search', '--profile', 'web'],
      missingQuery.value,
      dependencies(searchContracts, inspectContract),
    )).toBe(2)
    expect(missingQuery.stderr()).toContain('--query is required')

    const invalidLimit = io()
    expect(await runCli(
      ['contract', 'search', '--profile', 'web', '--query', 'tool', '--limit', '26'],
      invalidLimit.value,
      dependencies(searchContracts, inspectContract),
    )).toBe(2)
    expect(invalidLimit.stderr()).toContain('--limit must be an integer from 1 to 25')
    expect(searchContracts).not.toHaveBeenCalled()
  })

  it('advertises implemented contract commands but not future plugin verification', async () => {
    const streams = io()
    const code = await runCli(
      ['--help'],
      streams.value,
      dependencies(async () => searchOutcome(), async () => inspectOutcome()),
    )

    expect(code).toBe(0)
    expect(streams.stdout()).toContain('contract search')
    expect(streams.stdout()).toContain('contract inspect')
    expect(streams.stdout()).not.toContain('plugin verify')
  })
})
