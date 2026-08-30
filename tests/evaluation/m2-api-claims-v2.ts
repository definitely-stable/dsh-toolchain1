import type {
  ApiTruthEntryV2,
  ApiTruthEvidenceV2,
  ApiTruthUniverseV2,
} from './m2-api-truth-v2.js'

const MAX_ANSWER_BYTES = 128 * 1024
const MAX_CLAIMS = 32
const CLAIM_PREFIX = 'API_CLAIM '
const CLAIM_PATTERN = /^API_CLAIM package=(\S+) symbol=(\S+) assertion=(exists|absent)$/u
const SYMBOL_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/u
const PACKAGE_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/u

export interface ParsedApiClaimV2 {
  readonly package: string | '*'
  readonly symbol: string
  readonly segments: readonly string[]
  readonly leaf: string
  readonly assertion: 'exists' | 'absent'
}

export type ApiClaimResolutionV2 =
  | 'exact-export'
  | 'exact-member'
  | 'unique-member-leaf'
  | 'ambiguous-member'
  | 'wrong-package'
  | 'complete-absence'
  | 'incomplete-universe'
  | 'target-wide-positive'
  | 'qualified-absence-conflict'

export interface ClassifiedApiClaimV2 extends ParsedApiClaimV2 {
  readonly classification: 'VALID' | 'INVALID' | 'UNKNOWN'
  readonly resolution: ApiClaimResolutionV2
  readonly reason: string
  readonly evidence: readonly ApiTruthEvidenceV2[]
  readonly canonicalMatches: readonly string[]
}

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

function claimKey(claim: ParsedApiClaimV2): string {
  return `${claim.package}\u0000${claim.symbol}\u0000${claim.assertion}`
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted())
}

function evidenceKey(value: ApiTruthEvidenceV2): string {
  return `${value.path}\u0000${value.sha256}`
}

function sortedEvidence(entries: readonly ApiTruthEntryV2[]): readonly ApiTruthEvidenceV2[] {
  const byIdentity = new Map<string, ApiTruthEvidenceV2>()
  for (const entry of entries) {
    for (const item of entry.evidence) byIdentity.set(evidenceKey(item), item)
  }
  return Object.freeze([...byIdentity.values()].toSorted((left, right) => (
    left.path.localeCompare(right.path, 'en-US') || left.sha256.localeCompare(right.sha256, 'en-US')
  )))
}

function packageQualifiedMatches(entries: readonly ApiTruthEntryV2[]): readonly string[] {
  return sortedUnique(entries.map(entry => `${entry.package}:${entry.qualifiedSymbol}`))
}

function localMatches(entries: readonly ApiTruthEntryV2[]): readonly string[] {
  return sortedUnique(entries.map(entry => entry.qualifiedSymbol))
}

function classified(
  claim: ParsedApiClaimV2,
  classification: ClassifiedApiClaimV2['classification'],
  resolution: ApiClaimResolutionV2,
  reason: string,
  entries: readonly ApiTruthEntryV2[] = [],
  canonicalMatches: readonly string[] = localMatches(entries),
): ClassifiedApiClaimV2 {
  return Object.freeze({
    ...claim,
    classification,
    resolution,
    reason,
    evidence: sortedEvidence(entries),
    canonicalMatches: Object.freeze([...canonicalMatches]),
  })
}

export function parseApiClaimsV2(answer: string): readonly ParsedApiClaimV2[] {
  if (utf8ByteLength(answer) > MAX_ANSWER_BYTES) {
    throw new Error('raw answer exceeds 128 KiB structured API-claim limit')
  }

  const claims: ParsedApiClaimV2[] = []
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

    const segments = Object.freeze(symbol.split('.'))
    const claim: ParsedApiClaimV2 = Object.freeze({
      package: packageName,
      symbol,
      segments,
      leaf: segments.at(-1) ?? symbol,
      assertion,
    })
    const key = claimKey(claim)
    if (seen.has(key)) continue
    seen.add(key)
    claims.push(claim)
    if (claims.length > MAX_CLAIMS) {
      throw new Error(`structured API claim count exceeds ${MAX_CLAIMS}`)
    }
  }
  return Object.freeze(claims)
}

