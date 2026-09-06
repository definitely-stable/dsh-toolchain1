import { Buffer } from 'node:buffer'

import { inspectContractResponse } from '../../src/kernel/index.js'
import {
  CONTRACT_INSPECT_COMPACT_REPRESENTATION,
  compactContractInspectModelResponse,
  serializeContractInspectModelResponse,
} from '../../src/model/contract-inspect-compact.js'
import type { ContractInspectResponse } from '../../src/protocol/index.js'
import {
  measureWireResponse,
  summarizeDistribution,
  type DistributionSummary,
} from './m2-compactness-metrics.js'
import {
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  M2_RETRIEVAL_TARGET,
  createFrozenM2RetrievalIndex,
} from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

const BASELINE_SCHEMA = 'dsh-contract-compactness-baseline-v1' as const
const BASELINE_BASE_COMMIT = 'a9465a962e99ebca685f0af4c308007117dbdc41'
const FIXTURE_VERSION = 'rc2-web-v1'
const SERIALIZER_POLICY = 'strictly-smaller-utf8-v1' as const
const METRIC_VERSION = 'dsh-contract-inspect-compaction-v1' as const
const INSPECT_REQUEST_ID = '46c64a36-55fb-4ef8-84c2-0cf27d7431d0'

const ATTRIBUTION_CATEGORIES = [
  'contract-identity',
  'evidence-content-hash',
  'evidence-location',
  'evidence-record-id',
  'evidence-reference',
  'evidence-source',
  'fact-key',
  'fact-value',
  'other',
  'summary',
] as const

type AttributionCategory = typeof ATTRIBUTION_CATEGORIES[number]

interface InspectComparisonCase {
  readonly contractId: string
  readonly canonicalBytes: number
  readonly rawCompactBytes: number
  readonly modelBytes: number
  readonly savedBytes: number
  readonly savingRate: number
  readonly rawSavedBytes: number
}

interface StringOccurrence {
  readonly value: string
  readonly category: AttributionCategory
  readonly bytes: number
}

interface AttributionTotals {
  readonly repeatedBytesByCategory: Record<AttributionCategory, number>
  readonly repeatedOccurrencesByCategory: Record<AttributionCategory, number>
}

export interface InspectCompactionMeasurementV1 {
  readonly schema: 'dsh-contract-inspect-compaction-measurement-v1'
  readonly identity: {
    readonly baselineSchema: typeof BASELINE_SCHEMA
    readonly baselineBaseCommit: string
    readonly fixtureVersion: string
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly compactRepresentation: typeof CONTRACT_INSPECT_COMPACT_REPRESENTATION
    readonly serializerPolicy: typeof SERIALIZER_POLICY
    readonly metricVersion: typeof METRIC_VERSION
  }
  readonly population: {
    readonly inspectContracts: number
  }
  readonly comparison: {
    readonly improved: number
    readonly unchanged: number
    readonly regressed: number
    readonly totalCanonicalBytes: number
    readonly totalModelBytes: number
    readonly totalSavedBytes: number
    readonly aggregateSavingRate: number
    readonly canonicalBytes: DistributionSummary
    readonly modelBytes: DistributionSummary
    readonly savedBytes: DistributionSummary
    readonly savingRate: DistributionSummary
  }
  readonly rawCompactProjection: {
    readonly improved: number
    readonly unchanged: number
    readonly regressed: number
    readonly totalCompactBytes: number
    readonly largestRegression: { readonly contractId: string | null; readonly bytes: number }
  }
  readonly attribution: {
    readonly repeatedBytesByCategory: Readonly<Record<AttributionCategory, number>>
    readonly repeatedOccurrencesByCategory: Readonly<Record<AttributionCategory, number>>
  }
  readonly worstCases: {
    readonly largestCanonical: { readonly contractId: string; readonly bytes: number }
    readonly largestModel: { readonly contractId: string; readonly bytes: number }
    readonly largestSaving: { readonly contractId: string; readonly bytes: number }
  }
}

function emptyCategoryCounts(): Record<AttributionCategory, number> {
  return {
    'contract-identity': 0,
    'evidence-content-hash': 0,
    'evidence-location': 0,
    'evidence-record-id': 0,
    'evidence-reference': 0,
    'evidence-source': 0,
    'fact-key': 0,
    'fact-value': 0,
    other: 0,
    summary: 0,
  }
}

