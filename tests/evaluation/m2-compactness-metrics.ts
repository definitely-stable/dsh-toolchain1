import { Buffer } from 'node:buffer'

export const COMPACTNESS_METRIC_VERSION = 'dsh-contract-compactness-v1'
export const LEXICAL_NORMALIZER_VERSION = 'nfkc-lower-unicode-alnum-v1'
export const LEXICAL_SHINGLE_SIZE = 5

export type CompactnessContentClass =
  | 'identity'
  | 'evidence'
  | 'descriptive'
  | 'control'
  | 'other'

export interface WireResponseMeasurement {
  readonly wireJson: string
  readonly wireBytes: number
  readonly codePoints: number
  readonly whitespaceTokens: number
}

export interface LexicalDuplicationMeasurement {
  readonly totalShingles: number
  readonly uniqueShingles: number
  readonly duplicateShingles: number
  readonly duplicationRate: number
}

export interface LeafContentMeasurement {
  readonly scalarContentBytes: number
  readonly structuralBytes: number
  readonly identityBytes: number
  readonly evidenceBytes: number
  readonly descriptiveBytes: number
  readonly controlBytes: number
  readonly otherScalarBytes: number
  readonly repeatedLeafBytes: number
  readonly repeatedLeafBytesByClass: Readonly<Record<CompactnessContentClass, number>>
  readonly evidenceIdCount: number
  readonly uniqueEvidenceIdCount: number
  readonly descriptiveLeafStrings: readonly string[]
  readonly identityLeafStrings: readonly string[]
  readonly evidenceLeafStrings: readonly string[]
  readonly dataLeafStrings: readonly string[]
  readonly lexical: LexicalDuplicationMeasurement
}

export interface DirectionalOverlapMeasurement {
  readonly leftShingles: number
  readonly rightShingles: number
  readonly intersectionShingles: number
  readonly leftContainment: number
  readonly rightContainment: number
  readonly jaccard: number
}

export interface ExactLeafOverlapMeasurement {
  readonly intersectionBytes: number
  readonly leftBytes: number
  readonly rightBytes: number
  readonly leftContainment: number
  readonly rightContainment: number
}

export interface DistributionSummary {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p90: number
  readonly p95: number
  readonly max: number
}

type JsonPrimitive = null | boolean | number | string

type ClassifiedStrings = Record<CompactnessContentClass, string[]>

interface TraverseState {
  scalarContentBytes: number
  bytesByClass: Record<CompactnessContentClass, number>
  stringsByClass: ClassifiedStrings
  evidenceIds: string[]
}

function scalarJson(value: JsonPrimitive): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Compactness metrics require finite JSON numbers')
  }
  return JSON.stringify(value)
}

function scalarBytes(value: JsonPrimitive): number {
  return Buffer.byteLength(scalarJson(value), 'utf8')
}

function isUnder(path: readonly string[], key: string): boolean {
  return path.includes(key)
}

function isContractProjection(path: readonly string[]): boolean {
  const dataIndex = path.indexOf('data')
  if (dataIndex < 0) return false
  return path.includes('matches', dataIndex + 1) || path.includes('contract', dataIndex + 1)
}

function classifyPath(path: readonly string[]): CompactnessContentClass {
  const last = path.at(-1)
  if (isUnder(path, 'diagnostics') || last === 'protocolVersion' || last === 'requestId' || last === 'status') {
    return 'control'
  }
  if (last === 'snapshotFingerprint' || last === 'contractIndexFingerprint' || last === 'contractId') {
    return 'identity'
  }
  if (isUnder(path, 'evidenceIds')) return 'evidence'
  if (path.length >= 3 && path[0] === 'data' && path[1] === 'evidence') return 'evidence'
  if (isUnder(path, 'facts') && (last === 'key' || last === 'value')) return 'descriptive'
  if (isContractProjection(path)) {
    if (last === 'id' || last === 'name' || last === 'qualifiedName') return 'identity'
    if (last === 'kind' || last === 'availability' || last === 'summary') return 'descriptive'
  }
  return 'other'
}

function isEvidenceIdPath(path: readonly string[]): boolean {
  const last = path.at(-1)
  if (isUnder(path, 'evidenceIds')) return true
  return last === 'id' && path.length >= 3 && path[0] === 'data' && path[1] === 'evidence'
}

