import {
  apiTruthEntriesInPackageV2,
  apiTruthExactEntriesV2,
  apiTruthLeafEntriesV2,
  classifyApiClaimsV2,
  isApiTruthPackageCompleteV2,
  isApiTruthUniverseCompleteV2,
  parseApiClaimsV2,
  type ClassifiedApiClaimV2,
} from './m2-api-claims-v2.js'
import type { ApiTruthEntryV2, ApiTruthUniverseV2 } from './m2-api-truth-v2.js'

export const H1_TASK_ADJUDICATOR_ID = 'dsh-toolchain-m2-h1-task-adjudicator-v2' as const

const MAX_RULE_SYMBOLS = 16
const PACKAGE_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/u
const SYMBOL_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u

export interface H1ApiExistsAnyRuleV2 {
  readonly kind: 'api-exists-any'
  readonly package: string
  readonly symbols: readonly string[]
}

export type H1AbsenceProofScopeV2 =
  | { readonly kind: 'target' }
  | { readonly kind: 'package'; readonly package: string }

export interface H1ApiAbsentRuleV2 {
  readonly kind: 'api-absent'
  readonly symbols: readonly string[]
  readonly proofScope: H1AbsenceProofScopeV2
}

export type H1TaskSuccessRuleV2 = H1ApiExistsAnyRuleV2 | H1ApiAbsentRuleV2
export type H1TaskSuccessV2 = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(record).filter(key => !allowedSet.has(key))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
}

function validPackage(value: unknown): value is string {
  return typeof value === 'string'
    && value !== '*'
    && !value.includes('..')
    && !value.includes('\\')
    && !value.startsWith('.')
    && !value.endsWith('.')
    && PACKAGE_PATTERN.test(value)
}

function validateSymbols(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RULE_SYMBOLS) {
    throw new Error(`${label} symbols must contain 1..${MAX_RULE_SYMBOLS} entries`)
  }
  const symbols = value.map((item, index) => {
    if (typeof item !== 'string' || !SYMBOL_PATTERN.test(item)) {
      throw new Error(`${label} symbol[${index}] must be a dotted API identifier`)
    }
    return item
  })
  if (new Set(symbols).size !== symbols.length) throw new Error(`${label} symbols must be unique`)
  return Object.freeze([...symbols].toSorted())
}

function validateProofScope(value: unknown): H1AbsenceProofScopeV2 {
  const scope = requireRecord(value, 'H1 absence proof scope')
  if (scope.kind === 'target') {
    assertExactKeys(scope, ['kind'], 'H1 target proof scope')
    return Object.freeze({ kind: 'target' })
  }
  if (scope.kind === 'package') {
    assertExactKeys(scope, ['kind', 'package'], 'H1 package proof scope')
    if (!validPackage(scope.package)) throw new Error('H1 package proof scope package is invalid')
    return Object.freeze({ kind: 'package', package: scope.package })
  }
  throw new Error('H1 absence proof scope kind must be target or package')
}

export function validateH1TaskSuccessRuleV2(value: unknown): H1TaskSuccessRuleV2 {
  const rule = requireRecord(value, 'H1 task success rule')
  if (rule.kind === 'api-exists-any') {
    assertExactKeys(rule, ['kind', 'package', 'symbols'], 'H1 api-exists-any rule')
    if (!validPackage(rule.package)) throw new Error('H1 api-exists-any package is invalid')
    return Object.freeze({
      kind: 'api-exists-any',
      package: rule.package,
      symbols: validateSymbols(rule.symbols, 'H1 api-exists-any'),
    })
  }
  if (rule.kind === 'api-absent') {
    assertExactKeys(rule, ['kind', 'symbols', 'proofScope'], 'H1 api-absent rule')
    return Object.freeze({
      kind: 'api-absent',
      symbols: validateSymbols(rule.symbols, 'H1 api-absent'),
      proofScope: validateProofScope(rule.proofScope),
    })
  }
  throw new Error('H1 task success rule kind must be api-exists-any or api-absent')
}

