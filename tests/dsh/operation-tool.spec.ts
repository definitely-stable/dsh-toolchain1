import { describe, expect, it, vi } from 'vitest'

import {
  createOperationCancelToolDefinition,
  createOperationGetToolDefinition,
  createPluginVerifyStartToolDefinition,
  OPERATION_CANCEL_TOOL_NAME,
  OPERATION_GET_TOOL_NAME,
  PLUGIN_VERIFY_START_TOOL_NAME,
} from '../../src/integrations/dsh/operation-tool.js'
import { createPluginVerifyToolDefinition } from '../../src/integrations/dsh/plugin-verify-tool.js'
import type {
  OperationCancelResponse,
  OperationGetResponse,
  PluginVerifyStartResponse,
} from '../../src/protocol/index.js'

function queuedStartResponse(): PluginVerifyStartResponse {
  return {
    protocolVersion: '1',
    requestId: 'start-request',
    status: 'ok',
    data: {
      operation: {
        id: 'op-1',
        kind: 'plugin.verify',
        state: 'queued',
        cancellationRequested: false,
        diagnostics: [],
      },
    },
    diagnostics: [],
  }
}

function getResponse(): OperationGetResponse {
  return {
    protocolVersion: '1',
    requestId: 'get-request',
    status: 'ok',
    data: {
      operation: {
        id: 'op-1',
        kind: 'plugin.verify',
        state: 'running',
        cancellationRequested: false,
        diagnostics: [],
      },
    },
    diagnostics: [],
  }
}

function cancelResponse(): OperationCancelResponse {
  return {
    protocolVersion: '1',
    requestId: 'cancel-request',
    status: 'ok',
    data: {
      operation: {
        id: 'op-1',
        kind: 'plugin.verify',
        state: 'running',
        cancellationRequested: true,
        diagnostics: [],
      },
    },
    diagnostics: [],
  }
}

const verifyRequest = {
  target: { profile: 'web' },
  subject: { kind: 'packed' as const, path: '/candidate/plugin.tgz' },
  executionPolicy: 'safe' as const,
  visibilityAssertions: [{ kind: 'agent-tool' as const, name: 'exampleTool' }],
}

describe('native DSH verification operation tools', () => {
  it('projects plugin.verify.start with the same canonical request schema and parser as synchronous verify', async () => {
    const start = vi.fn(async () => queuedStartResponse())
    const direct = vi.fn(async () => {
      throw new Error('not called')
    })
    const startTool = createPluginVerifyStartToolDefinition(start)
    const directTool = createPluginVerifyToolDefinition(direct)

    expect(startTool.name).toBe(PLUGIN_VERIFY_START_TOOL_NAME)
    expect(startTool.name).toBe('toolchain_plugin_verify_start')
    expect(startTool.parameters).toEqual(directTool.parameters)
    expect(startTool.description).toContain('operation')

    await expect(startTool.execute(verifyRequest)).resolves.toEqual(queuedStartResponse())
    expect(start).toHaveBeenCalledWith(verifyRequest)

    expect(() => startTool.execute({ ...verifyRequest, executionPolicy: 'trusted' })).toThrow(TypeError)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('projects operation.get and operation.cancel through one bounded id contract', async () => {
    const get = vi.fn(async () => getResponse())
    const cancel = vi.fn(async () => cancelResponse())
    const getTool = createOperationGetToolDefinition(get)
    const cancelTool = createOperationCancelToolDefinition(cancel)

    expect(getTool.name).toBe(OPERATION_GET_TOOL_NAME)
    expect(getTool.name).toBe('toolchain_operation_get')
    expect(cancelTool.name).toBe(OPERATION_CANCEL_TOOL_NAME)
    expect(cancelTool.name).toBe('toolchain_operation_cancel')
    expect(getTool.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
      },
      required: ['id'],
    })
    expect(cancelTool.parameters).toEqual(getTool.parameters)

    await expect(getTool.execute({ id: 'op-1' })).resolves.toEqual(getResponse())
    await expect(cancelTool.execute({ id: 'op-1' })).resolves.toEqual(cancelResponse())
    expect(get).toHaveBeenCalledWith({ id: 'op-1' })
    expect(cancel).toHaveBeenCalledWith({ id: 'op-1' })

    for (const tool of [getTool, cancelTool]) {
      expect(() => tool.execute({ id: '   ' })).toThrow(TypeError)
      expect(() => tool.execute({ id: 'x'.repeat(129) })).toThrow(TypeError)
      expect(() => tool.execute({ id: 'op-1', extra: true })).toThrow(TypeError)
    }
    expect(get).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('renders canonical Protocol responses as one JSON text block', () => {
    const getTool = createOperationGetToolDefinition(async () => getResponse())
    expect(getTool.output.schema).toEqual({
      type: 'object',
      description: 'Protocol v1 OperationGetResponse.',
    })
    expect(getTool.output.render({}, getResponse())).toEqual([
      { type: 'text', text: JSON.stringify(getResponse()) },
    ])
  })
})
