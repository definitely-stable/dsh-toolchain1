import { describe, expect, it } from 'vitest'

import { runCli, type CliIo } from '../../src/frontends/cli/index.js'
import {
  createContractInspectMcpTool,
  createContractSearchMcpTool,
} from '../../src/frontends/mcp/index.js'
import {
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import {
  createApplicationKernel,
  inspectContractResponse,
  searchContractsResponse,
} from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type {
  ContractInspectRequest,
  ContractInspectResponse,
  ContractSearchRequest,
  ContractSearchResponse,
} from '../../src/protocol/index.js'

function targetFacts(): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [{ name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' }],
      profilePatchHash: '1'.repeat(64),
      homePatchHash: '2'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
    supportStatus: 'tested',
  }
}

function contractFacts(): AcquiredContractFacts {
  return {
    evidence: [{
      id: 'manifest:dsh-tools',
      kind: 'manifest',
      strength: 'authoritative',
      source: '@deepseek-ai/dsh-tools/package.json',
      contentHash: '3'.repeat(64),
    }],
    contracts: [{
      id: 'package:@deepseek-ai/dsh-tools',
      kind: 'package',
      name: '@deepseek-ai/dsh-tools',
      qualifiedName: 'package:@deepseek-ai/dsh-tools',
      availability: 'unknown',
      summary: 'Installed DSH tools package',
      facts: [{
        key: 'declaration-export',
        value: 'ToolDefinition',
        evidenceIds: ['manifest:dsh-tools'],
      }],
      evidenceIds: ['manifest:dsh-tools'],
    }],
  }
}

function kernel() {
  const digest: Sha256Port = { sha256Utf8: async () => 'a'.repeat(64) }
  return createApplicationKernel({
    targetAcquisition: { acquire: async () => targetFacts() },
    contractAcquisition: { acquire: async () => contractFacts() },
    digest,
    now: () => '2026-08-27T00:00:00.000Z',
  })
}

function normalized<T extends ContractSearchResponse | ContractInspectResponse>(response: T): T {
  return { ...response, requestId: '<transport-owned>' }
}

function cliIo() {
  let stdout = ''
  let stderr = ''
  const io: CliIo = {
    stdout: { write: value => { stdout += value; return true } },
    stderr: { write: value => { stderr += value; return true } },
  }
  return { io, stdout: () => stdout, stderr: () => stderr }
}

async function searchThroughCli(
  request: ContractSearchRequest,
  appKernel: ReturnType<typeof kernel>,
): Promise<ContractSearchResponse> {
  const streams = cliIo()
  const args = ['contract', 'search', '--profile', request.target.profile, '--query', request.query]
  for (const kind of request.kinds ?? []) args.push('--kind', kind)
  if (request.limit !== undefined) args.push('--limit', String(request.limit))
  if (request.target.dshHome !== undefined) args.push('--dsh-home', request.target.dshHome)
  if (request.target.dshPackageRoot !== undefined) args.push('--dsh-package-root', request.target.dshPackageRoot)
  for (const patch of request.target.patches ?? []) args.push('--patch', patch)

  const exitCode = await runCli(args, streams.io, {
    launchMcp: async () => undefined,
    kernel: appKernel,
    requestId: () => 'cli-search',
  })
  expect(streams.stderr()).toBe('')
  const response = JSON.parse(streams.stdout().trim()) as ContractSearchResponse
  expect(exitCode).toBe(response.status === 'ok' ? 0 : 1)
  return response
}

async function inspectThroughCli(
  request: ContractInspectRequest,
  appKernel: ReturnType<typeof kernel>,
): Promise<ContractInspectResponse> {
  const streams = cliIo()
  const args = [
    'contract', 'inspect',
    '--profile', request.target.profile,
    '--contract-index', request.contractIndexFingerprint,
    '--contract-id', request.contractId,
  ]

  const exitCode = await runCli(args, streams.io, {
    launchMcp: async () => undefined,
    kernel: appKernel,
    requestId: () => 'cli-inspect',
  })
  expect(streams.stderr()).toBe('')
  const response = JSON.parse(streams.stdout().trim()) as ContractInspectResponse
  expect(exitCode).toBe(response.status === 'ok' ? 0 : 1)
  return response
}

async function expectSearchRejected(
  cliArgs: readonly string[],
  rawRequest: unknown,
): Promise<void> {
  const appKernel = kernel()
  const streams = cliIo()
  const cliCode = await runCli(
    ['contract', 'search', ...cliArgs],
    streams.io,
    {
      launchMcp: async () => undefined,
      kernel: appKernel,
      requestId: () => 'invalid-cli-search',
    },
  )
  expect(cliCode).toBe(2)
  expect(streams.stdout()).toBe('')
  expect(streams.stderr()).not.toBe('')

  const dshTool = createContractSearchToolDefinition(
    candidate => searchContractsResponse(appKernel, candidate, 'invalid-dsh-search'),
  )
  const mcpTool = createContractSearchMcpTool(appKernel, () => 'invalid-mcp-search')

  await expect(Promise.resolve().then(() => dshTool.execute(rawRequest)))
    .rejects.toThrow(/invalid contract\.search arguments/i)
  await expect(Promise.resolve().then(() => mcpTool.callback(rawRequest as ContractSearchRequest)))
    .rejects.toThrow(/invalid contract\.search arguments/i)
}

async function expectInspectRejected(
  cliArgs: readonly string[],
  rawRequest: unknown,
): Promise<void> {
  const appKernel = kernel()
  const streams = cliIo()
  const cliCode = await runCli(
    ['contract', 'inspect', ...cliArgs],
    streams.io,
    {
      launchMcp: async () => undefined,
      kernel: appKernel,
      requestId: () => 'invalid-cli-inspect',
    },
  )
  expect(cliCode).toBe(2)
  expect(streams.stdout()).toBe('')
  expect(streams.stderr()).not.toBe('')

  const dshTool = createContractInspectToolDefinition(
    candidate => inspectContractResponse(appKernel, candidate, 'invalid-dsh-inspect'),
  )
  const mcpTool = createContractInspectMcpTool(appKernel, () => 'invalid-mcp-inspect')

  await expect(Promise.resolve().then(() => dshTool.execute(rawRequest)))
    .rejects.toThrow(/invalid contract\.inspect arguments/i)
  await expect(Promise.resolve().then(() => mcpTool.callback(rawRequest as ContractInspectRequest)))
    .rejects.toThrow(/invalid contract\.inspect arguments/i)
}

describe('Contract Intelligence frontend semantic parity', () => {
  it('projects one successful search identically through CLI, native DSH and MCP', async () => {
    const appKernel = kernel()
    const request: ContractSearchRequest = {
      target: { profile: 'web' },
      query: 'ToolDefinition',
      kinds: ['package'],
      limit: 5,
    }
    const reference = await searchContractsResponse(appKernel, request, 'reference-search')
    const dshTool = createContractSearchToolDefinition(
      candidate => searchContractsResponse(appKernel, candidate, 'dsh-search'),
    )
    const mcpTool = createContractSearchMcpTool(appKernel, () => 'mcp-search')

    const results = await Promise.all([
      searchThroughCli(request, appKernel),
      dshTool.execute(request) as Promise<ContractSearchResponse>,
      mcpTool.callback(request).then(result => result.structuredContent),
    ])

    for (const result of results) expect(normalized(result)).toEqual(normalized(reference))
  })

  it('projects stale inspect identically through CLI, native DSH and MCP', async () => {
    const appKernel = kernel()
    const request: ContractInspectRequest = {
      target: { profile: 'web' },
      contractIndexFingerprint: `dsh-contract-index-v1:${'9'.repeat(64)}`,
      contractId: 'package:@deepseek-ai/dsh-tools',
    }
    const reference = await inspectContractResponse(appKernel, request, 'reference-inspect')
    const dshTool = createContractInspectToolDefinition(
      candidate => inspectContractResponse(appKernel, candidate, 'dsh-inspect'),
    )
    const mcpTool = createContractInspectMcpTool(appKernel, () => 'mcp-inspect')

    const results = await Promise.all([
      inspectThroughCli(request, appKernel),
      dshTool.execute(request) as Promise<ContractInspectResponse>,
      mcpTool.callback(request).then(result => result.structuredContent),
    ])

    expect(reference.status).toBe('stale')
    for (const result of results) {
      expect(normalized(result)).toEqual(normalized(reference))
      expect(result).toMatchObject({
        status: 'stale',
        diagnostics: [{ code: 'CONTRACT_INDEX_STALE', domain: 'contract' }],
      })
    }
  })

  it.each([
    [
      'whitespace-only query',
      ['--profile', 'web', '--query', '   '],
      { target: { profile: 'web' }, query: '   ' },
    ],
    [
      'duplicate kinds',
      ['--profile', 'web', '--query', 'tool', '--kind', 'tool', '--kind', 'tool'],
      { target: { profile: 'web' }, query: 'tool', kinds: ['tool', 'tool'] },
    ],
    [
      'lower limit breach',
      ['--profile', 'web', '--query', 'tool', '--limit', '0'],
      { target: { profile: 'web' }, query: 'tool', limit: 0 },
    ],
    [
      'upper limit breach',
      ['--profile', 'web', '--query', 'tool', '--limit', '26'],
      { target: { profile: 'web' }, query: 'tool', limit: 26 },
    ],
    [
      'unknown property',
      ['--profile', 'web', '--query', 'tool', '--unexpected'],
      { target: { profile: 'web' }, query: 'tool', unexpected: true },
    ],
    [
      'invalid target value',
      ['--profile', '..', '--query', 'tool'],
      { target: { profile: '..' }, query: 'tool' },
    ],
  ] as const)(
    'rejects %s before contract.search kernel semantics through CLI, native DSH and MCP',
    async (_name, cliArgs, rawRequest) => {
      await expectSearchRejected(cliArgs, rawRequest)
    },
  )

  it.each([
    [
      'malformed index fingerprint',
      ['--profile', 'web', '--contract-index', 'bad', '--contract-id', 'package:x'],
      { target: { profile: 'web' }, contractIndexFingerprint: 'bad', contractId: 'package:x' },
    ],
    [
      'unknown property',
      [
        '--profile', 'web',
        '--contract-index', `dsh-contract-index-v1:${'9'.repeat(64)}`,
        '--contract-id', 'package:x',
        '--unexpected',
      ],
      {
        target: { profile: 'web' },
        contractIndexFingerprint: `dsh-contract-index-v1:${'9'.repeat(64)}`,
        contractId: 'package:x',
        unexpected: true,
      },
    ],
    [
      'invalid target value',
      [
        '--profile', '..',
        '--contract-index', `dsh-contract-index-v1:${'9'.repeat(64)}`,
        '--contract-id', 'package:x',
      ],
      {
        target: { profile: '..' },
        contractIndexFingerprint: `dsh-contract-index-v1:${'9'.repeat(64)}`,
        contractId: 'package:x',
      },
    ],
  ] as const)(
    'rejects %s before contract.inspect kernel semantics through CLI, native DSH and MCP',
    async (_name, cliArgs, rawRequest) => {
      await expectInspectRejected(cliArgs, rawRequest)
    },
  )
})
