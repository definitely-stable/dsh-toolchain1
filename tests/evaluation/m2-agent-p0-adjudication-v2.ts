import {
  apiTruthEntriesInPackageV2,
  apiTruthExactEntriesV2,
  apiTruthLeafEntriesV2,
  classifyApiClaimsV2,
  isApiTruthPackageCompleteV2,
  isApiTruthUniverseCompleteV2,
  parseApiClaimsV2,
  type ApiClaimResolutionV2,
  type ClassifiedApiClaimV2,
  type ParsedApiClaimV2,
} from './m2-api-claims-v2.js'
import type { ApiTruthEntryV2, ApiTruthUniverseV2 } from './m2-api-truth-v2.js'

export type ParsedP0ApiClaimV2 = ParsedApiClaimV2
export type P0ApiClaimResolutionV2 = ApiClaimResolutionV2
export type ClassifiedP0ApiClaimV2 = ClassifiedApiClaimV2

export const parseP0ApiClaimsV2 = parseApiClaimsV2
export const classifyP0ApiClaimsV2 = classifyApiClaimsV2

export type P0TaskSuccessV2 = 'SUCCESS' | 'FAILURE' | 'UNKNOWN'

interface PositiveTaskRuleV2 {
  readonly kind: 'positive'
  readonly package: string
  readonly symbols: ReadonlySet<string>
}

type NegativeProofScopeV2 =
  | { readonly kind: 'target' }
  | { readonly kind: 'package'; readonly package: string }

interface NegativeTaskRuleV2 {
  readonly kind: 'negative'
  readonly symbols: ReadonlySet<string>
  readonly proofScope: NegativeProofScopeV2
}

type P0TaskRuleV2 = PositiveTaskRuleV2 | NegativeTaskRuleV2

const P0_TASK_RULES_V2: Readonly<Record<string, P0TaskRuleV2>> = Object.freeze({
  'p0-01': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-tools',
    symbols: new Set(['defineTool', 'DefineToolOptions', 'ParameterSchemaSpec']),
  }),
  'p0-02': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-user-approval',
    symbols: new Set([
      'ApprovalService',
      'effectiveApprovalPolicy',
      'setApprovalPolicy',
      'ApprovalService.setPolicy',
      'ApprovalService.overrideOf',
    ]),
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
    symbols: new Set(['resolveChildDepth']),
  }),
  'p0-06': Object.freeze({
    kind: 'positive',
    package: '@deepseek-ai/dsh-compaction',
    symbols: new Set(['compactCheckpointSource', 'CompactionCheckpointSource']),
  }),
  'p0-07': Object.freeze({
    kind: 'negative',
    symbols: new Set(['patchReload', 'profile.patchReload']),
    proofScope: Object.freeze({ kind: 'target' }),
  }),
  'p0-08': Object.freeze({
    kind: 'negative',
    symbols: new Set(['ToolAutopilot']),
    proofScope: Object.freeze({ kind: 'package', package: '@deepseek-ai/dsh-tools' }),
  }),
})

function taskRule(taskId: string): P0TaskRuleV2 {
  const rule = P0_TASK_RULES_V2[taskId]
  if (rule === undefined) throw new Error(`unknown P0 task: ${taskId}`)
  return rule
}

function normalizedCanonicalMatches(claim: ClassifiedApiClaimV2): readonly string[] {
  return claim.canonicalMatches.map(value => {
    const marker = value.indexOf(':')
    return marker === -1 || !value.startsWith('@') ? value : value.slice(marker + 1)
  })
}

function positiveRelevant(
  rule: PositiveTaskRuleV2,
  claim: ClassifiedApiClaimV2,
): boolean {
  if (claim.package !== rule.package) return false
  if (rule.symbols.has(claim.symbol)) return true
  return normalizedCanonicalMatches(claim).some(value => rule.symbols.has(value))
}

function negativeRelevant(
  rule: NegativeTaskRuleV2,
  claim: ClassifiedApiClaimV2,
): boolean {
  return rule.symbols.has(claim.symbol) || rule.symbols.has(claim.leaf)
}

