import {
  parseTargetResolveRequest,
  type TargetResolveRequest,
  type TargetResolveResponse,
} from '../../protocol/index.js'
import type { DshAmbientTargetBindingPort } from './runtime-target-binding.js'

export const TARGET_RESOLVE_TOOL_NAME = 'toolchain_target_resolve'

interface TextContentBlock {
  readonly type: 'text'
  readonly text: string
}

export interface DshToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly TextContentBlock[]
  }
  execute(args: unknown, execution?: unknown): Promise<unknown>
}

/**
 * Structural seam for the host-owned DSH tools service. Toolchain deliberately
 * does not import or bundle `@deepseek-ai/dsh-tools`; the running DSH Host owns
 * that identity-sensitive runtime capability.
 */
export interface DshToolRegistryPort {
  register(definition: DshToolDefinition): () => void
}

export const TARGET_PROFILE_PARAMETER_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'string',
  minLength: 1,
  pattern: '^(?!\\.{1,2}$)(?!node_modules$)[^/\\\\]+$',
  description: 'Optional DSH profile name. Omit to bind the exact DSH target this Host is running in.',
})

function toolArguments(args: unknown, message: string): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new TypeError(message)
  return args as Record<string, unknown>
}

/**
 * Split model-facing Tool arguments into the canonical target request and the operation's own
 * parameters.
 *
 * `target` is deliberately not a model-facing key: a nested request would let a model choose
 * acquisition hints and bypass the binding decision ADR-0011 pins down, so it is rejected loudly
 * rather than merged or ignored. The profile travels as one flat string and is validated by the
 * canonical Protocol parser at the end of the same call.
 */
export async function bindTargetArguments(
  args: unknown,
  binding: DshAmbientTargetBindingPort,
  message: string,
): Promise<{ readonly target: TargetResolveRequest, readonly rest: Record<string, unknown> }> {
  const source = toolArguments(args, message)
  const { profile, target, ...rest } = source
  if (target !== undefined) throw new TypeError(message)
  if (profile !== undefined && typeof profile !== 'string') throw new TypeError(message)
  return { target: await binding.targetRequest(profile), rest }
}

export function createTargetResolveToolDefinition(
  resolve: (request: TargetResolveRequest) => Promise<TargetResolveResponse>,
  binding: DshAmbientTargetBindingPort,
): DshToolDefinition {
  return {
    name: TARGET_RESOLVE_TOOL_NAME,
    description: 'Resolve one exact installed DSH target as a Protocol v1 response without mutating the target profile. With no profile, resolves the DSH target this Host is running in.',
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      properties: { profile: TARGET_PROFILE_PARAMETER_SCHEMA },
    }),
    output: {
      schema: {
        type: 'object',
        description: 'Protocol v1 TargetResolveResponse.',
      },
      render(_args: unknown, value: unknown): readonly TextContentBlock[] {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: unknown): Promise<TargetResolveResponse> {
      const message = 'Invalid target.resolve arguments'
      const { target, rest } = await bindTargetArguments(args, binding, message)
      if (Object.keys(rest).length !== 0) throw new TypeError(message)
      return resolve(parseTargetResolveRequest(target))
    },
  }
}
