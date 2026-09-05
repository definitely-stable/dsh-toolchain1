import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

interface DistributionSummary {
  readonly count: number
  readonly min: number
  readonly p50: number
  readonly p90: number
  readonly p95: number
  readonly max: number
}

interface MetricsModule {
  readonly COMPACTNESS_METRIC_VERSION: string
  readonly LEXICAL_NORMALIZER_VERSION: string
  readonly LEXICAL_SHINGLE_SIZE: number
  measureWireResponse(value: unknown): {
    readonly wireJson: string
    readonly wireBytes: number
    readonly codePoints: number
    readonly whitespaceTokens: number
  }
  measureLeafContent(value: unknown): {
    readonly scalarContentBytes: number
    readonly structuralBytes: number
    readonly identityBytes: number
    readonly evidenceBytes: number
    readonly descriptiveBytes: number
    readonly controlBytes: number
    readonly otherScalarBytes: number
    readonly repeatedLeafBytes: number
    readonly repeatedLeafBytesByClass: Readonly<Record<string, number>>
    readonly evidenceIdCount: number
    readonly uniqueEvidenceIdCount: number
    readonly descriptiveLeafStrings: readonly string[]
    readonly identityLeafStrings: readonly string[]
    readonly evidenceLeafStrings: readonly string[]
    readonly dataLeafStrings: readonly string[]
    readonly lexical: {
      readonly totalShingles: number
      readonly uniqueShingles: number
      readonly duplicateShingles: number
      readonly duplicationRate: number
    }
  }
  normalizeLexicalTokens(value: string): readonly string[]
  lexicalShingles(values: readonly string[], size?: number): readonly string[]
  measureDirectionalOverlap(left: readonly string[], right: readonly string[]): {
    readonly leftShingles: number
    readonly rightShingles: number
    readonly intersectionShingles: number
    readonly leftContainment: number
    readonly rightContainment: number
    readonly jaccard: number
  }
  measureExactLeafOverlap(left: readonly string[], right: readonly string[]): {
    readonly intersectionBytes: number
    readonly leftBytes: number
    readonly rightBytes: number
    readonly leftContainment: number
    readonly rightContainment: number
  }
  summarizeDistribution(values: readonly number[]): DistributionSummary
  stableJsonV1(value: unknown): string
}

async function loadMetrics(): Promise<MetricsModule> {
  const moduleUrl = new URL('./m2-compactness-metrics.ts', import.meta.url).href
  return await import(moduleUrl) as MetricsModule
}

