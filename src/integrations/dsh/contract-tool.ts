import { serializeContractInspectModelResponse } from '../../model/contract-inspect-compact.js'
import { serializeContractSearchModelResponse } from '../../model/contract-search-compact.js'
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
  TARGET_PROFILE_PARAMETER_SCHEMA,
  bindTargetArguments,
  type DshToolDefinition,
} from './target-tool.js'
import type { DshAmbientTargetBindingPort } from './runtime-target-binding.js'

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

/**
 * Model-facing render seam. Contract results go through the shared non-regressing serializer, so
 * a tool can never hand the model a larger payload than canonical Protocol v1 JSON.
 */
function modelOutput(
  description: string,
  serialize: (value: unknown) => string,
): DshToolDefinition['output'] {
  return {
    schema: { type: 'object', description },
    render(_args: unknown, value: unknown) {
      return [{ type: 'text', text: serialize(value) }]
    },
  }
}

export function createContractSearchToolDefinition(
  search: ContractSearchResolver,
  binding: DshAmbientTargetBindingPort,
): DshToolDefinition {
  return {
    name: CONTRACT_SEARCH_TOOL_NAME,
    description: 'Search deterministic evidence-backed contracts for one exact installed DSH target; with no profile, the DSH target this Host is running in. Use data.matches[].id with contract.inspect; evidenceIds and data.evidence[].id are provenance only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: TARGET_PROFILE_PARAMETER_SCHEMA,
        query: { type: 'string', minLength: 1, pattern: '\\S' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: [...CONTRACT_KINDS] },
          uniqueItems: true,
        },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      required: ['query'],
    },
    output: modelOutput(
      'Protocol v1 ContractSearchResponse.',
      value => serializeContractSearchModelResponse(value as ContractSearchResponse),
    ),
    async execute(args: unknown, execution?: unknown): Promise<ContractSearchResponse> {
      const { target, rest } = await bindTargetArguments(
        args,
        binding,
        'Invalid contract.search arguments',
      )
      const request = parseContractSearchRequest({ ...rest, target })
      const current = executionContext(execution)
      return current === undefined ? search(request) : search(request, current)
    },
  }
}

export function createContractInspectToolDefinition(
  inspect: ContractInspectResolver,
  binding: DshAmbientTargetBindingPort,
): DshToolDefinition {
  return {
    name: CONTRACT_INSPECT_TOOL_NAME,
    description: 'Inspect one evidence-backed contract against an exact contract-index fingerprint; with no profile, the DSH target this Host is running in. contractId must come from contract.search data.matches[].id, not an evidence id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: TARGET_PROFILE_PARAMETER_SCHEMA,
        contractIndexFingerprint: {
          type: 'string',
          pattern: '^dsh-contract-index-v1:[0-9a-f]{64}$',
        },
        contractId: {
          type: 'string',
          minLength: 1,
          description: 'Contract identifier from contract.search data.matches[].id. Do not pass matches[].evidenceIds or data.evidence[].id.',
        },
      },
      required: ['contractIndexFingerprint', 'contractId'],
    },
    output: modelOutput(
      'Protocol v1 ContractInspectResponse.',
      value => serializeContractInspectModelResponse(value as ContractInspectResponse),
    ),
    async execute(args: unknown, execution?: unknown): Promise<ContractInspectResponse> {
      const { target, rest } = await bindTargetArguments(
        args,
        binding,
        'Invalid contract.inspect arguments',
      )
      const request = parseContractInspectRequest({ ...rest, target })
      const current = executionContext(execution)
      return current === undefined ? inspect(request) : inspect(request, current)
    },
  }
}