function classifyStringPath(path: readonly string[]): AttributionCategory {
  const last = path.at(-1)
  if (path.includes('evidenceIds')) return 'evidence-reference'

  if (path.length >= 4 && path[0] === 'data' && path[1] === 'evidence') {
    if (last === 'id') return 'evidence-record-id'
    if (last === 'source') return 'evidence-source'
    if (last === 'contentHash') return 'evidence-content-hash'
    if (last === 'location') return 'evidence-location'
  }

  if (path.length >= 5 && path[0] === 'data' && path[1] === 'contract' && path[2] === 'facts') {
    if (last === 'key') return 'fact-key'
    if (last === 'value') return 'fact-value'
  }

  if (path.length === 3 && path[0] === 'data' && path[1] === 'contract') {
    if (last === 'id' || last === 'name' || last === 'qualifiedName') return 'contract-identity'
    if (last === 'summary') return 'summary'
  }

  return 'other'
}

function stringScalarBytes(value: string): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function collectStringOccurrences(
  value: unknown,
  path: readonly string[],
  occurrences: StringOccurrence[],
): void {
  if (typeof value === 'string') {
    occurrences.push({
      value,
      category: classifyStringPath(path),
      bytes: stringScalarBytes(value),
    })
    return
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectStringOccurrences(child, [...path, String(index)], occurrences))
    return
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new Error(`Inspect compaction attribution requires JSON-compatible values, got ${typeof value}`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Inspect compaction attribution requires plain JSON objects')
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol' || typeof child === 'bigint') {
      throw new Error(`Inspect compaction attribution requires JSON-compatible property ${key}`)
    }
    collectStringOccurrences(child, [...path, key], occurrences)
  }
}

function measureRepeatedStringAttribution(value: unknown): AttributionTotals {
  const occurrences: StringOccurrence[] = []
  collectStringOccurrences(value, [], occurrences)
  const seen = new Set<string>()
  const repeatedBytesByCategory = emptyCategoryCounts()
  const repeatedOccurrencesByCategory = emptyCategoryCounts()

  for (const occurrence of occurrences) {
    if (!seen.has(occurrence.value)) {
      seen.add(occurrence.value)
      continue
    }
    repeatedBytesByCategory[occurrence.category] += occurrence.bytes
    repeatedOccurrencesByCategory[occurrence.category] += 1
  }

  return {
    repeatedBytesByCategory,
    repeatedOccurrencesByCategory,
  }
}

function addAttribution(target: AttributionTotals, addition: AttributionTotals): void {
  for (const category of ATTRIBUTION_CATEGORIES) {
    target.repeatedBytesByCategory[category] += addition.repeatedBytesByCategory[category]
    target.repeatedOccurrencesByCategory[category] += addition.repeatedOccurrencesByCategory[category]
  }
}

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function largestBy(
  cases: readonly InspectComparisonCase[],
  selector: (item: InspectComparisonCase) => number,
): InspectComparisonCase {
  const sorted = cases.toSorted((left, right) => {
    const delta = selector(right) - selector(left)
    if (delta !== 0) return delta
    return left.contractId < right.contractId ? -1 : left.contractId > right.contractId ? 1 : 0
  })
  const item = sorted[0]
  if (item === undefined) throw new Error('Inspect compaction measurement requires at least one contract')
  return item
}

async function inspectCanonical(
  contractId: string,
  harness: Awaited<ReturnType<typeof createFrozenM2KernelHarness>>,
): Promise<ContractInspectResponse> {
  const response = await inspectContractResponse(
    harness.kernel,
    {
      target: { profile: 'web' },
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      contractId,
    },
    INSPECT_REQUEST_ID,
  )
  if (response.status !== 'ok') {
    throw new Error(`Expected frozen Inspect ${contractId} to resolve, got ${response.status}`)
  }
  return response
}

