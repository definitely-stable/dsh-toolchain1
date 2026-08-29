import type { ContractDefinition, ContractFact, Evidence } from '../../src/protocol/index.js'

import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'

const MAX_ANSWER_BYTES = 128 * 1024
const MAX_CLAIMS = 32
const CLAIM_PREFIX = 'API_CLAIM '
const CLAIM_PATTERN = /^API_CLAIM package=(\S+) symbol=(\S+) assertion=(exists|absent)$/u
const SYMBOL_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u
const PACKAGE_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/u

export interface ParsedP0ApiClaim {
  readonly package: string | '*'
  readonly symbol: string
  readonly assertion: 'exists' | 'absent'
}

export interface ClassifiedP0ApiClaim extends ParsedP0ApiClaim {
  readonly classification: 'VALID' | 'INVALID' | 'UNKNOWN'
  readonly reason: string
  readonly evidenceIds: readonly string[]
}

export type P0TaskSuccess = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

interface SymbolOwner {
  readonly package: string
  readonly evidenceIds: readonly string[]
}

interface PositiveTaskRule {
  readonly kind: 'positive'
  readonly package: string
  readonly symbols: ReadonlySet<string>
}

interface NegativeTaskRule {
  readonly kind: 'negative'
  readonly symbol: string
}

type P0TaskRule = PositiveTaskRule | NegativeTaskRule

const P0_TASK_RULES: Readonly<Record<string, P0TaskRule>> = Object.freeze({
  'p0-01': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-tools',
    symbols: new Set(['defineTool', 'DefineToolOptions', 'ParameterSchemaSpec']),
  }),
  'p0-02': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-user-approval',
    symbols: new Set(['ApprovalService', 'effectiveApprovalPolicy', 'setApprovalPolicy']),
  }),
  'p0-03': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-scope',
    symbols: new Set(['createScope', 'bindScopeParent', 'ScopeParentBinding']),
  }),
  'p0-04': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-session-query',
    symbols: new Set(['compileSessionTextFilter']),
  }),
  'p0-05': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-subagent',
    symbols: new Set(['assertSubagentMaxDepth']),
  }),
  'p0-06': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-compaction',
    symbols: new Set(['compactCheckpointSource', 'CompactionCheckpointSource']),
  }),
  'p0-07': Object.freeze({ kind: 'negative', symbol: 'patchReload' }),
  'p0-08': Object.freeze({ kind: 'negative', symbol: 'ToolAutopilot' }),
})

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validPackage(value: string): value is string | '*' {
  if (value === '*') return true
  if (value.includes('..') || value.includes('\\') || value.startsWith('.') || value.endsWith('.')) return false
  return PACKAGE_PATTERN.test(value)
}

function validSymbol(value: string): boolean {
  return SYMBOL_PATTERN.test(value)
}

function claimKey(claim: ParsedP0ApiClaim): string {
  return `${claim.package}\u0000${claim.symbol}\u0000${claim.assertion}`
}

export function parseP0ApiClaims(answer: string): readonly ParsedP0ApiClaim[] {
  if (utf8ByteLength(answer) > MAX_ANSWER_BYTES) {
    throw new Error(`P0 raw answer exceeds 128 KiB structured-adjudication limit`)
  }

  const claims: ParsedP0ApiClaim[] = []
  const seen = new Set<string>()
  for (const line of answer.split(/\r?\n/u)) {
    if (!line.startsWith(CLAIM_PREFIX)) continue
    const match = CLAIM_PATTERN.exec(line)
    if (match === null) continue
    const packageName = match[1]
    const symbol = match[2]
    const assertion = match[3]
    if (
      packageName === undefined
      || symbol === undefined
      || (assertion !== 'exists' && assertion !== 'absent')
      || !validPackage(packageName)
      || !validSymbol(symbol)
    ) {
      continue
    }

    const claim: ParsedP0ApiClaim = { package: packageName, symbol, assertion }
    const key = claimKey(claim)
    if (seen.has(key)) continue
    seen.add(key)
    claims.push(claim)
    if (claims.length > MAX_CLAIMS) {
      throw new Error(`P0 structured API claim count exceeds ${MAX_CLAIMS}`)
    }
  }
  return Object.freeze(claims)
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted())
}

