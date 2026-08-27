import type {
  ContractDefinition,
  ContractFact,
  ContractKind,
  ContractReference,
  Evidence,
  TargetSnapshot,
} from '../protocol/index.js'
import type { Sha256Port } from './digest.js'

export type ContractAcquisitionErrorCode =
  | 'CONTRACT_EVIDENCE_STALE'
  | 'CONTRACT_EVIDENCE_READ_FAILED'
  | 'CONTRACT_MANIFEST_INVALID'
  | 'CONTRACT_DECLARATION_INVALID'
  | 'CONTRACT_DECLARATION_LIMIT_EXCEEDED'

export class ContractAcquisitionError extends Error {
  readonly code: ContractAcquisitionErrorCode
  readonly locations: readonly string[]

  constructor(
    code: ContractAcquisitionErrorCode,
    message: string,
    locations: readonly string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ContractAcquisitionError'
    this.code = code
    this.locations = Object.freeze([...locations])
  }
}

export interface AcquiredContractFacts {
  readonly evidence: readonly Evidence[]
  readonly contracts: readonly ContractDefinition[]
}

export interface ContractAcquisitionPort {
  acquire(snapshot: TargetSnapshot): Promise<AcquiredContractFacts>
}

export interface ContractIndex {
  readonly targetFingerprint: string
  readonly fingerprint: string
  readonly evidence: readonly Evidence[]
  readonly contracts: readonly ContractDefinition[]
}

export interface ContractSearchSelection {
  readonly matches: readonly ContractReference[]
  readonly evidence: readonly Evidence[]
}

export interface ContractInspectSelection {
  readonly contract: ContractDefinition
  readonly evidence: readonly Evidence[]
}

interface ContractIndexEvidenceProjection {
  readonly id: string
  readonly kind: Evidence['kind']
  readonly strength: Evidence['strength']
  readonly source?: string
  readonly contentHash?: string
}

interface ContractIndexProjection {
  readonly schema: 'dsh-contract-index-v1'
  readonly targetFingerprint: string
  readonly evidence: readonly ContractIndexEvidenceProjection[]
  readonly contracts: readonly ContractDefinition[]
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalizeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeValue)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, canonicalizeValue(child)]),
  ) as { readonly [key: string]: JsonValue }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted(compareCodePoints)
}

function freezeEvidence(item: Evidence): Evidence {
  return Object.freeze({ ...item })
}

function freezeFact(fact: ContractFact): ContractFact {
  const sorted = sortedUnique(fact.evidenceIds)
  const first = sorted[0]
  if (first === undefined) {
    throw new Error(`Contract fact ${fact.key} must reference at least one evidence id`)
  }
  const evidenceIds: ContractFact['evidenceIds'] = [first, ...sorted.slice(1)]
  Object.freeze(evidenceIds)
  return Object.freeze({
    key: fact.key,
    value: fact.value,
    evidenceIds,
  })
}

function compareFacts(left: ContractFact, right: ContractFact): number {
  return compareCodePoints(left.key, right.key)
    || compareCodePoints(left.value, right.value)
    || compareCodePoints(left.evidenceIds.join('\u0000'), right.evidenceIds.join('\u0000'))
}

function freezeContract(contract: ContractDefinition): ContractDefinition {
  const facts = contract.facts.map(freezeFact).toSorted(compareFacts)
  Object.freeze(facts)
  const evidenceIds = sortedUnique(contract.evidenceIds)
  Object.freeze(evidenceIds)
  return Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: contract.name,
    qualifiedName: contract.qualifiedName,
    availability: contract.availability,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    facts,
    evidenceIds,
  })
}

function evidenceProjection(item: Evidence): ContractIndexEvidenceProjection {
  return Object.freeze({
    id: item.id,
    kind: item.kind,
    strength: item.strength,
    ...(item.source === undefined ? {} : { source: item.source }),
    ...(item.contentHash === undefined ? {} : { contentHash: item.contentHash }),
  })
}

function projectionFromIndex(index: ContractIndex): ContractIndexProjection {
  return Object.freeze({
    schema: 'dsh-contract-index-v1' as const,
    targetFingerprint: index.targetFingerprint,
    evidence: Object.freeze(index.evidence.map(evidenceProjection)),
    contracts: Object.freeze(index.contracts.map(freezeContract)),
  })
}

function validateReferences(evidence: readonly Evidence[], contracts: readonly ContractDefinition[]): void {
  const ids = new Set<string>()
  for (const item of evidence) {
    if (ids.has(item.id)) throw new Error(`Contract evidence repeats id ${item.id}`)
    ids.add(item.id)
  }

  const contractIds = new Set<string>()
  for (const contract of contracts) {
    if (contractIds.has(contract.id)) throw new Error(`Contract index repeats id ${contract.id}`)
    contractIds.add(contract.id)
    for (const fact of contract.facts) {
      if (fact.evidenceIds.length === 0) {
        throw new Error(`Contract fact ${contract.id}/${fact.key} must reference at least one evidence id`)
      }
    }
    for (const evidenceId of [...contract.evidenceIds, ...contract.facts.flatMap(fact => fact.evidenceIds)]) {
      if (!ids.has(evidenceId)) {
        throw new Error(`Contract ${contract.id} references missing evidence ${evidenceId}`)
      }
    }
  }
}