export async function buildInspectCompactionMeasurementV1(): Promise<InspectCompactionMeasurementV1> {
  const index = await createFrozenM2RetrievalIndex()
  const harness = await createFrozenM2KernelHarness()
  if (index.contracts.length !== M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount) {
    throw new Error('Frozen Inspect population no longer matches its fixture manifest')
  }

  const cases: InspectComparisonCase[] = []
  const attribution: AttributionTotals = {
    repeatedBytesByCategory: emptyCategoryCounts(),
    repeatedOccurrencesByCategory: emptyCategoryCounts(),
  }

  for (const contract of index.contracts.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
    const canonical = await inspectCanonical(contract.id, harness)
    const rawCompact = compactContractInspectModelResponse(canonical)
    const canonicalBytes = measureWireResponse(canonical).wireBytes
    const rawCompactBytes = measureWireResponse(rawCompact).wireBytes
    const modelJson = serializeContractInspectModelResponse(canonical)
    const modelBytes = Buffer.byteLength(modelJson, 'utf8')
    const savedBytes = canonicalBytes - modelBytes
    cases.push(Object.freeze({
      contractId: contract.id,
      canonicalBytes,
      rawCompactBytes,
      modelBytes,
      savedBytes,
      savingRate: roundRate(savedBytes / canonicalBytes),
      rawSavedBytes: canonicalBytes - rawCompactBytes,
    }))
    addAttribution(attribution, measureRepeatedStringAttribution(canonical))
  }

  const totalCanonicalBytes = cases.reduce((sum, item) => sum + item.canonicalBytes, 0)
  const totalModelBytes = cases.reduce((sum, item) => sum + item.modelBytes, 0)
  const totalSavedBytes = totalCanonicalBytes - totalModelBytes
  const totalCompactBytes = cases.reduce((sum, item) => sum + item.rawCompactBytes, 0)
  const regressions = cases.filter(item => item.savedBytes < 0)
  const rawRegressions = cases.filter(item => item.rawSavedBytes < 0)
  const largestRawRegression = rawRegressions.length === 0
    ? null
    : largestBy(rawRegressions, item => -item.rawSavedBytes)
  const largestCanonical = largestBy(cases, item => item.canonicalBytes)
  const largestModel = largestBy(cases, item => item.modelBytes)
  const largestSaving = largestBy(cases, item => item.savedBytes)

  return Object.freeze({
    schema: 'dsh-contract-inspect-compaction-measurement-v1',
    identity: Object.freeze({
      baselineSchema: BASELINE_SCHEMA,
      baselineBaseCommit: BASELINE_BASE_COMMIT,
      fixtureVersion: FIXTURE_VERSION,
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      compactRepresentation: CONTRACT_INSPECT_COMPACT_REPRESENTATION,
      serializerPolicy: SERIALIZER_POLICY,
      metricVersion: METRIC_VERSION,
    }),
    population: Object.freeze({ inspectContracts: cases.length }),
    comparison: Object.freeze({
      improved: cases.filter(item => item.savedBytes > 0).length,
      unchanged: cases.filter(item => item.savedBytes === 0).length,
      regressed: regressions.length,
      totalCanonicalBytes,
      totalModelBytes,
      totalSavedBytes,
      aggregateSavingRate: roundRate(totalSavedBytes / totalCanonicalBytes),
      canonicalBytes: summarizeDistribution(cases.map(item => item.canonicalBytes)),
      modelBytes: summarizeDistribution(cases.map(item => item.modelBytes)),
      savedBytes: summarizeDistribution(cases.map(item => item.savedBytes)),
      savingRate: summarizeDistribution(cases.map(item => item.savingRate)),
    }),
    rawCompactProjection: Object.freeze({
      improved: cases.filter(item => item.rawSavedBytes > 0).length,
      unchanged: cases.filter(item => item.rawSavedBytes === 0).length,
      regressed: rawRegressions.length,
      totalCompactBytes,
      largestRegression: Object.freeze({
        contractId: largestRawRegression?.contractId ?? null,
        bytes: largestRawRegression === null ? 0 : -largestRawRegression.rawSavedBytes,
      }),
    }),
    attribution: Object.freeze({
      repeatedBytesByCategory: Object.freeze({ ...attribution.repeatedBytesByCategory }),
      repeatedOccurrencesByCategory: Object.freeze({ ...attribution.repeatedOccurrencesByCategory }),
    }),
    worstCases: Object.freeze({
      largestCanonical: Object.freeze({
        contractId: largestCanonical.contractId,
        bytes: largestCanonical.canonicalBytes,
      }),
      largestModel: Object.freeze({
        contractId: largestModel.contractId,
        bytes: largestModel.modelBytes,
      }),
      largestSaving: Object.freeze({
        contractId: largestSaving.contractId,
        bytes: largestSaving.savedBytes,
      }),
    }),
  })
}
