import { describe, expect, it } from 'vitest'

import { runCli, type CliIo } from '../../src/frontends/cli/index.js'
import { createTargetResolveMcpTool } from '../../src/frontends/mcp/index.js'
import { createTargetResolveToolDefinition } from '../../src/integrations/dsh/target-tool.js'
import { createApplicationKernel, resolveTargetResponse } from '../../src/kernel/index.js'
import type { Sha256Port } from '../../src/model/digest.js'
import {
  TargetAcquisitionError,
  type AcquiredTargetFacts,
  type TargetAcquisitionPort,
} from '../../src/model/target.js'
import type {
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../src/protocol/index.js'

function acquiredFacts(): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: '1'.repeat(64) },
      ],
      dependencies: [{ name: 'user-plugin', version: '1.2.3' }],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
    supportStatus: 'tested',
  }
}

function kernelWith(acquire: TargetAcquisitionPort['acquire']) {
  const digest: Sha256Port = { sha256Utf8: async () => 'a'.repeat(64) }
  return createApplicationKernel({
    targetAcquisition: { acquire },
    digest,
    now: () => '2026-08-27T00:00:00.000Z',
  })
}

function normalized(response: TargetResolveResponse): TargetResolveResponse {
  return { ...response, requestId: '<transport-owned>' }
}

async function throughCli(
  request: TargetResolveRequest,
  kernel: ReturnType<typeof kernelWith>,
): Promise<TargetResolveResponse> {
  let stdout = ''
  let stderr = ''
  const io: CliIo = {
    stdout: { write: value => { stdout += value; return true } },
    stderr: { write: value => { stderr += value; return true } },
  }
  const args = ['target', 'resolve', '--profile', request.profile]
  if (request.dshHome !== undefined) args.push('--dsh-home', request.dshHome)
  if (request.dshPackageRoot !== undefined) args.push('--dsh-package-root', request.dshPackageRoot)
  for (const patch of request.patches ?? []) args.push('--patch', patch)

  const exitCode = await runCli(args, io, {
    launchMcp: async () => undefined,
    kernel,
    requestId: () => 'cli-request',
  })
  expect(stderr).toBe('')
  const response = JSON.parse(stdout.trim()) as TargetResolveResponse
  expect(exitCode).toBe(response.status === 'ok' ? 0 : 1)
  return response
}

async function throughDshTool(
  request: TargetResolveRequest,
  kernel: ReturnType<typeof kernelWith>,
): Promise<TargetResolveResponse> {
  const definition = createTargetResolveToolDefinition(
    candidate => resolveTargetResponse(kernel, candidate, 'dsh-request'),
  )
  return await definition.execute(request) as TargetResolveResponse
}

async function throughMcp(
  request: TargetResolveRequest,
  kernel: ReturnType<typeof kernelWith>,
): Promise<TargetResolveResponse> {
  const tool = createTargetResolveMcpTool(kernel, () => 'mcp-request')
  const result = await tool.callback(request)
  return result.structuredContent
}

describe('target.resolve frontend semantic parity', () => {
  it('projects one successful target result through CLI, native DSH tool and MCP', async () => {
    const request: TargetResolveRequest = {
      profile: 'web',
      dshHome: '/target/home',
      dshPackageRoot: '/target/dsh',
      patches: ['/target/overlay.yml'],
    }
    const kernel = kernelWith(async () => acquiredFacts())
    const reference = await resolveTargetResponse(kernel, request, 'reference')

    const results = await Promise.all([
      throughCli(request, kernel),
      throughDshTool(request, kernel),
      throughMcp(request, kernel),
    ])

    for (const result of results) {
      expect(normalized(result)).toEqual(normalized(reference))
    }
  })

  it('projects one expected target failure with the same diagnostic identity everywhere', async () => {
    const request: TargetResolveRequest = { profile: 'missing' }
    const kernel = kernelWith(async () => {
      throw new TargetAcquisitionError(
        'TARGET_PROFILE_NOT_FOUND',
        'DSH profile was not found',
        ['/target/profiles/missing/package.json'],
      )
    })
    const reference = await resolveTargetResponse(kernel, request, 'reference')

    const results = await Promise.all([
      throughCli(request, kernel),
      throughDshTool(request, kernel),
      throughMcp(request, kernel),
    ])

    for (const result of results) {
      expect(normalized(result)).toEqual(normalized(reference))
      expect(result).toMatchObject({
        status: 'failed',
        diagnostics: [{ code: 'TARGET_PROFILE_NOT_FOUND', domain: 'target' }],
      })
    }
  })
})