export function canonicalizeContractIndexProjection(index: ContractIndex): string {
  return JSON.stringify(canonicalizeValue(projectionFromIndex(index) as unknown as JsonValue))
}

export async function createContractIndex(
  targetFingerprint: string,
  evidence: readonly Evidence[],
  contracts: readonly ContractDefinition[],
  digest: Sha256Port,
): Promise<ContractIndex> {
  const normalizedEvidence = Object.freeze(
    evidence.map(freezeEvidence).toSorted((left, right) => compareCodePoints(left.id, right.id)),
  )
  const normalizedContracts = Object.freeze(
    contracts.map(freezeContract).toSorted((left, right) => compareCodePoints(left.id, right.id)),
  )
  validateReferences(normalizedEvidence, normalizedContracts)

  const unhashed: ContractIndex = Object.freeze({
    targetFingerprint,
    fingerprint: '',
    evidence: normalizedEvidence,
    contracts: normalizedContracts,
  })
  const value = await digest.sha256Utf8(canonicalizeContractIndexProjection(unhashed))
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('SHA-256 digest port must return exactly 64 lowercase hexadecimal characters')
  }

  return Object.freeze({
    targetFingerprint,
    fingerprint: `dsh-contract-index-v1:${value}`,
    evidence: normalizedEvidence,
    contracts: normalizedContracts,
  })
}

function lexicalScore(contract: ContractDefinition, query: string): number | undefined {
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  if (normalizedQuery === '') return undefined

  const name = contract.name.toLocaleLowerCase('en-US')
  const qualifiedName = contract.qualifiedName.toLocaleLowerCase('en-US')
  if (qualifiedName === normalizedQuery) return 600
  if (name === normalizedQuery) return 550
  if (name.startsWith(normalizedQuery) || qualifiedName.startsWith(normalizedQuery)) return 500

  const tokens = normalizedQuery.split(/\s+/u)
  if (tokens.length > 1 && tokens.every(token => name.includes(token) || qualifiedName.includes(token))) {
    return 400
  }
  if (name.includes(normalizedQuery) || qualifiedName.includes(normalizedQuery)) return 300

  const facts = contract.facts.map(fact => `${fact.key} ${fact.value}`).join('\n').toLocaleLowerCase('en-US')
  const summary = contract.summary?.toLocaleLowerCase('en-US') ?? ''
  if (facts.includes(normalizedQuery) || summary.includes(normalizedQuery)) return 200
  if (tokens.length > 1 && tokens.every(token => facts.includes(token) || summary.includes(token))) return 200
  return undefined
}

function reference(contract: ContractDefinition, score: number): ContractReference {
  return Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: contract.name,
    qualifiedName: contract.qualifiedName,
    availability: contract.availability,
    score,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    evidenceIds: [...contract.evidenceIds],
  })
}

function evidenceSubset(index: ContractIndex, ids: ReadonlySet<string>): readonly Evidence[] {
  return Object.freeze(index.evidence.filter(item => ids.has(item.id)))
}

export function searchContractIndex(
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit = 10,
): ContractSearchSelection {
  const kindSet = kinds === undefined ? undefined : new Set(kinds)
  const matches = index.contracts
    .filter(contract => kindSet === undefined || kindSet.has(contract.kind))
    .map(contract => {
      const score = lexicalScore(contract, query)
      return score === undefined ? undefined : reference(contract, score)
    })
    .filter((match): match is ContractReference => match !== undefined)
    .toSorted((left, right) =>
      right.score - left.score
      || compareCodePoints(left.qualifiedName, right.qualifiedName)
      || compareCodePoints(left.id, right.id),
    )
    .slice(0, Math.max(0, limit))

  const evidenceIds = new Set(matches.flatMap(match => match.evidenceIds))
  return Object.freeze({
    matches: Object.freeze(matches),
    evidence: evidenceSubset(index, evidenceIds),
  })
}

export function inspectContractIndex(
  index: ContractIndex,
  contractId: string,
): ContractInspectSelection | undefined {
  const contract = index.contracts.find(candidate => candidate.id === contractId)
  if (contract === undefined) return undefined

  const evidenceIds = new Set([
    ...contract.evidenceIds,
    ...contract.facts.flatMap(fact => fact.evidenceIds),
  ])
  return Object.freeze({
    contract,
    evidence: evidenceSubset(index, evidenceIds),
  })
}