export function apiTruthEntriesInPackageV2(
  truth: ApiTruthUniverseV2,
  packageName: string,
): readonly ApiTruthEntryV2[] {
  return truth.entries.filter(entry => entry.package === packageName)
}

export function apiTruthExactEntriesV2(
  entries: readonly ApiTruthEntryV2[],
  symbol: string,
): readonly ApiTruthEntryV2[] {
  return entries.filter(entry => entry.qualifiedSymbol === symbol)
}

export function apiTruthLeafEntriesV2(
  entries: readonly ApiTruthEntryV2[],
  leaf: string,
): readonly ApiTruthEntryV2[] {
  return entries.filter(entry => entry.symbol === leaf)
}

function memberLeafEntries(
  entries: readonly ApiTruthEntryV2[],
  leaf: string,
): readonly ApiTruthEntryV2[] {
  return entries.filter(entry => entry.kind !== 'export' && entry.symbol === leaf)
}

export function isApiTruthPackageCompleteV2(
  truth: ApiTruthUniverseV2,
  packageName: string,
): boolean | undefined {
  return truth.packages.find(pkg => pkg.name === packageName)?.complete
}

export function isApiTruthUniverseCompleteV2(truth: ApiTruthUniverseV2): boolean {
  return truth.packages.length > 0 && truth.packages.every(pkg => pkg.complete)
}

function exactResolution(entries: readonly ApiTruthEntryV2[]): 'exact-export' | 'exact-member' {
  return entries.some(entry => entry.kind !== 'export') ? 'exact-member' : 'exact-export'
}

function globalWrongPackageCandidates(
  truth: ApiTruthUniverseV2,
  claim: ParsedApiClaimV2,
): readonly ApiTruthEntryV2[] {
  const outside = truth.entries.filter(entry => entry.package !== claim.package)
  const exact = apiTruthExactEntriesV2(outside, claim.symbol)
  if (exact.length > 0) return exact
  return claim.segments.length === 1 ? apiTruthLeafEntriesV2(outside, claim.leaf) : Object.freeze([])
}

function classifyPackageExists(
  claim: ParsedApiClaimV2,
  truth: ApiTruthUniverseV2,
): ClassifiedApiClaimV2 {
  const local = apiTruthEntriesInPackageV2(truth, claim.package)
  const exact = apiTruthExactEntriesV2(local, claim.symbol)
  if (exact.length > 0) {
    return classified(
      claim,
      'VALID',
      exactResolution(exact),
      `${claim.package} exposes ${claim.symbol} in the frozen authoritative public declaration surface.`,
      exact,
    )
  }

  if (claim.segments.length === 1) {
    const members = memberLeafEntries(local, claim.leaf)
    if (members.length === 1) {
      return classified(
        claim,
        'VALID',
        'unique-member-leaf',
        `${claim.symbol} resolves to one unique public member in ${claim.package}.`,
        members,
      )
    }
    if (members.length > 1) {
      return classified(
        claim,
        'UNKNOWN',
        'ambiguous-member',
        `${claim.symbol} matches multiple public members in ${claim.package}; the historical bare member does not identify one owner.`,
        members,
      )
    }
  }

  const elsewhere = globalWrongPackageCandidates(truth, claim)
  if (elsewhere.length > 0) {
    return classified(
      claim,
      'INVALID',
      'wrong-package',
      `${claim.symbol} is not exposed by ${claim.package}; authoritative truth places the API elsewhere.`,
      elsewhere,
      packageQualifiedMatches(elsewhere),
    )
  }

  return isApiTruthPackageCompleteV2(truth, claim.package) === true
    ? classified(
      claim,
      'INVALID',
      'complete-absence',
      `${claim.symbol} is absent from the complete authoritative public surface of ${claim.package}.`,
    )
    : classified(
      claim,
      'UNKNOWN',
      'incomplete-universe',
      `Authoritative public-surface completeness is insufficient to prove ${claim.package}/${claim.symbol} absent.`,
    )
}

