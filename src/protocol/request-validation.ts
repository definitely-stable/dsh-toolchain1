import type {
  ContractInspectRequest,
  ContractKind,
  ContractSearchRequest,
  TargetResolveRequest,
} from './generated.js'

export interface PluginSubjectRequest {
  readonly kind: 'directory'
  readonly path: string
}

export interface PluginCheckRequest {
  readonly target: TargetResolveRequest
  readonly subject: PluginSubjectRequest
}

export const CONTRACT_KINDS = Object.freeze([
  'service',
  'method',
  'event',
  'tool',
  'client-slot',
  'config',
  'package',
] as const satisfies readonly ContractKind[])

export const CONTRACT_INDEX_FINGERPRINT_PATTERN = /^dsh-contract-index-v1:[0-9a-f]{64}$/u

const contractKindSet = new Set<ContractKind>(CONTRACT_KINDS)
const targetResolveKeys = new Set<keyof TargetResolveRequest>([
  'profile',
  'dshHome',
  'dshPackageRoot',
  'patches',
])
const searchKeys = new Set<keyof ContractSearchRequest>(['target', 'query', 'kinds', 'limit'])
const inspectKeys = new Set<keyof ContractInspectRequest>([
  'target',
  'contractIndexFingerprint',
  'contractId',
])
const pluginCheckKeys = new Set<keyof PluginCheckRequest>(['target', 'subject'])
const pluginSubjectKeys = new Set<keyof PluginSubjectRequest>(['kind', 'path'])
const profilePattern = /^(?!\.{1,2}$)(?!node_modules$)[^/\\]+$/u

function invalid(message: string): never {
  throw new TypeError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseTargetResolveRequestWithMessage(value: unknown, message: string): TargetResolveRequest {
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !targetResolveKeys.has(key as keyof TargetResolveRequest))) {
    invalid(message)
  }

  const { profile, dshHome, dshPackageRoot, patches } = value
  if (!nonEmptyString(profile) || !profilePattern.test(profile)) invalid(message)
  if (dshHome !== undefined && !nonEmptyString(dshHome)) invalid(message)
  if (dshPackageRoot !== undefined && !nonEmptyString(dshPackageRoot)) invalid(message)
  if (patches !== undefined && (!Array.isArray(patches) || !patches.every(nonEmptyString))) {
    invalid(message)
  }

  return {
    profile,
    ...(dshHome === undefined ? {} : { dshHome }),
    ...(dshPackageRoot === undefined ? {} : { dshPackageRoot }),
    ...(patches === undefined ? {} : { patches: [...patches] }),
  }
}

export function parseTargetResolveRequest(value: unknown): TargetResolveRequest {
  return parseTargetResolveRequestWithMessage(value, 'Invalid target.resolve arguments')
}

export function parseContractSearchRequest(value: unknown): ContractSearchRequest {
  const message = 'Invalid contract.search arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !searchKeys.has(key as keyof ContractSearchRequest))) invalid(message)

  const { target, query, kinds, limit } = value
  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)
  if (typeof query !== 'string' || query.trim().length === 0) invalid(message)

  let parsedKinds: ContractKind[] | undefined
  if (kinds !== undefined) {
    if (
      !Array.isArray(kinds)
      || !kinds.every((kind): kind is ContractKind => typeof kind === 'string' && contractKindSet.has(kind as ContractKind))
      || new Set(kinds).size !== kinds.length
    ) invalid(message)
    parsedKinds = [...kinds]
  }

  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 25)) {
    invalid(message)
  }

  return {
    target: parsedTarget,
    query,
    ...(parsedKinds === undefined ? {} : { kinds: parsedKinds }),
    ...(limit === undefined ? {} : { limit: limit as number }),
  }
}

export function parseContractInspectRequest(value: unknown): ContractInspectRequest {
  const message = 'Invalid contract.inspect arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !inspectKeys.has(key as keyof ContractInspectRequest))) invalid(message)

  const { target, contractIndexFingerprint, contractId } = value
  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)
  if (
    !nonEmptyString(contractIndexFingerprint)
    || !CONTRACT_INDEX_FINGERPRINT_PATTERN.test(contractIndexFingerprint)
    || !nonEmptyString(contractId)
  ) invalid(message)

  return {
    target: parsedTarget,
    contractIndexFingerprint,
    contractId,
  }
}

export function parsePluginCheckRequest(value: unknown): PluginCheckRequest {
  const message = 'Invalid plugin.check arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !pluginCheckKeys.has(key as keyof PluginCheckRequest))) invalid(message)

  const { target, subject } = value
  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)
  if (!isRecord(subject)) invalid(message)
  if (Object.keys(subject).some(key => !pluginSubjectKeys.has(key as keyof PluginSubjectRequest))) invalid(message)
  if (subject.kind !== 'directory' || !nonEmptyString(subject.path)) invalid(message)

  return {
    target: parsedTarget,
    subject: {
      kind: 'directory',
      path: subject.path,
    },
  }
}