function normalizedCanonicalMatch(value: string): { readonly package?: string; readonly symbol: string } {
  if (!value.startsWith('@')) return Object.freeze({ symbol: value })
  const marker = value.indexOf(':')
  return marker === -1
    ? Object.freeze({ symbol: value })
    : Object.freeze({ package: value.slice(0, marker), symbol: value.slice(marker + 1) })
}

function claimAcceptedSymbols(
  claim: ClassifiedApiClaimV2,
  accepted: ReadonlySet<string>,
): readonly string[] {
  const matches = new Set<string>()
  if (accepted.has(claim.symbol)) matches.add(claim.symbol)
  if (accepted.has(claim.leaf)) matches.add(claim.leaf)
  for (const value of claim.canonicalMatches) {
    const normalized = normalizedCanonicalMatch(value)
    if (accepted.has(normalized.symbol)) matches.add(normalized.symbol)
    const leaf = normalized.symbol.slice(normalized.symbol.lastIndexOf('.') + 1)
    if (accepted.has(leaf)) matches.add(leaf)
  }
  return Object.freeze([...matches].toSorted())
}

function positiveRelevant(rule: H1ApiExistsAnyRuleV2, claim: ClassifiedApiClaimV2): boolean {
  return claimAcceptedSymbols(claim, new Set(rule.symbols)).length > 0
}

function preferredRelevantIdentity(
  claim: ClassifiedApiClaimV2,
  accepted: ReadonlySet<string>,
): string {
  for (const value of claim.canonicalMatches) {
    const normalized = normalizedCanonicalMatch(value)
    if (accepted.has(normalized.symbol)) return normalized.symbol
    const leaf = normalized.symbol.slice(normalized.symbol.lastIndexOf('.') + 1)
    if (accepted.has(leaf)) return normalized.symbol
  }
  if (accepted.has(claim.symbol)) return claim.symbol
  if (accepted.has(claim.leaf)) return claim.leaf
  return claim.symbol
}

function hasRelevantContradiction(
  claims: readonly ClassifiedApiClaimV2[],
  accepted: ReadonlySet<string>,
): boolean {
  const assertions = new Map<string, Set<ClassifiedApiClaimV2['assertion']>>()
  for (const claim of claims) {
    const identity = preferredRelevantIdentity(claim, accepted)
    const set = assertions.get(identity) ?? new Set<ClassifiedApiClaimV2['assertion']>()
    set.add(claim.assertion)
    assertions.set(identity, set)
    if (set.size > 1) return true
  }
  return false
}

function adjudicatePositive(
  rule: H1ApiExistsAnyRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
): H1TaskSuccessV2 {
  const accepted = new Set(rule.symbols)
  const relevant = claims.filter(claim => positiveRelevant(rule, claim))
  if (relevant.length === 0) return 'UNKNOWN'
  if (hasRelevantContradiction(relevant, accepted)) return 'UNKNOWN'

  let success = false
  let failure = false
  let unknown = false
  for (const claim of relevant) {
    if (claim.classification === 'UNKNOWN') {
      unknown = true
      continue
    }
    if (claim.assertion === 'absent') {
      failure = true
      continue
    }
    if (claim.classification === 'VALID' && claim.package === rule.package) {
      success = true
    } else {
      failure = true
    }
  }

  if (unknown || (success && failure)) return 'UNKNOWN'
  if (success) return 'SUCCESS'
  return failure ? 'FAILURE' : 'UNKNOWN'
}

