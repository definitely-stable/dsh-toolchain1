import { describe, expect, it, vi } from 'vitest'

import {
  buildMcpServer,
  createVerificationOperationMcpTools,
} from '../../src/frontends/mcp/index.js'
import type { ApplicationKernel } from '../../src/kernel/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const artifactFingerprint = `dsh-plugin-artifact-v1:${'9'.repeat(64)}`

function kernel(): ApplicationKernel {
  return {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => { throw new Error('unused') }),
    verifyPlugin: vi.fn(async (_request, signal) => ({
      snapshotFingerprint: targetFingerprint,
      data: {
        status: signal?.aborted ? 'cancelled' as const : 'verified' as const,
        artifactFingerprint,
        targetFingerprint,
        executionPolicy: 'safe' as const,
        checks: [],
        diagnostics: [],
        cleanup: 'succeeded' as const,
      },
    })),
  }
}

const request = {
  target: { profile: 'web' },
  subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
  executionPolicy: 'safe' as const,
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve))
  await Promise.resolve()
}

describe('MCP verification operation lifecycle', () => {
  it('projects start/get/cancel with canonical schemas and correct MCP annotations', () => {
    const app = kernel()
    const tools = createVerificationOperationMcpTools(
      app,
      () => 'mcp-request',
      () => 'op-1',
    )
    const server = buildMcpServer({
      kernel: app,
      requestId: () => 'mcp-request',
      operationId: () => 'op-1',
    })

    expect(tools.start.name).toBe('plugin.verify.start')
    expect(tools.start.config.annotations).toEqual({ readOnlyHint: false, idempotentHint: false })
    expect(tools.get.name).toBe('operation.get')
    expect(tools.get.config.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })
    expect(tools.cancel.name).toBe('operation.cancel')
    expect(tools.cancel.config.annotations).toEqual({ readOnlyHint: false, idempotentHint: false })

    expect(server.toolInputSchemaJson('plugin.verify.start')).toMatchObject({
      $ref: '#/$defs/pluginVerifyRequest',
    })
    expect(server.toolInputSchemaJson('operation.get')).toMatchObject({
      $ref: '#/$defs/operationRequest',
    })
    expect(server.toolInputSchemaJson('operation.cancel')).toMatchObject({
      $ref: '#/$defs/operationRequest',
    })
  })

  it('shares one persistent manager across start and get and preserves the nested canonical verification response', async () => {
    const app = kernel()
    let requestSequence = 0
    const tools = createVerificationOperationMcpTools(
      app,
      () => `mcp-${++requestSequence}`,
      () => 'op-shared',
    )

    const started = await tools.start.callback(request)
    expect(started.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-1',
      status: 'ok',
      data: {
        operation: {
          id: 'op-shared',
          state: 'queued',
          kind: 'plugin.verify',
        },
      },
    })

    await flush()
    await flush()
    const found = await tools.get.callback({ id: 'op-shared' })
    expect(found.structuredContent).toMatchObject({
      protocolVersion: '1',
      requestId: 'mcp-2',
      status: 'ok',
      data: {
        operation: {
          id: 'op-shared',
          state: 'succeeded',
          result: {
            protocolVersion: '1',
            requestId: 'mcp-1',
            status: 'ok',
            data: { status: 'verified', artifactFingerprint },
          },
        },
      },
    })
    expect(JSON.parse(found.content[0]?.type === 'text' ? found.content[0].text : 'null'))
      .toEqual(found.structuredContent)
  })

  it('uses the same manager for cooperative cancellation and canonical id parsing', async () => {
    const app = kernel()
    let resolve!: () => void
    app.verifyPlugin = vi.fn(async (_request, signal) => {
      await new Promise<void>(done => { resolve = done })
      return {
        snapshotFingerprint: targetFingerprint,
        data: {
          status: signal?.aborted ? 'cancelled' as const : 'verified' as const,
          artifactFingerprint,
          targetFingerprint,
          executionPolicy: 'safe' as const,
          checks: [],
          diagnostics: [],
          cleanup: 'succeeded' as const,
        },
      }
    })
    const tools = createVerificationOperationMcpTools(
      app,
      () => 'mcp-request',
      () => 'op-cancel',
    )

    await tools.start.callback(request)
    await flush()
    const cancelling = await tools.cancel.callback({ id: 'op-cancel' })
    expect(cancelling.structuredContent).toMatchObject({
      status: 'ok',
      data: { operation: { id: 'op-cancel', state: 'running', cancellationRequested: true } },
    })
    resolve()
    await flush()
    await flush()
    const terminal = await tools.get.callback({ id: 'op-cancel' })
    expect(terminal.structuredContent).toMatchObject({
      status: 'ok',
      data: { operation: { state: 'cancelled', cancellationRequested: true } },
    })

    await expect(Promise.resolve().then(() => tools.get.callback({ id: '   ' })))
      .rejects.toThrow(TypeError)
  })

  it('fails lifecycle calls clearly when the injected kernel has no verification capability', async () => {
    const app = kernel()
    delete app.verifyPlugin
    const tools = createVerificationOperationMcpTools(
      app,
      () => 'mcp-request',
      () => 'op-unused',
    )

    await expect(tools.start.callback(request)).rejects.toThrow(/verification execution is not configured/i)
    await expect(tools.get.callback({ id: 'op-unused' })).rejects.toThrow(/verification execution is not configured/i)
    await expect(tools.cancel.callback({ id: 'op-unused' })).rejects.toThrow(/verification execution is not configured/i)
  })
})
