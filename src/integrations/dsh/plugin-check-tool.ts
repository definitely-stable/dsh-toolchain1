import {
  parsePluginCheckRequest,
  type PluginCheckRequest,
  type PluginCheckResponse,
} from '../../protocol/index.js'
import {
  TARGET_RESOLVE_PARAMETER_SCHEMA,
  type DshToolDefinition,
} from './target-tool.js'

export const PLUGIN_CHECK_TOOL_NAME = 'toolchain_plugin_check'

type PluginCheckResolver = (
  request: PluginCheckRequest,
) => Promise<PluginCheckResponse>

export function createPluginCheckToolDefinition(
  check: PluginCheckResolver,
): DshToolDefinition {
  return {
    name: PLUGIN_CHECK_TOOL_NAME,
    description: 'Run the static Exact Target Plugin Check against one installed DSH target without executing candidate code or mutating the target profile.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: TARGET_RESOLVE_PARAMETER_SCHEMA,
        subject: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { enum: ['directory', 'packed'] },
            path: { type: 'string', minLength: 1, pattern: '\\S' },
          },
          required: ['kind', 'path'],
        },
      },
      required: ['target', 'subject'],
    },
    output: {
      schema: {
        type: 'object',
        description: 'Protocol v1 PluginCheckResponse.',
      },
      render(_args: unknown, value: unknown) {
        return [{ type: 'text' as const, text: JSON.stringify(value) }]
      },
    },
    execute(args: unknown): Promise<PluginCheckResponse> {
      return check(parsePluginCheckRequest(args))
    },
  }
}
