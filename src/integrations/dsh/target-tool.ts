import type {
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../protocol/index.js'

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

const parameterProperties = {
  profile: {
    type: 'string',
    description: 'DSH profile name to resolve.',
  },
  dshHome: {
    type: 'string',
    description: 'Optional DSH home override for read-only acquisition.',
  },
  dshPackageRoot: {
    type: 'string',
    description: 'Optional installed @deepseek-ai/dsh package root.',
  },
  patches: {
    type: 'array',
    description: 'Ordered DSH --patch overlay paths.',
    items: { type: 'string' },
  },
} satisfies Record<keyof TargetResolveRequest, Record<string, unknown>>

export function createTargetResolveToolDefinition(
  resolve: (request: TargetResolveRequest) => Promise<TargetResolveResponse>,
): DshToolDefinition {
  return {
    name: TARGET_RESOLVE_TOOL_NAME,
    description: 'Resolve one exact installed DSH target as a Protocol v1 response without mutating the target profile.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: parameterProperties,
      required: ['profile'],
    },
    output: {
      schema: {
        type: 'object',
        description: 'Protocol v1 TargetResolveResponse.',
      },
      render(_args: unknown, value: unknown): readonly TextContentBlock[] {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    execute(args: unknown): Promise<TargetResolveResponse> {
      return resolve(args as TargetResolveRequest)
    },
  }
}
