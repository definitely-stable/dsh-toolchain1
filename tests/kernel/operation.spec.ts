import { describe, expect, it, vi } from 'vitest'

import {
  verifyPluginResponse,
  type VerificationApplicationKernel,
} from '../../src/kernel/index.js'
import type {
  Operation,
  PluginVerifyRequest,
  PluginVerifyResponse,
  VerificationReport,
} from '../../src/protocol/index.js'

const request: PluginVerifyRequest = {
  target: { profile: 'web' },
  subject: { kind: 'packed', path: '/tmp/plugin.tgz' },
  executionPolicy: 'safe',
}

function report(status: VerificationReport['status']): VerificationReport {
  return {
    status,
    artifactFingerprint: `dsh-plugin-artifact-v1:${'b'.repeat(64)}`,
    targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    executionPolicy: 'safe',
    checks: [
      { id: 'structure', status: 'passed' },
      { id: 'manifest', status: 'passed' },
      { id: 'dependency', status: 'passed' },
      { id: 'contract', status: 'passed' },
      { id: 'build', status: 'skipped', reason: 'not-covered' },
      { id: 'package', status: 'passed' },
      { id: 'install', status: 'passed' },
      { id: 'compose', status: 'passed' },
      { id: 'boot', status: 'passed' },
      { id: 'visibility', status: 'skipped', reason: 'no-visibility-assertions' },
      { id: 'behavior', status: 'skipped', reason: 'not-covered' },
    ],
    diagnostics: [],
    cleanup: 'succeeded',
  }
}

function response(status: VerificationReport['status'], requestId = 'start-request'): PluginVerifyResponse {
  return {
    protocolVersion: '1',
    requestId,
    snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    status: 'ok',
    data: report(status),
    diagnostics: [],
  }
}

async function operationModule(): Promise<{
  createVerificationOperationManager: (options: {
    execute: (request: PluginVerifyRequest, requestId: string, signal: AbortSignal) => Promise<PluginVerifyResponse>
    operationId: () => string
    maxActive?: number
    maxRetainedCompleted?: number
  }) => {
    start(request: PluginVerifyRequest, requestId: string): Operation
    get(id: string): Operation
    cancel(id: string): Operation
  }
}> {
  const path = '../../src/kernel/operation.js'
  return import(path) as Promise<{
    createVerificationOperationManager: (options: {
      execute: (request: PluginVerifyRequest, requestId: string, signal: AbortSignal) => Promise<PluginVerifyResponse>
      operationId: () => string
      maxActive?: number
      maxRetainedCompleted?: number
    }) => {
      start(request: PluginVerifyRequest, requestId: string): Operation
      get(id: string): Operation
      cancel(id: string): Operation
    }
  }>
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve))
  await Promise.resolve()
}

