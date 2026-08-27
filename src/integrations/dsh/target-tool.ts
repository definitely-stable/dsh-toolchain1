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

const targetResolveKeys = new Set<keyof TargetResolveRequest>([
  'profile',
  'dshHome',
  'dshPackageRoot',
  'patches',
])
const profilePattern = /^(?!\.{1,2}$)(?!node_modules$)[^/\\]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Raw DSH ToolDefinitions receive `unknown` arguments and therefore own their
 * runtime validation. Keep this narrow mirror aligned with Protocol v1's
 * targetResolveRequest constraints; semantic target validation remains in the
 * shared acquisition/kernel path.
 */
function parseTargetResolveToolArgs(args: unknown): TargetResolveRequest {
  if (!isRecord(args)) throw new TypeError('Invalid target.resolve arguments')
  if (Object.keys(args).some(key => !targetResolveKeys.has(key as keyof TargetResolveRequest))) {
    throw new TypeError('Invalid target.resolve arguments')
  }

  const { profile, dshHome, dshPackageRoot, patches } = args
  if (!nonEmptyString(profile) || !profilePattern.test(profile)) {
    throw new TypeError('Invalid target.resolve arguments')
  }
  if (dshHome !== undefined && !nonEmptyString(dshHome)) {
    throw new TypeError('Invalid target.resolve arguments')
  }
  if (dshPackageRoot !== undefined && !nonEmptyString(dshPackageRoot)) {
    throw new TypeError('Invalid target.resolve arguments')
  }
  if (
    patches !== undefined
    && (!Array.isArray(patches) || !patches.every(nonEmptyString))
  ) {
    throw new TypeError('Invalid target.resolve arguments')
  }

  return {
    profile,
    ...(dshHome === undefined ? {} : { dshHome }),
    ...(dshPackageRoot === undefined ? {} : { dshPackageRoot }),
    ...(patches === undefined ? {} : { patches: [...patches] }),
  }
}

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
      return resolve(parseTargetResolveToolArgs(args))
    },
  }
}