function contradictionForSameIdentity(claims: readonly ClassifiedApiClaimV2[]): boolean {
  const assertions = new Map<string, Set<ParsedApiClaimV2['assertion']>>()
  for (const claim of claims) {
    const canonical = claim.canonicalMatches.length === 1
      ? claim.canonicalMatches[0] ?? claim.symbol
      : claim.symbol
    const key = `${claim.package}\u0000${canonical}`
    const current = assertions.get(key) ?? new Set<ParsedApiClaimV2['assertion']>()
    current.add(claim.assertion)
    assertions.set(key, current)
    if (current.size > 1) return true
  }
  return false
}

function adjudicatePositiveTask(
  rule: PositiveTaskRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
): P0TaskSuccessV2 {
  const relevant = claims.filter(claim => positiveRelevant(rule, claim))
  if (contradictionForSameIdentity(relevant)) return 'UNKNOWN'
  if (relevant.some(claim => claim.assertion === 'exists' && claim.classification === 'VALID')) {
    return 'SUCCESS'
  }
  if (relevant.some(claim => claim.classification === 'UNKNOWN')) return 'UNKNOWN'
  if (relevant.some(claim => (
    (claim.assertion === 'exists' && claim.classification === 'INVALID')
    || (claim.assertion === 'absent' && claim.classification !== 'UNKNOWN')
  ))) {
    return 'FAILURE'
  }
  return 'UNKNOWN'
}

function scopedEntries(
  rule: NegativeTaskRuleV2,
  truth: ApiTruthUniverseV2,
): readonly ApiTruthEntryV2[] {
  return rule.proofScope.kind === 'package'
    ? apiTruthEntriesInPackageV2(truth, rule.proofScope.package)
    : truth.entries
}

function scopedSurfaceComplete(rule: NegativeTaskRuleV2, truth: ApiTruthUniverseV2): boolean {
  return rule.proofScope.kind === 'package'
    ? isApiTruthPackageCompleteV2(truth, rule.proofScope.package) === true
    : isApiTruthUniverseCompleteV2(truth)
}

function scopedAbsenceProven(
  rule: NegativeTaskRuleV2,
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

function adjudicateNegativeTask(
  rule: NegativeTaskRuleV2,
  claims: readonly ClassifiedApiClaimV2[],
  truth?: ApiTruthUniverseV2,
): P0TaskSuccessV2 {
  const relevant = claims.filter(claim => negativeRelevant(rule, claim))
  const assertions = new Set(relevant.map(claim => claim.assertion))
  if (assertions.size > 1) return 'UNKNOWN'

  const unresolvedUnknown = relevant.some(claim => (
    claim.classification === 'UNKNOWN'
    && (truth === undefined || !scopedAbsenceProven(rule, claim, truth))
  ))
  if (unresolvedUnknown) return 'UNKNOWN'

  if (relevant.some(claim => claim.assertion === 'exists')) return 'FAILURE'
  if (relevant.some(claim => claim.assertion === 'absent' && claim.classification === 'INVALID')) {
    return 'FAILURE'
  }
  if (relevant.some(claim => (
    claim.assertion === 'absent'
    && (
      claim.classification === 'VALID'
      || (claim.classification === 'UNKNOWN' && truth !== undefined && scopedAbsenceProven(rule, claim, truth))
    )
  ))) {
    return 'SUCCESS'
  }
  return 'UNKNOWN'
}

export function adjudicateP0TaskSuccessV2(
  taskId: string,
  claims: readonly ClassifiedApiClaimV2[],
  truth?: ApiTruthUniverseV2,
): P0TaskSuccessV2 {
  const rule = taskRule(taskId)
  return rule.kind === 'positive'
    ? adjudicatePositiveTask(rule, claims)
    : adjudicateNegativeTask(rule, claims, truth)
}

export function adjudicateP0ModelOutcomeV2(
  taskId: string,
  rawAnswer: string,
  truth: ApiTruthUniverseV2,
): {
  readonly parsedApiClaims: readonly ClassifiedApiClaimV2[]
  readonly taskSuccess: P0TaskSuccessV2
} {
  taskRule(taskId)
  const parsedApiClaims = classifyApiClaimsV2(parseApiClaimsV2(rawAnswer), truth)
  return Object.freeze({
    parsedApiClaims,
    taskSuccess: adjudicateP0TaskSuccessV2(taskId, parsedApiClaims, truth),
  })
}
