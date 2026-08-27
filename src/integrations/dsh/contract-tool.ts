import {
  CONTRACT_KINDS,
  parseContractInspectRequest,
  parseContractSearchRequest,
  type ContractInspectRequest,
  type ContractInspectResponse,
  type ContractSearchRequest,
  type ContractSearchResponse,
} from '../../protocol/index.js'
import {
  TARGET_RESOLVE_PARAMETER_SCHEMA,
  type DshToolDefinition,
} from './target-tool.js'

export const CONTRACT_SEARCH_TOOL_NAME = 'toolchain_contract_search'
export const CONTRACT_INSPECT_TOOL_NAME = 'toolchain_contract_inspect'

/**
 * Per-call execution data owned by the native DSH integration boundary.
 * The Agent stays opaque here so no DSH runtime identity leaks into shared
 * kernel/model code.
 */
export interface DshContractToolExecutionContext {
  readonly agent?: unknown
  readonly signal?: AbortSignal
}

type ContractSearchResolver = (
  request: ContractSearchRequest,
  execution?: DshContractToolExecutionContext,
) => Promise<ContractSearchResponse>

type ContractInspectResolver = (
  request: ContractInspectRequest,
  execution?: DshContractToolExecutionContext,
) => Promise<ContractInspectResponse>

function executionContext(execution: unknown): DshContractToolExecutionContext | undefined {
  if (execution === null || typeof execution !== 'object') return undefined

  const source = execution as {
    readonly agent?: unknown
    readonly signal?: unknown
  }
  return Object.freeze({
    ...(source.agent === undefined ? {} : { agent: source.agent }),
    ...(source.signal instanceof AbortSignal ? { signal: source.signal } : {}),
  })
}

function output(description: string): DshToolDefinition['output'] {
  return {
    schema: { type: 'object', description },
    render(_args: unknown, value: unknown) {
      return [{ type: 'text', text: JSON.stringify(value) }]
    },
  }
}

export function createContractSearchToolDefinition(
  search: ContractSearchResolver,
): DshToolDefinition {
  return {
    name: CONTRACT_SEARCH_TOOL_NAME,
    description: 'Search deterministic evidence-backed contracts for one exact installed DSH target.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: TARGET_RESOLVE_PARAMETER_SCHEMA,
        query: { type: 'string', minLength: 1, pattern: '\\S' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: [...CONTRACT_KINDS] },
          uniqueItems: true,
        },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      required: ['target', 'query'],
    },
    output: output('Protocol v1 ContractSearchResponse.'),
    execute(args: unknown, execution?: unknown): Promise<ContractSearchResponse> {
      const request = parseContractSearchRequest(args)
      const current = executionContext(execution)
      return current === undefined ? search(request) : search(request, current)
    },
  }
}

export function createContractInspectToolDefinition(
  inspect: ContractInspectResolver,
): DshToolDefinition {
  return {
    name: CONTRACT_INSPECT_TOOL_NAME,
    description: 'Inspect one evidence-backed contract against an exact contract-index fingerprint.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: TARGET_RESOLVE_PARAMETER_SCHEMA,
        contractIndexFingerprint: {
          type: 'string',
          pattern: '^dsh-contract-index-v1:[0-9a-f]{64}$',
        },
        contractId: { type: 'string', minLength: 1 },
      },
      required: ['target', 'contractIndexFingerprint', 'contractId'],
    },
    output: output('Protocol v1 ContractInspectResponse.'),
    execute(args: unknown, execution?: unknown): Promise<ContractInspectResponse> {
      const request = parseContractInspectRequest(args)
      const current = executionContext(execution)
      return current === undefined ? inspect(request) : inspect(request, current)
    },
  }
}