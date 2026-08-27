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

function output(description: string): DshToolDefinition['output'] {
  return {
    schema: { type: 'object', description },
    render(_args: unknown, value: unknown) {
      return [{ type: 'text', text: JSON.stringify(value) }]
    },
  }
}

export function createContractSearchToolDefinition(
  search: (request: ContractSearchRequest) => Promise<ContractSearchResponse>,
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
    execute(args: unknown): Promise<ContractSearchResponse> {
      return search(parseContractSearchRequest(args))
    },
  }
}

export function createContractInspectToolDefinition(
  inspect: (request: ContractInspectRequest) => Promise<ContractInspectResponse>,
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
    execute(args: unknown): Promise<ContractInspectResponse> {
      return inspect(parseContractInspectRequest(args))
    },
  }
}
