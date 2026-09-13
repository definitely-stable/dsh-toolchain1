import type { ContractDefinition } from '../protocol/index.js'

export const CONTRACT_SEARCH_RANKER_VERSION = 'dsh-contract-search-v3-conservative-abstention'

export interface ContractSearchIndexSource {
  readonly fingerprint: string
  readonly contracts: readonly ContractDefinition[]
}

export interface ContractSearchFieldDocument {
  readonly tokens: readonly string[]
  readonly uniqueTokens: ReadonlySet<string>
}

export interface ContractSearchFactDocument extends ContractSearchFieldDocument {
  readonly normalizedText: string
  readonly index: number
  readonly key: string
  readonly value: string
  readonly evidenceIds: readonly string[]
}

export interface ContractSearchDocument {
  readonly contractId: string
  readonly normalizedName: string
  readonly normalizedQualifiedName: string
  readonly normalizedSummary: string
  readonly identity: ContractSearchFieldDocument
  readonly summary: ContractSearchFieldDocument
  readonly kind: ContractSearchFieldDocument
  readonly facts: readonly ContractSearchFactDocument[]
}

export interface ContractSearchPosting {
  readonly contractId: string
}

export interface ContractSearchIndex {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly documentCount: number
  readonly documents: ReadonlyMap<string, ContractSearchDocument>
  readonly postings: ReadonlyMap<string, readonly ContractSearchPosting[]>
  readonly documentFrequency: ReadonlyMap<string, number>
  readonly retainedTokenCount: number
  readonly postingCount: number
}

const INTENT_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'api',
  'are',
  'as',
  'at',
  'be',
  'before',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'may',
  'of',
  'on',
  'or',
  'please',
  'should',
  'that',
  'the',
  'this',
  'through',
  'to',
  'use',
  'using',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'would',
  'you',
])

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].toSorted(compareCodePoints)
}

export function searchTokens(value: string): readonly string[] {
  const expanded = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (expanded === '') return Object.freeze([])
  return Object.freeze(sortedUnique(expanded.split(/\s+/u).filter(token => token !== '')))
}

export function intentQueryTokens(query: string): readonly string[] {
  return Object.freeze(searchTokens(query).filter(token => !INTENT_STOP_WORDS.has(token)))
}

export function requiredIntentMatches(tokenCount: number): number {
  if (tokenCount <= 1) return tokenCount
  return Math.min(3, Math.max(2, Math.ceil(tokenCount * 0.4)))
}

function fieldDocument(value: string): ContractSearchFieldDocument {
  const tokens = searchTokens(value)
  return Object.freeze({
    tokens,
    uniqueTokens: new Set(tokens),
  })
}

function factDocument(
  index: number,
  fact: ContractDefinition['facts'][number],
): ContractSearchFactDocument {
  const tokens = searchTokens(`${fact.key} ${fact.value}`)
  return Object.freeze({
    normalizedText: `${fact.key} ${fact.value}`.toLocaleLowerCase('en-US'),
    index,
    key: fact.key,
    value: fact.value,
    tokens,
    uniqueTokens: new Set(tokens),
    evidenceIds: Object.freeze([...fact.evidenceIds]),
  })
}

function contractDocument(contract: ContractDefinition): ContractSearchDocument {
  return Object.freeze({
    contractId: contract.id,
    normalizedName: contract.name.toLocaleLowerCase('en-US'),
    normalizedQualifiedName: contract.qualifiedName.toLocaleLowerCase('en-US'),
    normalizedSummary: contract.summary?.toLocaleLowerCase('en-US') ?? '',
    identity: fieldDocument(`${contract.name} ${contract.qualifiedName}`),
    summary: fieldDocument(contract.summary ?? ''),
    kind: fieldDocument(contract.kind),
    facts: Object.freeze(contract.facts.map((fact, index) => factDocument(index, fact))),
  })
}

function termsForDocument(document: ContractSearchDocument): readonly string[] {
  return sortedUnique([
    ...document.identity.tokens,
    ...document.summary.tokens,
    ...document.kind.tokens,
    ...document.facts.flatMap(fact => fact.tokens),
  ])
}