function classifyPackageAbsent(
  claim: ParsedApiClaimV2,
  truth: ApiTruthUniverseV2,
): ClassifiedApiClaimV2 {
  const local = apiTruthEntriesInPackageV2(truth, claim.package)
  const exact = apiTruthExactEntriesV2(local, claim.symbol)
  if (exact.length > 0) {
    return classified(
      claim,
      'INVALID',
      exactResolution(exact),
      `${claim.package} exposes ${claim.symbol}; the absence claim contradicts authoritative truth.`,
      exact,
    )
  }

  const sameLeaf = apiTruthLeafEntriesV2(local, claim.leaf)
  if (claim.segments.length === 1 && sameLeaf.length > 0) {
    return classified(
      claim,
      'INVALID',
      exactResolution(sameLeaf),
      `${claim.package} exposes public API identity ${claim.leaf}; the absence claim is false.`,
      sameLeaf,
    )
  }
  if (claim.segments.length > 1 && sameLeaf.length > 0) {
    return classified(
      claim,
      'UNKNOWN',
      'qualified-absence-conflict',
      `A public ${claim.leaf} member exists in ${claim.package}, so the qualified absence cannot be proven from spelling alone.`,
      sameLeaf,
    )
  }

  const completeness = isApiTruthPackageCompleteV2(truth, claim.package)
  if (completeness !== true) {
    return classified(
      claim,
      'UNKNOWN',
      'incomplete-universe',
      `Authoritative public-surface completeness is insufficient to prove ${claim.package}/${claim.symbol} absent.`,
    )
  }
  return classified(
    claim,
    'VALID',
    'complete-absence',
    `${claim.symbol} is absent from the complete authoritative public surface of ${claim.package}.`,
  )
}

function classifyTargetWide(
  claim: ParsedApiClaimV2,
  truth: ApiTruthUniverseV2,
): ClassifiedApiClaimV2 {
  const exact = apiTruthExactEntriesV2(truth.entries, claim.symbol)
  const sameLeaf = apiTruthLeafEntriesV2(truth.entries, claim.leaf)

  if (claim.assertion === 'exists') {
    const matches = exact.length > 0 ? exact : sameLeaf
    return classified(
      claim,
      'UNKNOWN',
      'target-wide-positive',
      'Target-wide positive existence does not identify one package/API claim.',
      matches,
      packageQualifiedMatches(matches),
    )
  }

  if (exact.length > 0) {
    return classified(
      claim,
      'INVALID',
      exactResolution(exact),
      `${claim.symbol} exists in the authoritative target public surface.`,
      exact,
      packageQualifiedMatches(exact),
    )
  }
  if (claim.segments.length === 1 && sameLeaf.length > 0) {
    return classified(
      claim,
      'INVALID',
      exactResolution(sameLeaf),
      `${claim.symbol} exists in the authoritative target public surface.`,
      sameLeaf,
      packageQualifiedMatches(sameLeaf),
    )
  }
  if (claim.segments.length > 1 && sameLeaf.length > 0) {
    return classified(
      claim,
      'UNKNOWN',
      'qualified-absence-conflict',
      `Public member leaf ${claim.leaf} exists on the target, so qualified absence ${claim.symbol} is not proven by spelling alone.`,
      sameLeaf,
      packageQualifiedMatches(sameLeaf),
    )
  }
  if (!isApiTruthUniverseCompleteV2(truth)) {
    return classified(
      claim,
      'UNKNOWN',
      'incomplete-universe',
      `At least one authoritative package public surface is incomplete, so target-wide absence ${claim.symbol} cannot be proven.`,
    )
  }
  return classified(
    claim,
    'VALID',
    'complete-absence',
    `${claim.symbol} is absent from the complete authoritative target public surface.`,
  )
}

export function classifyApiClaimsV2(
  claims: readonly ParsedApiClaimV2[],
  truth: ApiTruthUniverseV2,
): readonly ClassifiedApiClaimV2[] {
  return Object.freeze(claims.map(claim => {
    if (claim.package === '*') return classifyTargetWide(claim, truth)
    return claim.assertion === 'exists'
      ? classifyPackageExists(claim, truth)
      : classifyPackageAbsent(claim, truth)
  }))
}