function authoritativeDeclarationEvidenceIds(
  fact: ContractFact,
  evidenceById: ReadonlyMap<string, Evidence>,
): readonly string[] {
  return sortedUnique(fact.evidenceIds.filter(id => {
    const evidence = evidenceById.get(id)
    return evidence?.kind === 'type-declaration' && evidence.strength === 'authoritative'
  }))
}

function packageName(contract: ContractDefinition): string | undefined {
  if (contract.kind !== 'package' || !contract.id.startsWith('package:')) return undefined
  return contract.id.slice('package:'.length)
}

function buildSymbolOwners(
  contracts: readonly ContractDefinition[],
  evidenceById: ReadonlyMap<string, Evidence>,
): Map<string, readonly SymbolOwner[]> {
  const bySymbol = new Map<string, SymbolOwner[]>()
  for (const contract of contracts) {
    const ownerPackage = packageName(contract)
    if (ownerPackage === undefined) continue
    for (const fact of contract.facts) {
      if (fact.key !== 'declaration-export') continue
      const evidenceIds = authoritativeDeclarationEvidenceIds(fact, evidenceById)
      if (evidenceIds.length === 0) continue
      const owners = bySymbol.get(fact.value) ?? []
      owners.push({ package: ownerPackage, evidenceIds })
      bySymbol.set(fact.value, owners)
    }
  }

  for (const [symbol, owners] of bySymbol.entries()) {
    bySymbol.set(symbol, owners.toSorted((left, right) => left.package.localeCompare(right.package, 'en-US')))
  }
  return bySymbol
}

function ownerEvidence(owners: readonly SymbolOwner[]): readonly string[] {
  return sortedUnique(owners.flatMap(owner => owner.evidenceIds))
}

function packageExportEvidence(
  contract: ContractDefinition,
  symbol: string,
  evidenceById: ReadonlyMap<string, Evidence>,
): readonly string[] {
  const facts = contract.facts.filter(fact => fact.key === 'declaration-export' && fact.value === symbol)
  return sortedUnique(facts.flatMap(fact => authoritativeDeclarationEvidenceIds(fact, evidenceById)))
}

function classified(
  claim: ParsedP0ApiClaim,
  classification: ClassifiedP0ApiClaim['classification'],
  reason: string,
  evidenceIds: readonly string[] = [],
): ClassifiedP0ApiClaim {
  return Object.freeze({ ...claim, classification, reason, evidenceIds: sortedUnique(evidenceIds) })
}

export async function classifyP0ApiClaims(
  claims: readonly ParsedP0ApiClaim[],
): Promise<readonly ClassifiedP0ApiClaim[]> {
  const index = await createFrozenM2RetrievalIndex()
  const evidenceById = new Map(index.evidence.map(item => [item.id, item]))
  const packageContracts = new Map<string, ContractDefinition>()
  for (const contract of index.contracts) {
    const name = packageName(contract)
    if (name !== undefined) packageContracts.set(name, contract)
  }
  const ownersBySymbol = buildSymbolOwners(index.contracts, evidenceById)

  return Object.freeze(claims.map(claim => {
    const owners = ownersBySymbol.get(claim.symbol) ?? []

    if (claim.package === '*') {
      if (claim.assertion === 'exists') {
        return classified(
          claim,
          'UNKNOWN',
          'Target-wide positive existence does not identify a package and cannot be mapped to one concrete public API claim.',
          ownerEvidence(owners),
        )
      }
      if (owners.length === 0) {
        return classified(
          claim,
          'VALID',
          `Symbol ${claim.symbol} is absent from the complete frozen authoritative rc.2 declaration-export universe.`,
        )
      }
      return classified(
        claim,
        'INVALID',
        `Symbol ${claim.symbol} is present in the frozen rc.2 public declaration universe.`,
        ownerEvidence(owners),
      )
    }

    const contract = packageContracts.get(claim.package)
    if (claim.assertion === 'exists') {
      if (contract !== undefined) {
        const evidenceIds = packageExportEvidence(contract, claim.symbol, evidenceById)
        if (evidenceIds.length > 0) {
          return classified(
            claim,
            'VALID',
            `${claim.package} authoritatively exports ${claim.symbol} on the frozen rc.2 target.`,
            evidenceIds,
          )
        }
      }

      if (owners.length > 0) {
        return classified(
          claim,
          'INVALID',
          `${claim.symbol} is not exported by ${claim.package}; the frozen rc.2 declarations place the symbol elsewhere.`,
          ownerEvidence(owners),
        )
      }
      return classified(
        claim,
        'INVALID',
        `${claim.package}/${claim.symbol} is absent from the complete frozen authoritative rc.2 package/declaration universe.`,
      )
    }

    if (contract === undefined) {
      return classified(
        claim,
        'UNKNOWN',
        `Package ${claim.package} is not present on the frozen target, so a package-scoped absence claim is not treated as an authoritative API fact.`,
      )
    }
    const evidenceIds = packageExportEvidence(contract, claim.symbol, evidenceById)
    if (evidenceIds.length > 0) {
      return classified(
        claim,
        'INVALID',
        `${claim.package} authoritatively exports ${claim.symbol} on the frozen rc.2 target.`,
        evidenceIds,
      )
    }
    return classified(
      claim,
      'VALID',
      `${claim.symbol} is absent from ${claim.package} in the complete frozen authoritative rc.2 declaration universe.`,
    )
  }))
}