export function createContractSearchIndex(source: ContractSearchIndexSource): ContractSearchIndex {
  const documents = new Map<string, ContractSearchDocument>()
  const postingsByToken = new Map<string, string[]>()
  let retainedTokenCount = 0

  for (const contract of [...source.contracts].toSorted((left, right) => compareCodePoints(left.id, right.id))) {
    const document = contractDocument(contract)
    documents.set(contract.id, document)
    retainedTokenCount += document.identity.tokens.length
      + document.summary.tokens.length
      + document.kind.tokens.length
      + document.facts.reduce((sum, fact) => sum + fact.tokens.length, 0)

    for (const token of termsForDocument(document)) {
      const contractIds = postingsByToken.get(token)
      if (contractIds === undefined) postingsByToken.set(token, [contract.id])
      else contractIds.push(contract.id)
    }
  }

  const postings = new Map<string, readonly ContractSearchPosting[]>()
  const documentFrequency = new Map<string, number>()
  let postingCount = 0

  for (const token of [...postingsByToken.keys()].toSorted(compareCodePoints)) {
    const contractIds = postingsByToken.get(token) ?? []
    const tokenPostings = Object.freeze(
      sortedUnique(contractIds).map(contractId => Object.freeze({ contractId })),
    )
    postings.set(token, tokenPostings)
    documentFrequency.set(token, tokenPostings.length)
    postingCount += tokenPostings.length
  }

  return Object.freeze({
    rankerVersion: CONTRACT_SEARCH_RANKER_VERSION,
    contractIndexFingerprint: source.fingerprint,
    documentCount: documents.size,
    documents,
    postings,
    documentFrequency,
    retainedTokenCount,
    postingCount,
  })
}

export function contractSearchCandidateIds(
  index: ContractSearchIndex,
  queryTokens: readonly string[],
  requiredMatches: number,
): ReadonlySet<string> {
  if (!Number.isInteger(requiredMatches) || requiredMatches < 1) {
    throw new Error(`Contract Search requiredMatches must be a positive integer, got ${String(requiredMatches)}`)
  }

  const distinctTokens = [...new Set(queryTokens)]
  if (distinctTokens.length < requiredMatches) return new Set()

  const matchCounts = new Map<string, number>()
  for (const token of distinctTokens) {
    for (const posting of index.postings.get(token) ?? []) {
      matchCounts.set(posting.contractId, (matchCounts.get(posting.contractId) ?? 0) + 1)
    }
  }

  return new Set(
    [...matchCounts.entries()]
      .filter(([, count]) => count >= requiredMatches)
      .map(([contractId]) => contractId),
  )
}

export function contractSearchCandidatesForRanking(
  index: ContractSearchIndex,
  contracts: readonly ContractDefinition[],
  queryTokens: readonly string[],
  requiredMatches: number,
): readonly ContractDefinition[] {
  if (!Number.isInteger(requiredMatches) || requiredMatches < 1) {
    throw new Error(`Contract Search requiredMatches must be a positive integer, got ${String(requiredMatches)}`)
  }

  const distinctTokens = [...new Set(queryTokens)]
  if (distinctTokens.length < requiredMatches) return Object.freeze([])
  if (contracts.length === 0) return contracts

  const postingsToCoverEveryMatch = distinctTokens.length - requiredMatches + 1
  const rarestTokens = distinctTokens
    .map(token => Object.freeze({ token, frequency: index.documentFrequency.get(token) ?? 0 }))
    .toSorted((left, right) => left.frequency - right.frequency || compareCodePoints(left.token, right.token))
    .slice(0, postingsToCoverEveryMatch)

  const postingVisits = rarestTokens.reduce((sum, item) => sum + item.frequency, 0)
  if (postingVisits >= contracts.length) return contracts

  const candidateIds = new Set<string>()
  for (const item of rarestTokens) {
    for (const posting of index.postings.get(item.token) ?? []) {
      candidateIds.add(posting.contractId)
    }
  }

  return contracts.filter(contract => candidateIds.has(contract.id))
}

export function searchDocument(
  index: ContractSearchIndex,
  contractId: string,
): ContractSearchDocument | undefined {
  return index.documents.get(contractId)
}
