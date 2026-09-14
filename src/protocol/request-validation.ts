import type {
  ContractInspectRequest,
  ContractKind,
  ContractSearchRequest,
  JsonValue,
  OperationRequest,
  PluginBehaviorAssertion,
  PluginCheckRequest,
  PluginSubjectRequest,
  PluginVerifyRequest,
  PluginVisibilityAssertion,
  TargetResolveRequest,
} from './generated.js'

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
const pluginVerifyKeys = new Set<keyof PluginVerifyRequest>([
  'target',
  'subject',
  'executionPolicy',
  'visibilityAssertions',
  'behaviorAssertions',
])
const operationKeys = new Set<keyof OperationRequest>(['id'])
const pluginSubjectKeys = new Set<keyof PluginSubjectRequest>(['kind', 'path'])
const pluginSubjectKinds = new Set<PluginSubjectRequest['kind']>(['directory', 'packed'])
const pluginVisibilityAssertionKeys = new Set<keyof PluginVisibilityAssertion>(['kind', 'name'])
const pluginBehaviorAssertionKeys = new Set<keyof PluginBehaviorAssertion>([
  'kind',
  'name',
  'arguments',
  'expectedValue',
])
const profilePattern = /^(?!\.{1,2}$)(?!node_modules$)[^/\\]+$/u
const MAX_VISIBILITY_ASSERTIONS = 32
const MAX_VISIBILITY_ASSERTION_NAME_LENGTH = 256
const MAX_BEHAVIOR_ASSERTIONS = 8
const MAX_BEHAVIOR_ASSERTION_NAME_LENGTH = 256
const MAX_OPERATION_ID_LENGTH = 128

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

function parsePluginVisibilityAssertions(
  value: unknown,
  message: string,
): PluginVerifyRequest['visibilityAssertions'] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > MAX_VISIBILITY_ASSERTIONS
  ) invalid(message)

  const assertions: PluginVisibilityAssertion[] = []
  const seen = new Set<string>()
  for (const assertion of value) {
    if (!isRecord(assertion)) invalid(message)
    if (
      Object.keys(assertion).some(
        key => !pluginVisibilityAssertionKeys.has(key as keyof PluginVisibilityAssertion),
      )
    ) invalid(message)
    const kind = assertion.kind
    if (
      (kind !== 'host-service' && kind !== 'agent-tool')
      || typeof assertion.name !== 'string'
      || assertion.name.trim().length === 0
      || assertion.name.length > MAX_VISIBILITY_ASSERTION_NAME_LENGTH
    ) invalid(message)

    const identity = `${kind}\u0000${assertion.name}`
    if (seen.has(identity)) invalid(message)
    seen.add(identity)
    assertions.push({ kind, name: assertion.name })
  }

  return assertions as [PluginVisibilityAssertion, ...PluginVisibilityAssertion[]]
}

function parseJsonValue(value: unknown, message: string, active: Set<object> = new Set()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(message)
    return Object.is(value, -0) ? 0 : value
  }

  if (typeof value !== 'object' || value === null) invalid(message)
  if (active.has(value)) invalid(message)
  active.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map(item => parseJsonValue(item, message, active))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) invalid(message)
    const parsed: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      parsed[key] = parseJsonValue(item, message, active)
    }
    return parsed
  } finally {
    active.delete(value)
  }
}

function canonicalJsonValue(value: JsonValue): string {
  function normalize(item: JsonValue): JsonValue {
    if (Array.isArray(item)) return item.map(normalize)
    if (item !== null && typeof item === 'object') {
      const normalized: Record<string, JsonValue> = {}
      const entries = Object.entries(item).toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      for (const [key, entryValue] of entries) {
        normalized[key] = normalize(entryValue)
      }
      return normalized
    }
    if (typeof item === 'number' && Object.is(item, -0)) return 0
    return item
  }
  return JSON.stringify(normalize(value))
}

function parsePluginBehaviorAssertions(
  value: unknown,
  message: string,
): PluginVerifyRequest['behaviorAssertions'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BEHAVIOR_ASSERTIONS) {
    invalid(message)
  }

  const assertions: PluginBehaviorAssertion[] = []
  const seen = new Set<string>()
  for (const assertion of value) {
    if (!isRecord(assertion)) invalid(message)
    if (
      Object.keys(assertion).some(
        key => !pluginBehaviorAssertionKeys.has(key as keyof PluginBehaviorAssertion),
      )
    ) invalid(message)
    if (
      assertion.kind !== 'agent-tool-result'
      || typeof assertion.name !== 'string'
      || assertion.name.trim().length === 0
      || assertion.name.length > MAX_BEHAVIOR_ASSERTION_NAME_LENGTH
    ) invalid(message)

    const parsedArguments = parseJsonValue(assertion.arguments, message)
    const parsedExpectedValue = parseJsonValue(assertion.expectedValue, message)
    const identity = [
      assertion.kind,
      assertion.name,
      canonicalJsonValue(parsedArguments),
      canonicalJsonValue(parsedExpectedValue),
    ].join('\u0000')
    if (seen.has(identity)) invalid(message)
    seen.add(identity)
    assertions.push({
      kind: 'agent-tool-result',
      name: assertion.name,
      arguments: parsedArguments,
      expectedValue: parsedExpectedValue,
    })
  }

  return assertions as [PluginBehaviorAssertion, ...PluginBehaviorAssertion[]]
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
  if (
    typeof subject.kind !== 'string'
    || !pluginSubjectKinds.has(subject.kind as PluginSubjectRequest['kind'])
    || !nonEmptyString(subject.path)
  ) invalid(message)

  return {
    target: parsedTarget,
    subject: {
      kind: subject.kind as PluginSubjectRequest['kind'],
      path: subject.path,
    },
  }
}

export function parsePluginVerifyRequest(value: unknown): PluginVerifyRequest {
  const message = 'Invalid plugin.verify arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !pluginVerifyKeys.has(key as keyof PluginVerifyRequest))) invalid(message)

  const { target, subject, executionPolicy, visibilityAssertions, behaviorAssertions } = value
  const parsedTarget = parseTargetResolveRequestWithMessage(target, message)
  const parsedVisibilityAssertions = parsePluginVisibilityAssertions(visibilityAssertions, message)
  const parsedBehaviorAssertions = parsePluginBehaviorAssertions(behaviorAssertions, message)
  if (!isRecord(subject)) invalid(message)
  if (Object.keys(subject).some(key => !pluginSubjectKeys.has(key as keyof PluginSubjectRequest))) invalid(message)
  if (subject.kind !== 'packed' || !nonEmptyString(subject.path) || executionPolicy !== 'safe') invalid(message)

  return {
    target: parsedTarget,
    subject: {
      kind: 'packed',
      path: subject.path,
    },
    executionPolicy: 'safe',
    ...(parsedVisibilityAssertions === undefined ? {} : {
      visibilityAssertions: parsedVisibilityAssertions,
    }),
    ...(parsedBehaviorAssertions === undefined ? {} : {
      behaviorAssertions: parsedBehaviorAssertions,
    }),
  }
}

export function parseOperationRequest(value: unknown): OperationRequest {
  const message = 'Invalid operation arguments'
  if (!isRecord(value)) invalid(message)
  if (Object.keys(value).some(key => !operationKeys.has(key as keyof OperationRequest))) invalid(message)
  if (
    typeof value.id !== 'string'
    || value.id.trim().length === 0
    || value.id.length > MAX_OPERATION_ID_LENGTH
  ) invalid(message)

  return { id: value.id }
}
