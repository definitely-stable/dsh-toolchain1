import type {
  ContractInspectRequest,
  ContractInspectResponse,
  ContractKind,
  ContractSearchRequest,
  ContractSearchResponse,
} from '../../protocol/index.js'
import {
  parseTargetResolveToolArgs,
  TARGET_RESOLVE_PARAMETER_SCHEMA,
  type DshToolDefinition,
} from './target-tool.js'

export const CONTRACT_SEARCH_TOOL_NAME = 'toolchain_contract_search'
export const CONTRACT_INSPECT_TOOL_NAME = 'toolchain_contract_inspect'

const CONTRACT_KINDS = [
  'service',
  'method',
  'event',
  'tool',
  'client-slot',
  'config',
  'package',
] as const satisfies readonly ContractKind[]
const contractKindSet = new Set<ContractKind>(CONTRACT_KINDS)
const contractIndexPattern = /^dsh-contract-index-v1:[0-9a-f]{64}$/
const searchKeys = new Set<keyof ContractSearchRequest>(['target', 'query', 'kinds', 'limit'])
const inspectKeys = new Set<keyof ContractInspectRequest>([
  'target',
  'contractIndexFingerprint',
  'contractId',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseTargetForContract(args: unknown, operation: 'search' | 'inspect') {
  try {
    return parseTargetResolveToolArgs(args)
  } catch (cause) {
    throw new TypeError(`Invalid contract.${operation} arguments`, { cause })
  }
}

function parseContractSearchToolArgs(args: unknown): ContractSearchRequest {
  if (!isRecord(args)) throw new TypeError('Invalid contract.search arguments')
  if (Object.keys(args).some(key => !searchKeys.has(key as keyof ContractSearchRequest))) {
    throw new TypeError('Invalid contract.search arguments')
  }

  const { target, query, kinds, limit } = args
  const parsedTarget = parseTargetForContract(target, 'search')
  if (!nonEmptyString(query)) throw new TypeError('Invalid contract.search arguments')

  let parsedKinds: ContractKind[] | undefined
  if (kinds !== undefined) {
    if (
      !Array.isArray(kinds)
      || !kinds.every((kind): kind is ContractKind => typeof kind === 'string' && contractKindSet.has(kind as ContractKind))
      || new Set(kinds).size !== kinds.length
    ) {
      throw new TypeError('Invalid contract.search arguments')
    }
    parsedKinds = [...kinds]
  }

  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 25)) {
    throw new TypeError('Invalid contract.search arguments')
  }

  return {
    target: parsedTarget,
    query,
    ...(parsedKinds === undefined ? {} : { kinds: parsedKinds }),
    ...(limit === undefined ? {} : { limit: limit as number }),
  }
}

function parseContractInspectToolArgs(args: unknown): ContractInspectRequest {
  if (!isRecord(args)) throw new TypeError('Invalid contract.inspect arguments')
  if (Object.keys(args).some(key => !inspectKeys.has(key as keyof ContractInspectRequest))) {
    throw new TypeError('Invalid contract.inspect arguments')
  }

  const { target, contractIndexFingerprint, contractId } = args
  const parsedTarget = parseTargetForContract(target, 'inspect')
  if (
    !nonEmptyString(contractIndexFingerprint)
    || !contractIndexPattern.test(contractIndexFingerprint)
    || !nonEmptyString(contractId)
  ) {
    throw new TypeError('Invalid contract.inspect arguments')
  }

  return {
    target: parsedTarget,
    contractIndexFingerprint,
    contractId,
  }
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
        query: { type: 'string', minLength: 1 },
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
      return search(parseContractSearchToolArgs(args))
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
      return inspect(parseContractInspectToolArgs(args))
    },
  }
}
