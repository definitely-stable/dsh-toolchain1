import {
  parsePluginVerifyRequest,
  type PluginVerifyRequest,
  type PluginVerifyResponse,
} from '../../protocol/index.js'
import {
  TARGET_RESOLVE_PARAMETER_SCHEMA,
  type DshToolDefinition,
} from './target-tool.js'

export const PLUGIN_VERIFY_TOOL_NAME = 'toolchain_plugin_verify'

export const PLUGIN_VERIFY_PARAMETER_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    target: TARGET_RESOLVE_PARAMETER_SCHEMA,
    subject: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { enum: ['packed'] },
        path: { type: 'string', minLength: 1, pattern: '\\S' },
      },
      required: ['kind', 'path'],
    },
    executionPolicy: { enum: ['safe'] },
    visibilityAssertions: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { enum: ['host-service', 'agent-tool'] },
          name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
        },
        required: ['kind', 'name'],
      },
    },
  },
  required: ['target', 'subject', 'executionPolicy'],
})

type PluginVerifyResolver = (
  request: PluginVerifyRequest,
) => Promise<PluginVerifyResponse>

export function createPluginVerifyToolDefinition(
  verify: PluginVerifyResolver,
): DshToolDefinition {
  return {
    name: PLUGIN_VERIFY_TOOL_NAME,
    description: 'Verify one packed plugin against an exact installed DSH target. This executes candidate code in an isolated temporary DSH environment under the safe policy and can prove explicitly requested Host Service visibility or Agent Tool callable-schema visibility without mutating the active profile.',
    parameters: PLUGIN_VERIFY_PARAMETER_SCHEMA,
    output: {
      schema: {
        type: 'object',
        description: 'Protocol v1 PluginVerifyResponse.',
      },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
    },
    execute(args: unknown): Promise<PluginVerifyResponse> {
      return verify(parsePluginVerifyRequest(args))
    },
  }
}