describe('M4.4 verification operation manager', () => {
  it('forwards the caller AbortSignal through the canonical verification response mapper', async () => {
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    const kernel = {
      async verifyPlugin(_request: PluginVerifyRequest, signal?: AbortSignal) {
        observedSignal = signal
        return {
          snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
          data: report('verified'),
        }
      },
    } as VerificationApplicationKernel

    const mapper = verifyPluginResponse as unknown as (
      kernel: VerificationApplicationKernel,
      request: PluginVerifyRequest,
      requestId: string,
      signal?: AbortSignal,
    ) => Promise<PluginVerifyResponse>

    await mapper(kernel, request, 'direct-request', controller.signal)
    expect(observedSignal).toBe(controller.signal)
  })

  it('returns a real queued snapshot and queued cancellation prevents execution', async () => {
    const { createVerificationOperationManager } = await operationModule()
    const execute = vi.fn(async () => response('verified'))
    const manager = createVerificationOperationManager({
      execute,
      operationId: () => 'op-queued',
    })

    const queued = manager.start(request, 'start-request')
    expect(queued).toEqual({
      id: 'op-queued',
      kind: 'plugin.verify',
      state: 'queued',
      cancellationRequested: false,
      diagnostics: [],
    })

    const cancelled = manager.cancel('op-queued')
    expect(cancelled).toMatchObject({
      id: 'op-queued',
      state: 'cancelled',
      cancellationRequested: true,
    })
    await flush()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    ['verified', 'succeeded'],
    ['failed', 'succeeded'],
    ['partial', 'succeeded'],
    ['stale', 'succeeded'],
    ['cancelled', 'cancelled'],
  ] as const)('maps canonical verification report %s to operation %s', async (reportStatus, operationState) => {
    const { createVerificationOperationManager } = await operationModule()
    const manager = createVerificationOperationManager({
      execute: async () => response(reportStatus),
      operationId: () => `op-${reportStatus}`,
    })

    manager.start(request, 'start-request')
    await flush()
    await flush()
    const terminal = manager.get(`op-${reportStatus}`)
    expect(terminal.state).toBe(operationState)
    expect(terminal.result).toEqual(response(reportStatus))
  })

  it('keeps running cancellation cooperative and does not mask unexpected rejection as cancelled', async () => {
    const { createVerificationOperationManager } = await operationModule()
    let reject!: (error: Error) => void
    let observedSignal: AbortSignal | undefined
    const pending = new Promise<PluginVerifyResponse>((_resolve, rejectPromise) => {
      reject = rejectPromise
    })
    const manager = createVerificationOperationManager({
      execute: async (_request, _requestId, signal) => {
        observedSignal = signal
        return pending
      },
      operationId: () => 'op-running',
    })

    manager.start(request, 'start-request')
    await flush()
    const cancelling = manager.cancel('op-running')
    expect(cancelling).toMatchObject({ state: 'running', cancellationRequested: true })
    expect(observedSignal?.aborted).toBe(true)

    reject(new Error('unexpected infrastructure defect'))
    await flush()
    await flush()
    const terminal = manager.get('op-running')
    expect(terminal.state).toBe('failed')
    expect(terminal.cancellationRequested).toBe(true)
    expect(terminal.result).toBeUndefined()
    expect(terminal.diagnostics).toEqual([
      expect.objectContaining({ code: 'OPERATION_EXECUTION_FAILED', domain: 'operation' }),
    ])
  })

  it('enforces active capacity without creating a queued backlog', async () => {
    const { createVerificationOperationManager } = await operationModule()
    let sequence = 0
    const never = new Promise<PluginVerifyResponse>(() => {})
    const manager = createVerificationOperationManager({
      execute: async () => never,
      operationId: () => `op-${++sequence}`,
      maxActive: 1,
    })

    manager.start(request, 'request-1')
    expect(() => manager.start(request, 'request-2')).toThrowError(/OPERATION_CAPACITY_EXCEEDED/u)
  })

  it('evicts completed operations by completion order and polling does not affect retention', async () => {
    const { createVerificationOperationManager } = await operationModule()
    let sequence = 0
    const resolvers = new Map<string, (value: PluginVerifyResponse) => void>()
    const manager = createVerificationOperationManager({
      execute: async (_request, requestId) => new Promise<PluginVerifyResponse>(resolve => {
        resolvers.set(requestId, resolve)
      }),
      operationId: () => `op-${++sequence}`,
      maxRetainedCompleted: 2,
    })

    manager.start(request, 'request-1')
    manager.start(request, 'request-2')
    manager.start(request, 'request-3')
    await flush()

    resolvers.get('request-2')?.(response('verified', 'request-2'))
    await flush()
    manager.get('op-2')
    manager.get('op-2')
    resolvers.get('request-1')?.(response('verified', 'request-1'))
    await flush()
    resolvers.get('request-3')?.(response('verified', 'request-3'))
    await flush()

    expect(() => manager.get('op-2')).toThrowError(/OPERATION_NOT_FOUND/u)
    expect(manager.get('op-1').state).toBe('succeeded')
    expect(manager.get('op-3').state).toBe('succeeded')
  })

  it('rejects id collisions without overwriting existing operation state and snapshots are immutable', async () => {
    const { createVerificationOperationManager } = await operationModule()
    const manager = createVerificationOperationManager({
      execute: async () => new Promise<PluginVerifyResponse>(() => {}),
      operationId: () => 'same-id',
    })

    const first = manager.start(request, 'request-1')
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.diagnostics)).toBe(true)
    expect(() => manager.start(request, 'request-2')).toThrowError(/OPERATION_EXECUTION_FAILED/u)
    expect(manager.get('same-id')).toMatchObject({ id: 'same-id', state: 'queued' })
  })
})