function newTraverseState(): TraverseState {
  return {
    scalarContentBytes: 0,
    bytesByClass: { identity: 0, evidence: 0, descriptive: 0, control: 0, other: 0 },
    stringsByClass: { identity: [], evidence: [], descriptive: [], control: [], other: [] },
    evidenceIds: [],
  }
}

function visit(value: unknown, path: readonly string[], state: TraverseState): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    const primitive = value as JsonPrimitive
    const bytes = scalarBytes(primitive)
    const contentClass = classifyPath(path)
    state.scalarContentBytes += bytes
    state.bytesByClass[contentClass] += bytes
    if (typeof primitive === 'string') {
      state.stringsByClass[contentClass].push(primitive)
      if (isEvidenceIdPath(path)) state.evidenceIds.push(primitive)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, [...path, String(index)], state))
    return
  }

  if (typeof value !== 'object' || value === undefined) {
    throw new Error(`Compactness metrics require JSON-serializable values, got ${typeof value}`)
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Compactness metrics require plain JSON objects')
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint') {
      throw new Error(`Compactness metrics require JSON-serializable property ${key}`)
    }
    visit(child, [...path, key], state)
  }
}

function repeatedBytes(values: readonly string[]): number {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let total = 0
  for (const [value, count] of counts) {
    if (count > 1) total += (count - 1) * scalarBytes(value)
  }
  return total
}

function frozenStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...values])
}

export function measureWireResponse(value: unknown): WireResponseMeasurement {
  const wireJson = JSON.stringify(value)
  if (wireJson === undefined) throw new Error('Compactness metrics require a JSON-serializable top-level value')
  const trimmed = wireJson.trim()
  return Object.freeze({
    wireJson,
    wireBytes: Buffer.byteLength(wireJson, 'utf8'),
    codePoints: [...wireJson].length,
    whitespaceTokens: trimmed === '' ? 0 : trimmed.split(/\s+/u).length,
  })
}

export function normalizeLexicalTokens(value: string): readonly string[] {
  return Object.freeze(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}

export function lexicalShingles(
  values: readonly string[],
  size: number = LEXICAL_SHINGLE_SIZE,
): readonly string[] {
  if (!Number.isInteger(size) || size <= 0) throw new Error('Lexical shingle size must be a positive integer')
  const shingles: string[] = []
  for (const value of values) {
    const tokens = normalizeLexicalTokens(value)
    for (let index = 0; index + size <= tokens.length; index += 1) {
      shingles.push(tokens.slice(index, index + size).join('\u0001'))
    }
  }
  return Object.freeze(shingles)
}

export function measureLeafContent(value: unknown): LeafContentMeasurement {
  const wire = measureWireResponse(value)
  const state = newTraverseState()
  visit(value, [], state)
  if (state.scalarContentBytes > wire.wireBytes) {
    throw new Error('Scalar content bytes cannot exceed the serialized wire payload')
  }

  const identityLeafStrings = frozenStrings(state.stringsByClass.identity)
  const evidenceLeafStrings = frozenStrings(state.stringsByClass.evidence)
  const descriptiveLeafStrings = frozenStrings(state.stringsByClass.descriptive)
  const dataLeafStrings = frozenStrings([
    ...identityLeafStrings,
    ...evidenceLeafStrings,
    ...descriptiveLeafStrings,
  ])
  const shingles = lexicalShingles(dataLeafStrings)
  const uniqueShingles = new Set(shingles)
  const duplicateShingles = shingles.length - uniqueShingles.size
  const repeatedLeafBytesByClass = Object.freeze({
    identity: repeatedBytes(identityLeafStrings),
    evidence: repeatedBytes(evidenceLeafStrings),
    descriptive: repeatedBytes(descriptiveLeafStrings),
    control: repeatedBytes(state.stringsByClass.control),
    other: repeatedBytes(state.stringsByClass.other),
  })

  return Object.freeze({
    scalarContentBytes: state.scalarContentBytes,
    structuralBytes: wire.wireBytes - state.scalarContentBytes,
    identityBytes: state.bytesByClass.identity,
    evidenceBytes: state.bytesByClass.evidence,
    descriptiveBytes: state.bytesByClass.descriptive,
    controlBytes: state.bytesByClass.control,
    otherScalarBytes: state.bytesByClass.other,
    repeatedLeafBytes: repeatedBytes(dataLeafStrings),
    repeatedLeafBytesByClass,
    evidenceIdCount: state.evidenceIds.length,
    uniqueEvidenceIdCount: new Set(state.evidenceIds).size,
    descriptiveLeafStrings,
    identityLeafStrings,
    evidenceLeafStrings,
    dataLeafStrings,
    lexical: Object.freeze({
      totalShingles: shingles.length,
      uniqueShingles: uniqueShingles.size,
      duplicateShingles,
      duplicationRate: shingles.length === 0 ? 0 : duplicateShingles / shingles.length,
    }),
  })
}

function buildUniqueShingleSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(lexicalShingles(values))
}

