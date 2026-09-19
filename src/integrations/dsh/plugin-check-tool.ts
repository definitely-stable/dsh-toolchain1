import { serializePluginCheckModelResponse } from '../../model/plugin-check-compact.js'
import {
  parsePluginCheckRequest,
  type PluginCheckRequest,
  type PluginCheckResponse,
} from '../../protocol/index.js'
import {
  bindTargetArguments,
  TARGET_PROFILE_PARAMETER_SCHEMA,
  type DshToolDefinition,
} from './target-tool.js'
import type { DshAmbientTargetBindingPort } from './runtime-target-binding.js'

export const PLUGIN_CHECK_TOOL_NAME = 'toolchain_plugin_check'

type PluginCheckResolver = (
  request: PluginCheckRequest,
) => Promise<PluginCheckResponse>

export function createPluginCheckToolDefinition(
  check: PluginCheckResolver,
  binding: DshAmbientTargetBindingPort,
): DshToolDefinition {
  return {
    name: PLUGIN_CHECK_TOOL_NAME,
    description: 'Run the static Exact Target Plugin Check against one installed DSH target without executing candidate code or mutating the target profile; with no profile, the DSH target this Host is running in.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: TARGET_PROFILE_PARAMETER_SCHEMA,
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
      required: ['subject'],
    },
    output: {
      schema: {
        type: 'object',
        description: 'Protocol v1 PluginCheckResponse.',
      },
      render(_args: unknown, value: unknown) {
        return [{
          type: 'text' as const,
          text: serializePluginCheckModelResponse(value as PluginCheckResponse),
        }]
      },
    },
    async execute(args: unknown): Promise<PluginCheckResponse> {
      const { target, rest } = await bindTargetArguments(
        args,
        binding,
        'Invalid plugin.check arguments',
      )
      return check(parsePluginCheckRequest({ ...rest, target }))
    },
  }
}
