import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import ToolchainService from '../../src/integrations/dsh/index.js'
import type {
  OperationCancelResponse,
  OperationGetResponse,
  OperationRequest,
  PluginVerifyRequest,
  PluginVerifyStartResponse,
} from '../../src/protocol/index.js'

const dshHome = fileURLToPath(new URL('../fixtures/targets/valid/dsh-home/', import.meta.url))
const dshPackageRoot = fileURLToPath(new URL('../fixtures/targets/valid/dsh-package/', import.meta.url))

interface OperationCapableToolchain {
  startPluginVerification(
    request: PluginVerifyRequest,
    requestId?: string,
  ): Promise<PluginVerifyStartResponse>
  getOperation(
    request: OperationRequest,
    requestId?: string,
  ): Promise<OperationGetResponse>
  cancelOperation(
    request: OperationRequest,
    requestId?: string,
  ): Promise<OperationCancelResponse>
}

async function terminalOperation(
  toolchain: OperationCapableToolchain,
  id: string,
): Promise<OperationGetResponse> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await toolchain.getOperation({ id }, `dsh-operation-get-${attempt}`)
    if (response.status !== 'ok') return response
    if (['succeeded', 'failed', 'cancelled'].includes(response.data.operation.state)) return response
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('verification operation did not reach a terminal state')
}

describe('ToolchainService lifecycle', () => {
  it('mounts ctx.toolchain from the shared kernel and removes it on dispose', async () => {
    const ctx = new Context()
    expect(ctx.get('toolchain')).toBeUndefined()

    const fiber = await ctx.plugin(ToolchainService)
    expect(ctx.toolchain.describe()).toEqual({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    })

    await fiber.dispose()
    expect(ctx.get('toolchain')).toBeUndefined()
  })

  it('projects target resolution through the shared Protocol response path', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)

    const response = await ctx.toolchain.resolveTarget({
      profile: 'web',
      dshHome,
      dshPackageRoot,
    }, 'dsh-service-success')

    expect(response.status).toBe('ok')
    expect(response.requestId).toBe('dsh-service-success')
    if (response.status === 'ok') {
      expect(response.snapshotFingerprint).toBe(response.data.snapshot.fingerprint)
      expect(response.snapshotFingerprint).toMatch(/^dsh-target-v2:[0-9a-f]{64}$/)
      expect(response.data.snapshot.dsh).toEqual({
        name: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
      })
      expect(response.data.snapshot.profile.name).toBe('web')
    }

    await fiber.dispose()
  })

  it('projects contract search and inspect through the shared Protocol response paths', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)
    const target = { profile: 'web', dshHome, dshPackageRoot }

    const search = await ctx.toolchain.searchContracts({
      target,
      query: 'a-user-plugin',
    }, 'dsh-contract-search')

    expect(search).toMatchObject({
      protocolVersion: '1',
      requestId: 'dsh-contract-search',
      status: 'ok',
      snapshotFingerprint: expect.stringMatching(/^dsh-target-v2:[0-9a-f]{64}$/),
      data: {
        contractIndexFingerprint: expect.stringMatching(/^dsh-contract-index-v1:[0-9a-f]{64}$/),
      },
    })
    if (search.status !== 'ok') throw new Error('contract search unexpectedly failed')
    const match = search.data.matches.find(item => item.id === 'package:a-user-plugin')
    expect(match).toBeDefined()

    const inspect = await ctx.toolchain.inspectContract({
      target,
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:a-user-plugin',
    }, 'dsh-contract-inspect')

    expect(inspect).toMatchObject({
      protocolVersion: '1',
      requestId: 'dsh-contract-inspect',
      status: 'ok',
      snapshotFingerprint: search.snapshotFingerprint,
      data: {
        contractIndexFingerprint: search.data.contractIndexFingerprint,
        contract: {
          id: 'package:a-user-plugin',
          kind: 'package',
          availability: 'unknown',
        },
      },
    })

    await fiber.dispose()
  })

  it('preserves shared target diagnostic identity for expected acquisition failures', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)

    const response = await ctx.toolchain.resolveTarget({
      profile: 'missing',
      dshHome,
      dshPackageRoot,
    }, 'dsh-service-failure')

    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'dsh-service-failure',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
      }],
    })

    await fiber.dispose()
  })

  it('owns one persistent verification operation manager across start, get, and cancel calls', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)
    const toolchain = ctx.toolchain as unknown as OperationCapableToolchain
    const request: PluginVerifyRequest = {
      target: {
        profile: 'missing',
        dshHome,
        dshPackageRoot,
      },
      subject: { kind: 'packed', path: '/candidate/not-reached.tgz' },
      executionPolicy: 'safe',
    }

    const started = await toolchain.startPluginVerification(request, 'dsh-operation-start')
    expect(started).toMatchObject({
      protocolVersion: '1',
      requestId: 'dsh-operation-start',
      status: 'ok',
      data: {
        operation: {
          kind: 'plugin.verify',
          state: 'queued',
          cancellationRequested: false,
          diagnostics: [],
        },
      },
      diagnostics: [],
    })
    if (started.status !== 'ok') throw new Error('operation start unexpectedly failed')
    const operationId = started.data.operation.id

    const terminal = await terminalOperation(toolchain, operationId)
    expect(terminal.status).toBe('ok')
    if (terminal.status !== 'ok') throw new Error('operation lookup unexpectedly failed')
    expect(terminal.data.operation).toMatchObject({
      id: operationId,
      state: 'failed',
      cancellationRequested: false,
      result: {
        protocolVersion: '1',
        requestId: 'dsh-operation-start',
        status: 'failed',
        diagnostics: [{ code: 'TARGET_PROFILE_NOT_FOUND', domain: 'target' }],
      },
    })

    const lateCancel = await toolchain.cancelOperation(
      { id: operationId },
      'dsh-operation-cancel',
    )
    expect(lateCancel.status).toBe('ok')
    if (lateCancel.status !== 'ok') throw new Error('operation cancel unexpectedly failed')
    expect(lateCancel.requestId).toBe('dsh-operation-cancel')
    expect(lateCancel.data.operation).toEqual(terminal.data.operation)

    const missing = await toolchain.getOperation(
      { id: 'operation-that-does-not-exist' },
      'dsh-operation-missing',
    )
    expect(missing).toEqual({
      protocolVersion: '1',
      requestId: 'dsh-operation-missing',
      status: 'failed',
      diagnostics: [{
        code: 'OPERATION_NOT_FOUND',
        severity: 'error',
        domain: 'operation',
        summary: 'OPERATION_NOT_FOUND: Operation is unknown or no longer retained by this Toolchain host.',
      }],
    })

    await fiber.dispose()
  })
})