export function measureDirectionalOverlap(
  left: readonly string[],
  right: readonly string[],
): DirectionalOverlapMeasurement {
  const leftSet = buildUniqueShingleSet(left)
  const rightSet = buildUniqueShingleSet(right)
  let intersectionShingles = 0
  for (const shingle of leftSet) {
    if (rightSet.has(shingle)) intersectionShingles += 1
  }
  const union = leftSet.size + rightSet.size - intersectionShingles
  return Object.freeze({
    leftShingles: leftSet.size,
    rightShingles: rightSet.size,
    intersectionShingles,
    leftContainment: leftSet.size === 0 ? 0 : intersectionShingles / leftSet.size,
    rightContainment: rightSet.size === 0 ? 0 : intersectionShingles / rightSet.size,
    jaccard: union === 0 ? 0 : intersectionShingles / union,
  })
}

function multisetCounts(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function serializedStringBytes(values: readonly string[]): number {
  return values.reduce((total, value) => total + scalarBytes(value), 0)
}

export function measureExactLeafOverlap(
  left: readonly string[],
  right: readonly string[],
): ExactLeafOverlapMeasurement {
  const leftCounts = multisetCounts(left)
  const rightCounts = multisetCounts(right)
  let intersectionBytes = 0
  for (const [value, leftCount] of leftCounts) {
    const rightCount = rightCounts.get(value) ?? 0
    intersectionBytes += Math.min(leftCount, rightCount) * scalarBytes(value)
  }
  const leftBytes = serializedStringBytes(left)
  const rightBytes = serializedStringBytes(right)
  return Object.freeze({
    intersectionBytes,
    leftBytes,
    rightBytes,
    leftContainment: leftBytes === 0 ? 0 : intersectionBytes / leftBytes,
    rightContainment: rightBytes === 0 ? 0 : intersectionBytes / rightBytes,
  })
}

function nearestRank(sorted: readonly number[], percentile: number): number {
  const rank = Math.max(1, Math.min(sorted.length, Math.ceil(percentile * sorted.length)))
  const value = sorted[rank - 1]
  if (value === undefined) throw new Error('Nearest-rank selection failed unexpectedly')
  return value
}

export function summarizeDistribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) throw new Error('Distribution must be non-empty')
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('Distribution values must all be finite')
  }
  const sorted = values.toSorted((left, right) => left - right)
  const min = sorted[0]
  const max = sorted.at(-1)
  if (min === undefined || max === undefined) throw new Error('Distribution must be non-empty')
  return Object.freeze({
    count: sorted.length,
    min,
    p50: nearestRank(sorted, 0.5),
    p90: nearestRank(sorted, 0.9),
    p95: nearestRank(sorted, 0.95),
    max,
  })
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('stable-json-v1 requires finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== 'object' || value === undefined) {
    throw new Error(`stable-json-v1 requires JSON-compatible values, got ${typeof value}`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('stable-json-v1 requires plain JSON objects')
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

/** Evaluation-only stable JSON for receipt identities; not a full RFC 8785 JCS implementation. */
export function stableJsonV1(value: unknown): string {
  const serialized = JSON.stringify(stableValue(value))
  if (serialized === undefined) throw new Error('stable-json-v1 requires a JSON-compatible top-level value')
  return serialized
}
