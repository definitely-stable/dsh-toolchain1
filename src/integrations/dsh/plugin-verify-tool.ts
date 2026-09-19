import {
  parsePluginVerifyRequest,
  type PluginVerifyRequest,
  type PluginVerifyResponse,
} from '../../protocol/index.js'
import {
  TARGET_PROFILE_PARAMETER_SCHEMA,
  bindTargetArguments,
  type DshToolDefinition,
} from './target-tool.js'
import type { DshAmbientTargetBindingPort } from './runtime-target-binding.js'

export const PLUGIN_VERIFY_TOOL_NAME = 'toolchain_plugin_verify'

export const PLUGIN_VERIFY_PARAMETER_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    profile: TARGET_PROFILE_PARAMETER_SCHEMA,
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
    behaviorAssertions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { enum: ['agent-tool-result'] },
          name: { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' },
          arguments: {},
          expectedValue: {},
        },
        required: ['kind', 'name', 'arguments', 'expectedValue'],
      },
    },
  },
  required: ['subject', 'executionPolicy'],
})

/**
 * Shared by synchronous `plugin.verify` and the asynchronous `plugin.verify.start` tool, so both
 * surfaces bind their target through exactly one rule.
 */
export async function bindPluginVerifyRequest(
  args: unknown,
  binding: DshAmbientTargetBindingPort,
): Promise<PluginVerifyRequest> {
  const { target, rest } = await bindTargetArguments(
    args,
    binding,
    'Invalid plugin.verify arguments',
  )
  return parsePluginVerifyRequest({ ...rest, target })
}

type PluginVerifyResolver = (
  request: PluginVerifyRequest,
) => Promise<PluginVerifyResponse>

export function createPluginVerifyToolDefinition(
  verify: PluginVerifyResolver,
  binding: DshAmbientTargetBindingPort,
): DshToolDefinition {
  return {
    name: PLUGIN_VERIFY_TOOL_NAME,
    description: 'Verify one packed plugin against an exact installed DSH target; with no profile, the DSH target this Host is running in. This executes candidate code in an isolated temporary DSH environment under the safe policy and can prove explicitly requested Host Service visibility, Agent Tool callable-schema visibility, or exact Agent Tool structured behavior results without mutating the active profile.',
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
    async execute(args: unknown): Promise<PluginVerifyResponse> {
      return verify(await bindPluginVerifyRequest(args, binding))
    },
  }
}