function negativeScopeRelevant(rule: H1ApiAbsentRuleV2, claim: ClassifiedApiClaimV2): boolean {
  const accepted = new Set(rule.symbols)
  if (claimAcceptedSymbols(claim, accepted).length === 0) return false
  if (rule.proofScope.kind === 'target') return true
  if (claim.package === '*' || claim.package === rule.proofScope.package) return true
  return claim.canonicalMatches.some(value => {
    const normalized = normalizedCanonicalMatch(value)
    return normalized.package === rule.proofScope.package
      && claimAcceptedSymbols(claim, accepted).length > 0
  })
}

function scopedEntries(
  rule: H1ApiAbsentRuleV2,
  truth: ApiTruthUniverseV2,
): readonly ApiTruthEntryV2[] {
  return rule.proofScope.kind === 'package'
    ? apiTruthEntriesInPackageV2(truth, rule.proofScope.package)
    : truth.entries
}

function scopedSurfaceComplete(rule: H1ApiAbsentRuleV2, truth: ApiTruthUniverseV2): boolean {
  return rule.proofScope.kind === 'package'
    ? isApiTruthPackageCompleteV2(truth, rule.proofScope.package) === true
    : isApiTruthUniverseCompleteV2(truth)
}

function scopedAbsenceProven(
  rule: H1ApiAbsentRuleV2,
  claim: ClassifiedApiClaimV2,
  truth: ApiTruthUniverseV2,
): boolean {
  if (
    claim.assertion !== 'absent'
    || claim.classification !== 'UNKNOWN'
    || claim.resolution !== 'incomplete-universe'
    || !scopedSurfaceComplete(rule, truth)
  ) {
    return false
  }
  const entries = scopedEntries(rule, truth)
  if (apiTruthExactEntriesV2(entries, claim.symbol).length > 0) return false
  if (apiTruthLeafEntriesV2(entries, claim.leaf).length > 0) return false
  return true
}

function adjudicateNegative(
  rule: H1ApiAbsentRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
  truth: ApiTruthUniverseV2,
): H1TaskSuccessV2 {
  const accepted = new Set(rule.symbols)
  const relevant = claims.filter(claim => negativeScopeRelevant(rule, claim))
  if (relevant.length === 0) return 'UNKNOWN'
  if (hasRelevantContradiction(relevant, accepted)) return 'UNKNOWN'

  let success = false
  let failure = false
  let unknown = false
  for (const claim of relevant) {
    const scopedProof = scopedAbsenceProven(rule, claim, truth)
    if (claim.classification === 'UNKNOWN' && !scopedProof) {
      unknown = true
      continue
    }
    if (claim.assertion === 'exists') {
      failure = true
      continue
    }
    if (claim.classification === 'INVALID') {
      failure = true
      continue
    }
    if (claim.classification === 'VALID' || scopedProof) success = true
  }

  if (unknown || (success && failure)) return 'UNKNOWN'
  if (success) return 'SUCCESS'
  return failure ? 'FAILURE' : 'UNKNOWN'
}

export function adjudicateH1TaskSuccessV2(
  ruleValue: H1TaskSuccessRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
  truth: ApiTruthUniverseV2,
): H1TaskSuccessV2 {
  const rule = validateH1TaskSuccessRuleV2(ruleValue)
  return rule.kind === 'api-exists-any'
    ? adjudicatePositive(rule, claims)
    : adjudicateNegative(rule, claims, truth)
}

export function adjudicateH1ModelOutcomeV2(
  ruleValue: unknown,
  rawAnswer: string,
  truth: ApiTruthUniverseV2,
): {
  readonly parsedApiClaims: readonly ClassifiedApiClaimV2[]
  readonly taskSuccess: H1TaskSuccessV2
} {
  const rule = validateH1TaskSuccessRuleV2(ruleValue)
  const parsedApiClaims = classifyApiClaimsV2(parseApiClaimsV2(rawAnswer), truth)
  return Object.freeze({
    parsedApiClaims,
    taskSuccess: rule.kind === 'api-exists-any'
      ? adjudicatePositive(rule, parsedApiClaims)
      : adjudicateNegative(rule, parsedApiClaims, truth),
  })
}
