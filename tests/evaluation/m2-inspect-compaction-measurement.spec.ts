import { describe, expect, it } from 'vitest'

import { M2_RETRIEVAL_FIXTURE_MANIFEST, M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

interface DistributionSummary {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p90: number
  readonly p95: number
  readonly max: number
}

interface MeasurementReceipt {
  readonly schema: 'dsh-contract-inspect-compaction-measurement-v1'
  readonly identity: {
    readonly baselineSchema: 'dsh-contract-compactness-baseline-v1'
    readonly baselineBaseCommit: string
    readonly fixtureVersion: string
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly compactRepresentation: 'dsh-contract-inspect-compact-v1'
    readonly metricVersion: 'dsh-contract-inspect-compaction-v1'
  }
  readonly population: {
    readonly inspectContracts: number
  }
  readonly comparison: {
    readonly improved: number
    readonly unchanged: number
    readonly regressed: number
    readonly totalCanonicalBytes: number
    readonly totalCompactBytes: number
    readonly totalSavedBytes: number
    readonly aggregateSavingRate: number
    readonly canonicalBytes: DistributionSummary
    readonly compactBytes: DistributionSummary
    readonly savedBytes: DistributionSummary
    readonly savingRate: DistributionSummary
  }
  readonly attribution: {
    readonly repeatedBytesByCategory: Readonly<Record<string, number>>
    readonly repeatedOccurrencesByCategory: Readonly<Record<string, number>>
  }
  readonly worstCases: {
    readonly largestCanonical: { readonly contractId: string; readonly bytes: number }
    readonly largestCompact: { readonly contractId: string; readonly bytes: number }
    readonly largestSaving: { readonly contractId: string; readonly bytes: number }
    readonly largestRegression: { readonly contractId: string | null; readonly bytes: number }
  }
}

interface MeasurementModule {
  buildInspectCompactionMeasurementV1(): Promise<MeasurementReceipt>
}

async function loadMeasurement(): Promise<MeasurementModule> {
  const moduleUrl = new URL('./m2-inspect-compaction-measurement.ts', import.meta.url).href
  return await import(moduleUrl) as MeasurementModule
}

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

describe('M2 Contract Inspect lossless compaction measurement', () => {
  it('measures every frozen Inspect contract and emits deterministic exact-byte/attribution evidence', async () => {
    const { buildInspectCompactionMeasurementV1 } = await loadMeasurement()
    const receipt = await buildInspectCompactionMeasurementV1()

    expect(receipt.schema).toBe('dsh-contract-inspect-compaction-measurement-v1')
    expect(receipt.identity).toEqual({
      baselineSchema: 'dsh-contract-compactness-baseline-v1',
      baselineBaseCommit: 'a9465a962e99ebca685f0af4c308007117dbdc41',
      fixtureVersion: 'rc2-web-v1',
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      compactRepresentation: 'dsh-contract-inspect-compact-v1',
      metricVersion: 'dsh-contract-inspect-compaction-v1',
    })
    expect(receipt.population.inspectContracts).toBe(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount)
    expect(receipt.population.inspectContracts).toBe(184)
    expect(receipt.comparison.improved + receipt.comparison.unchanged + receipt.comparison.regressed).toBe(184)

    for (const distribution of [
      receipt.comparison.canonicalBytes,
      receipt.comparison.compactBytes,
      receipt.comparison.savedBytes,
      receipt.comparison.savingRate,
    ]) {
      expect(distribution.count).toBe(184)
      expect(Object.values(distribution).every(Number.isFinite)).toBe(true)
    }

    expect(Object.keys(receipt.attribution.repeatedBytesByCategory).toSorted())
      .toEqual([...ATTRIBUTION_CATEGORIES].toSorted())
    expect(Object.keys(receipt.attribution.repeatedOccurrencesByCategory).toSorted())
      .toEqual([...ATTRIBUTION_CATEGORIES].toSorted())
    expect(Object.values(receipt.attribution.repeatedBytesByCategory).every(value => value >= 0)).toBe(true)
    expect(Object.values(receipt.attribution.repeatedOccurrencesByCategory).every(value => value >= 0)).toBe(true)

    expect(receipt.comparison.totalCanonicalBytes).toBeGreaterThan(0)
    expect(receipt.comparison.totalCompactBytes).toBeGreaterThan(0)
    expect(Number.isFinite(receipt.comparison.aggregateSavingRate)).toBe(true)

    console.log('M2_INSPECT_COMPACTION_MEASUREMENT', JSON.stringify(receipt))
  }, 15_000)
})