function taskRule(taskId: string): P0TaskRule {
  const rule = P0_TASK_RULES[taskId]
  if (rule === undefined) throw new Error(`unknown P0 task: ${taskId}`)
  return rule
}

function hasContradiction(claims: readonly ClassifiedP0ApiClaim[]): boolean {
  const assertions = new Map<string, Set<ParsedP0ApiClaim['assertion']>>()
  for (const claim of claims) {
    const current = assertions.get(claim.symbol) ?? new Set<ParsedP0ApiClaim['assertion']>()
    current.add(claim.assertion)
    assertions.set(claim.symbol, current)
    if (current.size > 1) return true
  }
  return false
}

function adjudicatePositiveTask(
  rule: PositiveTaskRule,
  claims: readonly ClassifiedP0ApiClaim[],
): P0TaskSuccess {
  if (hasContradiction(claims)) return 'UNKNOWN'
  if (claims.some(claim => claim.classification === 'INVALID')) return 'FAILURE'

  const required = claims.filter(claim => (
    claim.package === rule.package
    && rule.symbols.has(claim.symbol)
    && claim.assertion === 'exists'
  ))
  if (required.some(claim => claim.classification === 'UNKNOWN')) return 'UNKNOWN'
  if (required.some(claim => claim.classification === 'VALID')) return 'SUCCESS'
  return 'UNKNOWN'
}

function adjudicateNegativeTask(
  rule: NegativeTaskRule,
  claims: readonly ClassifiedP0ApiClaim[],
): P0TaskSuccess {
  const relevant = claims.filter(claim => claim.symbol === rule.symbol)
  if (hasContradiction(relevant)) return 'UNKNOWN'
  if (relevant.some(claim => claim.assertion === 'exists')) return 'FAILURE'
  if (claims.some(claim => claim.classification === 'INVALID')) return 'FAILURE'
  if (relevant.some(claim => claim.classification === 'UNKNOWN')) return 'UNKNOWN'
  if (relevant.some(claim => claim.assertion === 'absent' && claim.classification === 'VALID')) return 'SUCCESS'
  return 'UNKNOWN'
}

export function adjudicateP0TaskSuccess(
  taskId: string,
  claims: readonly ClassifiedP0ApiClaim[],
): P0TaskSuccess {
  const rule = taskRule(taskId)
  return rule.kind === 'positive'
    ? adjudicatePositiveTask(rule, claims)
    : adjudicateNegativeTask(rule, claims)
}

export async function adjudicateP0ModelOutcome(
  taskId: string,
  rawAnswer: string,
): Promise<{
  readonly parsedApiClaims: readonly ClassifiedP0ApiClaim[]
  readonly taskSuccess: P0TaskSuccess
}> {
  taskRule(taskId)
  const parsedApiClaims = await classifyP0ApiClaims(parseP0ApiClaims(rawAnswer))
  return Object.freeze({
    parsedApiClaims,
    taskSuccess: adjudicateP0TaskSuccess(taskId, parsedApiClaims),
  })
}
