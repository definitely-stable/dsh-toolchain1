import type {
  ContractDefinition,
  ContractFact,
  ContractKind,
  ContractReference,
  Evidence,
  TargetSnapshot,
} from '../protocol/index.js'
import {
  CONTRACT_SEARCH_RANKER_VERSION,
  createContractSearchIndex,
  intentQueryTokens,
  type ContractSearchDocument,
  type ContractSearchIndex,
} from './contract-search-index.js'
import type { Sha256Port } from './digest.js'

export { CONTRACT_SEARCH_RANKER_VERSION }

export type ContractAcquisitionErrorCode =
  | 'CONTRACT_EVIDENCE_STALE'
  | 'CONTRACT_EVIDENCE_READ_FAILED'
  | 'CONTRACT_MANIFEST_INVALID'
  | 'CONTRACT_DECLARATION_INVALID'
  | 'CONTRACT_DECLARATION_LIMIT_EXCEEDED'
  | 'CONTRACT_LIVE_EVIDENCE_INVALID'
  | 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED'

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

/** Optional invocation-scoped facts supplied by a runtime integration. */
export interface ContractEnrichmentPort {
  enrich(snapshot: TargetSnapshot): Promise<AcquiredContractFacts>
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

export type ContractSearchLane = 'strict' | 'intent' | 'none'
export type ContractSearchField = 'identity' | 'fact' | 'summary' | 'kind'

export interface ContractSearchTermExplanation {
  readonly token: string
  readonly documentFrequency: number
  readonly inverseDocumentFrequency: number
  readonly field: ContractSearchField
  readonly fieldWeight: number
  readonly contribution: number
  readonly factIndexes: readonly number[]
  readonly evidenceIds: readonly string[]
}

export interface ContractSearchResultExplanation {
  readonly contractId: string
  readonly score: number
  readonly terms: readonly ContractSearchTermExplanation[]
}

export interface ContractSearchExplanation {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly query: string
  readonly queryTokens: readonly string[]
  readonly lane: ContractSearchLane
  readonly results: readonly ContractSearchResultExplanation[]
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

interface LexicalMatch {
  readonly score: number
  readonly evidenceIds: readonly string[]
}

interface IntentTokenMatch {
  readonly fieldWeight: number
  readonly evidenceIds: readonly string[]
  readonly field: ContractSearchField
  readonly factIndexes: readonly number[]
}

interface RankedContractSearch {
  readonly lane: ContractSearchLane
  readonly matches: readonly ContractReference[]
  readonly intentIndex?: ContractSearchIndex
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

function sameEvidence(left: Evidence, right: Evidence): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.strength === right.strength
    && left.source === right.source
    && left.contentHash === right.contentHash
    && left.location === right.location
}

function mergedAvailability(
  left: ContractDefinition['availability'],
  right: ContractDefinition['availability'],
  contractId: string,
): ContractDefinition['availability'] {
  if (left === right) return left
  if (left === 'unknown') return right
  if (right === 'unknown') return left
  throw new ContractAcquisitionError(
    'CONTRACT_LIVE_EVIDENCE_INVALID',
    `Contract ${contractId} has conflicting live availability observations.`,
  )
}

function mergedSummary(
  left: string | undefined,
  right: string | undefined,
  contractId: string,
): string | undefined {
  if (left === undefined) return right
  if (right === undefined || left === right) return left
  throw new ContractAcquisitionError(
    'CONTRACT_LIVE_EVIDENCE_INVALID',
    `Contract ${contractId} has conflicting declared/live summaries.`,
  )
}

function mergedFacts(left: readonly ContractFact[], right: readonly ContractFact[]): ContractFact[] {
  const facts = new Map<string, { key: string; value: string; evidenceIds: string[] }>()
  for (const fact of [...left, ...right]) {
    const identity = `${fact.key}\u0000${fact.value}`
    const current = facts.get(identity)
    if (current === undefined) {
      facts.set(identity, { key: fact.key, value: fact.value, evidenceIds: [...fact.evidenceIds] })
    } else {
      current.evidenceIds.push(...fact.evidenceIds)
    }
  }
  return [...facts.values()].map(fact => {
    const ids = sortedUnique(fact.evidenceIds)
    const first = ids[0]
    if (first === undefined) throw new Error(`Contract fact ${fact.key} must reference evidence`)
    return { key: fact.key, value: fact.value, evidenceIds: [first, ...ids.slice(1)] }
  })
}

function mergeContract(left: ContractDefinition, right: ContractDefinition): ContractDefinition {
  if (
    left.kind !== right.kind
    || left.name !== right.name
    || left.qualifiedName !== right.qualifiedName
  ) {
    throw new ContractAcquisitionError(
      'CONTRACT_LIVE_EVIDENCE_INVALID',
      `Contract ${left.id} has conflicting declared/live identity fields.`,
    )
  }
  const summary = mergedSummary(left.summary, right.summary, left.id)
  return {
    id: left.id,
    kind: left.kind,
    name: left.name,
    qualifiedName: left.qualifiedName,
    availability: mergedAvailability(left.availability, right.availability, left.id),
    ...(summary === undefined ? {} : { summary }),
    facts: mergedFacts(left.facts, right.facts),
    evidenceIds: sortedUnique([...left.evidenceIds, ...right.evidenceIds]),
  }
}

/** Deterministically combine static acquisition with optional runtime evidence. */
export function mergeAcquiredContractFacts(
  base: AcquiredContractFacts,
  enrichment: AcquiredContractFacts,
): AcquiredContractFacts {
  const evidence = new Map<string, Evidence>()
  for (const item of [...base.evidence, ...enrichment.evidence]) {
    const current = evidence.get(item.id)
    if (current === undefined) {
      evidence.set(item.id, item)
    } else if (!sameEvidence(current, item)) {
      throw new ContractAcquisitionError(
        'CONTRACT_LIVE_EVIDENCE_INVALID',
        `Contract evidence id ${item.id} has conflicting contents.`,
      )
    }
  }

  const contracts = new Map<string, ContractDefinition>()
  for (const contract of [...base.contracts, ...enrichment.contracts]) {
    const current = contracts.get(contract.id)
    contracts.set(contract.id, current === undefined ? contract : mergeContract(current, contract))
  }

  return Object.freeze({
    evidence: Object.freeze([...evidence.values()]),
    contracts: Object.freeze([...contracts.values()]),
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

function frozenEvidenceIds(values: readonly string[]): readonly string[] {
  return Object.freeze(sortedUnique(values))
}

function contractExistenceWitness(contract: ContractDefinition): readonly string[] {
  const first = contract.evidenceIds[0]
  return first === undefined ? Object.freeze([]) : Object.freeze([first])
}

function factText(fact: ContractFact): string {
  return `${fact.key} ${fact.value}`.toLocaleLowerCase('en-US')
}

function factOrSummaryWitness(
  contract: ContractDefinition,
  normalizedQuery: string,
  tokens: readonly string[],
): readonly string[] | undefined {
  const summary = contract.summary?.toLocaleLowerCase('en-US') ?? ''

  const exactFact = contract.facts.find(fact => factText(fact).includes(normalizedQuery))
  if (exactFact !== undefined) return frozenEvidenceIds(exactFact.evidenceIds)
  if (summary.includes(normalizedQuery)) return contractExistenceWitness(contract)
  if (tokens.length <= 1) return undefined

  const evidenceIds: string[] = []
  let summaryUsed = false
  for (const token of tokens) {
    const matchingFact = contract.facts.find(fact => factText(fact).includes(token))
    if (matchingFact !== undefined) {
      evidenceIds.push(...matchingFact.evidenceIds)
      continue
    }
    if (summary.includes(token)) {
      summaryUsed = true
      continue
    }
    return undefined
  }
  if (summaryUsed) evidenceIds.push(...contractExistenceWitness(contract))
  return frozenEvidenceIds(evidenceIds)
}

function isIntentFallbackQuery(query: string): boolean {
  const trimmed = query.trim()
  return /\s/u.test(trimmed) && intentQueryTokens(trimmed).length >= 2
}

function requiredIntentMatches(tokenCount: number): number {
  if (tokenCount <= 1) return tokenCount
  return Math.min(3, Math.max(2, Math.ceil(tokenCount * 0.4)))
}

const INTENT_SCORE_SCALE = 100
const IDF_PRECISION = 1_000_000

function quantize(value: number): number {
  return Math.round(value * IDF_PRECISION) / IDF_PRECISION
}

function inverseDocumentFrequency(derived: ContractSearchIndex, token: string): number {
  const documentFrequency = derived.documentFrequency.get(token) ?? 0
  if (derived.documentCount <= 0 || documentFrequency <= 0) return 0
  return quantize(Math.log(
    1 + ((derived.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)),
  ))
}

function sameFactCoherenceBonus(
  document: ContractSearchDocument,
  queryTokens: readonly string[],
): number {
  let maxMatched = 0
  for (const fact of document.facts) {
    let matched = 0
    for (const token of queryTokens) {
      if (fact.uniqueTokens.has(token)) matched += 1
    }
    maxMatched = Math.max(maxMatched, matched)
  }
  return Math.max(0, maxMatched - 1)
}

function factTokenMatch(
  document: ContractSearchDocument,
  token: string,
): { readonly evidenceIds: readonly string[]; readonly factIndexes: readonly number[] } | undefined {
  const facts = document.facts.filter(fact => fact.uniqueTokens.has(token))
  if (facts.length === 0) return undefined
  return Object.freeze({
    evidenceIds: frozenEvidenceIds(facts.flatMap(fact => fact.evidenceIds)),
    factIndexes: Object.freeze(facts.map(fact => fact.index)),
  })
}

function intentTokenMatch(
  token: string,
  contract: ContractDefinition,
  document: ContractSearchDocument,
): IntentTokenMatch | undefined {
  if (document.identity.uniqueTokens.has(token)) {
    return Object.freeze({
      fieldWeight: 4,
      evidenceIds: contractExistenceWitness(contract),
      field: 'identity' as const,
      factIndexes: Object.freeze([]),
    })
  }

  const factMatch = factTokenMatch(document, token)
  if (factMatch !== undefined) {
    return Object.freeze({
      fieldWeight: 3,
      evidenceIds: factMatch.evidenceIds,
      field: 'fact' as const,
      factIndexes: factMatch.factIndexes,
    })
  }

  if (document.summary.uniqueTokens.has(token)) {
    return Object.freeze({
      fieldWeight: 2,
      evidenceIds: contractExistenceWitness(contract),
      field: 'summary' as const,
      factIndexes: Object.freeze([]),
    })
  }
  if (document.kind.uniqueTokens.has(token)) {
    return Object.freeze({
      fieldWeight: 0.5,
      evidenceIds: contractExistenceWitness(contract),
      field: 'kind' as const,
      factIndexes: Object.freeze([]),
    })
  }
  return undefined
}

function intentMatch(
  contract: ContractDefinition,
  query: string,
  derived: ContractSearchIndex,
): LexicalMatch | undefined {
  const queryTokens = intentQueryTokens(query)
  if (queryTokens.length === 0) return undefined

  const document = derived.documents.get(contract.id)
  if (document === undefined) {
    throw new Error(`ContractSearchIndex is missing contract ${contract.id}`)
  }

  const evidenceIds: string[] = []
  let matched = 0
  let weightedScore = 0

  for (const token of queryTokens) {
    const match = intentTokenMatch(token, contract, document)
    if (match === undefined) continue
    matched += 1
    weightedScore += match.fieldWeight * inverseDocumentFrequency(derived, token)
    evidenceIds.push(...match.evidenceIds)
  }

  if (matched < requiredIntentMatches(queryTokens.length)) return undefined
  const coverageBonus = Math.round((matched / queryTokens.length) * 50)
  const coherenceBonus = sameFactCoherenceBonus(document, queryTokens)
  return Object.freeze({
    score: Math.round(weightedScore * INTENT_SCORE_SCALE) + coverageBonus + coherenceBonus,
    evidenceIds: frozenEvidenceIds(evidenceIds),
  })
}

function strictLexicalMatch(contract: ContractDefinition, query: string): LexicalMatch | undefined {
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  if (normalizedQuery === '') return undefined

  const name = contract.name.toLocaleLowerCase('en-US')
  const qualifiedName = contract.qualifiedName.toLocaleLowerCase('en-US')
  const witness = contractExistenceWitness(contract)
  if (qualifiedName === normalizedQuery) return Object.freeze({ score: 600, evidenceIds: witness })
  if (name === normalizedQuery) return Object.freeze({ score: 550, evidenceIds: witness })
  if (name.startsWith(normalizedQuery) || qualifiedName.startsWith(normalizedQuery)) {
    return Object.freeze({ score: 500, evidenceIds: witness })
  }

  const tokens = normalizedQuery.split(/\s+/u)
  if (tokens.length > 1 && tokens.every(token => name.includes(token) || qualifiedName.includes(token))) {
    return Object.freeze({ score: 400, evidenceIds: witness })
  }
  if (name.includes(normalizedQuery) || qualifiedName.includes(normalizedQuery)) {
    return Object.freeze({ score: 300, evidenceIds: witness })
  }

  const evidenceIds = factOrSummaryWitness(contract, normalizedQuery, tokens)
  return evidenceIds === undefined ? undefined : Object.freeze({ score: 200, evidenceIds })
}

function reference(contract: ContractDefinition, match: LexicalMatch): ContractReference {
  return Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: contract.name,
    qualifiedName: contract.qualifiedName,
    availability: contract.availability,
    score: match.score,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    evidenceIds: [...match.evidenceIds],
  })
}

function evidenceSubset(index: ContractIndex, ids: ReadonlySet<string>): readonly Evidence[] {
  return Object.freeze(index.evidence.filter(item => ids.has(item.id)))
}

function rankedMatches(
  contracts: readonly ContractDefinition[],
  query: string,
  matcher: (contract: ContractDefinition, query: string) => LexicalMatch | undefined,
  limit: number,
): ContractReference[] {
  return contracts
    .map(contract => {
      const match = matcher(contract, query)
      return match === undefined ? undefined : reference(contract, match)
    })
    .filter((match): match is ContractReference => match !== undefined)
    .toSorted((left, right) =>
      right.score - left.score
      || compareCodePoints(left.qualifiedName, right.qualifiedName)
      || compareCodePoints(left.id, right.id),
    )
    .slice(0, Math.max(0, limit))
}

function validateDerivedSearchIndex(index: ContractIndex, derived: ContractSearchIndex): void {
  if (derived.contractIndexFingerprint !== index.fingerprint) {
    throw new Error(
      `ContractSearchIndex fingerprint mismatch: expected ${index.fingerprint}, received ${derived.contractIndexFingerprint}`,
    )
  }
  if (derived.rankerVersion !== CONTRACT_SEARCH_RANKER_VERSION) {
    throw new Error(
      `ContractSearchIndex ranker version mismatch: expected ${CONTRACT_SEARCH_RANKER_VERSION}, received ${derived.rankerVersion}`,
    )
  }
}

function rankContractSearch(
  index: ContractIndex,
  query: string,
  kinds: readonly ContractKind[] | undefined,
  limit: number,
  derived: ContractSearchIndex | undefined,
): RankedContractSearch {
  if (derived !== undefined) validateDerivedSearchIndex(index, derived)

  const kindSet = kinds === undefined ? undefined : new Set(kinds)
  const contracts = index.contracts.filter(contract => kindSet === undefined || kindSet.has(contract.kind))
  const strictMatches = rankedMatches(contracts, query, strictLexicalMatch, limit)
  if (strictMatches.length > 0) {
    return Object.freeze({ lane: 'strict' as const, matches: Object.freeze(strictMatches) })
  }
  if (!isIntentFallbackQuery(query)) {
    return Object.freeze({ lane: 'none' as const, matches: Object.freeze([]) })
  }

  const intentIndex = derived ?? createContractSearchIndex(index)
  const matches = rankedMatches(
    contracts,
    query,
    (contract, intentQuery) => intentMatch(contract, intentQuery, intentIndex),
    Math.min(limit, 1),
  )
  return Object.freeze({
    lane: matches.length === 0 ? 'none' as const : 'intent' as const,
    matches: Object.freeze(matches),
    intentIndex,
  })
}

export function searchContractIndex(
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit = 10,
  derived?: ContractSearchIndex,
): ContractSearchSelection {
  const ranked = rankContractSearch(index, query, kinds, limit, derived)
  const evidenceIds = new Set(ranked.matches.flatMap(match => match.evidenceIds))
  return Object.freeze({
    matches: ranked.matches,
    evidence: evidenceSubset(index, evidenceIds),
  })
}

export function explainContractSearch(
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit = 10,
  derived?: ContractSearchIndex,
): ContractSearchExplanation {
  const ranked = rankContractSearch(index, query, kinds, limit, derived)
  const queryTokens = intentQueryTokens(query)

  const results = ranked.matches.map(match => {
    if (ranked.lane !== 'intent' || ranked.intentIndex === undefined) {
      return Object.freeze({
        contractId: match.id,
        score: match.score,
        terms: Object.freeze([]),
      })
    }

    const contract = index.contracts.find(candidate => candidate.id === match.id)
    const document = ranked.intentIndex.documents.get(match.id)
    if (contract === undefined || document === undefined) {
      throw new Error(`ContractSearchIndex explanation is missing contract ${match.id}`)
    }

    const terms = queryTokens.flatMap(token => {
      const tokenMatch = intentTokenMatch(token, contract, document)
      if (tokenMatch === undefined) return []
      const idf = inverseDocumentFrequency(ranked.intentIndex!, token)
      const term: ContractSearchTermExplanation = Object.freeze({
        token,
        documentFrequency: ranked.intentIndex!.documentFrequency.get(token) ?? 0,
        inverseDocumentFrequency: idf,
        field: tokenMatch.field,
        fieldWeight: tokenMatch.fieldWeight,
        contribution: quantize(tokenMatch.fieldWeight * idf),
        factIndexes: Object.freeze([...tokenMatch.factIndexes]),
        evidenceIds: Object.freeze([...tokenMatch.evidenceIds]),
      })
      return [term]
    })
    return Object.freeze({
      contractId: match.id,
      score: match.score,
      terms: Object.freeze(terms),
    })
  })

  return Object.freeze({
    rankerVersion: CONTRACT_SEARCH_RANKER_VERSION,
    contractIndexFingerprint: index.fingerprint,
    query,
    queryTokens: Object.freeze([...queryTokens]),
    lane: ranked.lane,
    results: Object.freeze(results),
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
