import {
  parseOperationRequest,
  parsePluginVerifyRequest,
  type OperationCancelResponse,
  type OperationGetResponse,
  type OperationRequest,
  type PluginVerifyRequest,
  type PluginVerifyStartResponse,
} from '../../protocol/index.js'
import {
  PLUGIN_VERIFY_PARAMETER_SCHEMA,
} from './plugin-verify-tool.js'
import type { DshToolDefinition } from './target-tool.js'

export const PLUGIN_VERIFY_START_TOOL_NAME = 'toolchain_plugin_verify_start'
export const OPERATION_GET_TOOL_NAME = 'toolchain_operation_get'
export const OPERATION_CANCEL_TOOL_NAME = 'toolchain_operation_cancel'

export const OPERATION_REQUEST_PARAMETER_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
  },
  required: ['id'],
})

type PluginVerifyStartResolver = (
  request: PluginVerifyRequest,
) => Promise<PluginVerifyStartResponse>

type OperationGetResolver = (
  request: OperationRequest,
) => Promise<OperationGetResponse>

type OperationCancelResolver = (
  request: OperationRequest,
) => Promise<OperationCancelResponse>

function protocolOutput(description: string): DshToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      description,
    },
    render(_args: unknown, value: unknown) {
      return [{ type: 'text' as const, text: JSON.stringify(value) }]
    },
  }
}

export function createPluginVerifyStartToolDefinition(
  start: PluginVerifyStartResolver,
): DshToolDefinition {
  return {
    name: PLUGIN_VERIFY_START_TOOL_NAME,
    description: 'Start one packed-plugin verification operation owned by this persistent DSH Host. Returns an operation snapshot for later status lookup or cancellation; synchronous toolchain_plugin_verify remains available.',
    parameters: PLUGIN_VERIFY_PARAMETER_SCHEMA,
    output: protocolOutput('Protocol v1 PluginVerifyStartResponse.'),
    execute(args: unknown): Promise<PluginVerifyStartResponse> {
      return start(parsePluginVerifyRequest(args))
    },
  }
}

export function createOperationGetToolDefinition(
  get: OperationGetResolver,
): DshToolDefinition {
  return {
    name: OPERATION_GET_TOOL_NAME,
    description: 'Read the current snapshot of one verification operation owned by this persistent DSH Host.',
    parameters: OPERATION_REQUEST_PARAMETER_SCHEMA,
    output: protocolOutput('Protocol v1 OperationGetResponse.'),
    execute(args: unknown): Promise<OperationGetResponse> {
      return get(parseOperationRequest(args))
    },
  }
}

export function createOperationCancelToolDefinition(
  cancel: OperationCancelResolver,
): DshToolDefinition {
  return {
    name: OPERATION_CANCEL_TOOL_NAME,
    description: 'Request cooperative cancellation of one verification operation owned by this persistent DSH Host and return its current snapshot.',
    parameters: OPERATION_REQUEST_PARAMETER_SCHEMA,
    output: protocolOutput('Protocol v1 OperationCancelResponse.'),
    execute(args: unknown): Promise<OperationCancelResponse> {
      return cancel(parseOperationRequest(args))
    },
  }
}