describe('M2 Contract Search/Inspect compactness metric primitives', () => {
  it('measures the exact JSON.stringify UTF-8 wire representation', async () => {
    const { measureWireResponse } = await loadMetrics()
    const wireJson = '{"text":"é alpha beta"}'

    expect(measureWireResponse({ text: 'é alpha beta' })).toEqual({
      wireJson,
      wireBytes: Buffer.byteLength(wireJson, 'utf8'),
      codePoints: [...wireJson].length,
      whitespaceTokens: 3,
    })
  })

  it('partitions scalar content from structural JSON bytes without losing bytes', async () => {
    const { measureLeafContent, measureWireResponse } = await loadMetrics()
    const response = {
      protocolVersion: '1',
      requestId: '00000000-0000-4000-8000-000000000001',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      status: 'ok',
      data: {
        contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
        matches: [{
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package',
          name: '@deepseek-ai/dsh-tools',
          qualifiedName: 'package:@deepseek-ai/dsh-tools',
          availability: 'unknown',
          score: 600,
          summary: 'Installed package @deepseek-ai/dsh-tools',
          evidenceIds: ['manifest:@deepseek-ai/dsh-tools'],
        }],
        evidence: [{
          id: 'manifest:@deepseek-ai/dsh-tools',
          kind: 'manifest',
          strength: 'authoritative',
          source: '@deepseek-ai/dsh-tools/package.json',
          contentHash: 'c'.repeat(64),
        }],
      },
      diagnostics: [],
    }

    const wire = measureWireResponse(response)
    const content = measureLeafContent(response)

    expect(content.scalarContentBytes + content.structuralBytes).toBe(wire.wireBytes)
    expect(
      content.identityBytes
      + content.evidenceBytes
      + content.descriptiveBytes
      + content.controlBytes
      + content.otherScalarBytes,
    ).toBe(content.scalarContentBytes)
    expect(content.evidenceIdCount).toBe(2)
    expect(content.uniqueEvidenceIdCount).toBe(1)
    expect(content.repeatedLeafBytes).toBeGreaterThan(0)
  })

  it('counts exact repeated leaf strings as a multiset beyond the first occurrence', async () => {
    const { measureLeafContent } = await loadMetrics()
    const value = {
      data: {
        contract: {
          id: 'package:alpha',
          name: 'alpha',
          qualifiedName: 'package:alpha',
          summary: 'same descriptive sentence',
          evidenceIds: ['evidence:alpha', 'evidence:alpha'],
        },
        evidence: [{
          id: 'evidence:alpha',
          source: 'same descriptive sentence',
        }],
      },
    }

    const measured = measureLeafContent(value)

    expect(measured.repeatedLeafBytes).toBeGreaterThanOrEqual(
      Buffer.byteLength(JSON.stringify('evidence:alpha'), 'utf8') * 2,
    )
    expect(measured.repeatedLeafBytesByClass.evidence).toBeGreaterThan(0)
  })

  it('normalizes ordered Unicode lexical tokens without production search-token deduplication', async () => {
    const { normalizeLexicalTokens } = await loadMetrics()

    expect(normalizeLexicalTokens('Ａlpha alpha БЕТА beta_2 Alpha')).toEqual([
      'alpha',
      'alpha',
      'бета',
      'beta',
      '2',
      'alpha',
    ])
  })

  it('forms fixed shingles inside each leaf and never across leaf boundaries', async () => {
    const { lexicalShingles } = await loadMetrics()

    expect(lexicalShingles([
      'one two three four',
      'five six seven eight nine',
    ], 5)).toEqual(['five\u0001six\u0001seven\u0001eight\u0001nine'])
  })

  it('reports asymmetric directional containment instead of relying on Jaccard alone', async () => {
    const { measureDirectionalOverlap } = await loadMetrics()
    const left = ['alpha beta gamma delta epsilon']
    const right = ['alpha beta gamma delta epsilon zeta eta']

    expect(measureDirectionalOverlap(left, right)).toMatchObject({
      leftShingles: 1,
      rightShingles: 3,
      intersectionShingles: 1,
      leftContainment: 1,
      rightContainment: 1 / 3,
      jaccard: 1 / 3,
    })
  })

  it('reports exact leaf overlap with multiset byte containment in both directions', async () => {
    const { measureExactLeafOverlap } = await loadMetrics()
    const left = ['alpha', 'alpha', 'beta']
    const right = ['alpha', 'beta', 'gamma']
    const alpha = Buffer.byteLength(JSON.stringify('alpha'), 'utf8')
    const beta = Buffer.byteLength(JSON.stringify('beta'), 'utf8')
    const leftBytes = alpha * 2 + beta
    const rightBytes = alpha + beta + Buffer.byteLength(JSON.stringify('gamma'), 'utf8')

    expect(measureExactLeafOverlap(left, right)).toEqual({
      intersectionBytes: alpha + beta,
      leftBytes,
      rightBytes,
      leftContainment: (alpha + beta) / leftBytes,
      rightContainment: (alpha + beta) / rightBytes,
    })
  })

  it('uses deterministic nearest-rank percentiles', async () => {
    const { summarizeDistribution } = await loadMetrics()

    expect(summarizeDistribution([5, 1, 4, 3, 2])).toEqual({
      count: 5,
      min: 1,
      p50: 3,
      p90: 5,
      p95: 5,
      max: 5,
    })
  })

  it('rejects empty distributions and non-finite values fail-closed', async () => {
    const { summarizeDistribution } = await loadMetrics()

    expect(() => summarizeDistribution([])).toThrow(/non-empty/i)
    expect(() => summarizeDistribution([1, Number.NaN])).toThrow(/finite/i)
    expect(() => summarizeDistribution([1, Number.POSITIVE_INFINITY])).toThrow(/finite/i)
  })

  it('stable-json-v1 sorts object keys recursively without changing array order', async () => {
    const { stableJsonV1 } = await loadMetrics()

    expect(stableJsonV1({ z: 1, a: { y: 2, b: 3 }, list: [{ d: 4, c: 5 }] })).toBe(
      '{"a":{"b":3,"y":2},"list":[{"c":5,"d":4}],"z":1}',
    )
  })

  it('freezes the metric identities and shingle size', async () => {
    const metrics = await loadMetrics()

    expect(metrics.COMPACTNESS_METRIC_VERSION).toBe('dsh-contract-compactness-v1')
    expect(metrics.LEXICAL_NORMALIZER_VERSION).toBe('nfkc-lower-unicode-alnum-v1')
    expect(metrics.LEXICAL_SHINGLE_SIZE).toBe(5)
  })
})
