import { describe, expect, it } from 'vitest'

import { inspectContractResponse, searchContractsResponse } from '../../src/kernel/index.js'
import {
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import { CONTRACT_SEARCH_RANKER_VERSION } from '../../src/model/contract.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import {
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  M2_RETRIEVAL_TARGET,
  createFrozenM2RetrievalIndex,
} from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

interface BaselineModule {
  readonly SEARCH_REQUEST_ID: string
  readonly INSPECT_REQUEST_ID: string
  buildCompactnessBaselineV1(): Promise<{
    readonly schema: string
    readonly identity: {
      readonly baseCommit: string
      readonly fixtureVersion: string
      readonly targetFingerprint: string
      readonly contractIndexFingerprint: string
      readonly rankerVersion: string
      readonly corpusFingerprint: string
      readonly metricVersion: string
      readonly lexicalNormalizerVersion: string
      readonly lexicalShingleSize: number
    }
    readonly search: {
      readonly cases: readonly Array<{
        readonly caseId: string
        readonly category: string
        readonly status: string
        readonly topContractId: string | null
        readonly wireBytes: number
      }>
      readonly distributions: Readonly<Record<string, unknown>>
      readonly byCategory: Readonly<Record<string, unknown>>
    }
    readonly inspect: {
      readonly cases: readonly Array<{
        readonly contractId: string
        readonly kind: string
        readonly wireBytes: number
      }>
      readonly distributions: Readonly<Record<string, unknown>>
    }
    readonly searchInspect: {
      readonly paths: readonly Array<{
        readonly searchCaseId: string
        readonly contractId: string
        readonly exact: Readonly<Record<string, unknown>>
        readonly lexical: Readonly<Record<string, unknown>>
      }>
      readonly distributions: Readonly<Record<string, unknown>>
    }
    readonly worstCases: Readonly<Record<string, unknown>>
  }>
}

async function loadBaseline(): Promise<BaselineModule> {
  const moduleUrl = new URL('./m2-compactness-baseline.ts', import.meta.url).href
  return await import(moduleUrl) as BaselineModule
}

const EXPECTED_CATEGORIES = [
  'ambiguous',
  'exact-symbol',
  'indirect',
  'natural-language',
  'no-result',
  'package-api',
] as const

describe('M2 Contract Search/Inspect deterministic compactness baseline', () => {
  it('binds the receipt to the frozen product, target, index, ranker, metric and R1 corpus', async () => {
    const { buildCompactnessBaselineV1 } = await loadBaseline()
    const baseline = await buildCompactnessBaselineV1()

    expect(baseline.schema).toBe('dsh-contract-compactness-baseline-v1')
    expect(baseline.identity).toMatchObject({
      baseCommit: 'a9465a962e99ebca685f0af4c308007117dbdc41',
      fixtureVersion: 'rc2-web-v1',
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      rankerVersion: 'dsh-contract-search-v3-conservative-abstention',
      metricVersion: 'dsh-contract-compactness-v1',
      lexicalNormalizerVersion: 'nfkc-lower-unicode-alnum-v1',
      lexicalShingleSize: 5,
    })
    expect(baseline.identity.rankerVersion).toBe(CONTRACT_SEARCH_RANKER_VERSION)
    expect(baseline.identity.corpusFingerprint).toMatch(/^dsh-contract-compactness-r1-v1:[0-9a-f]{64}$/)
  })

  it('measures every frozen R1 Search case and preserves all six categories', async () => {
    const { buildCompactnessBaselineV1 } = await loadBaseline()
    const baseline = await buildCompactnessBaselineV1()

    expect(baseline.search.cases).toHaveLength(M2_RETRIEVAL_R1.length)
    expect(new Set(baseline.search.cases.map(item => item.caseId)).size).toBe(M2_RETRIEVAL_R1.length)
    expect([...new Set(baseline.search.cases.map(item => item.category))].toSorted()).toEqual(EXPECTED_CATEGORIES)
    expect(baseline.search.cases.every(item => item.wireBytes > 0)).toBe(true)
  })

  it('measures every frozen Contract Index contract for Inspect without cherry-picking', async () => {
    const { buildCompactnessBaselineV1 } = await loadBaseline()
    const baseline = await buildCompactnessBaselineV1()
    const index = await createFrozenM2RetrievalIndex()

    expect(index.contracts).toHaveLength(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount)
    expect(baseline.inspect.cases).toHaveLength(index.contracts.length)
    expect(new Set(baseline.inspect.cases.map(item => item.contractId)).size).toBe(index.contracts.length)
    expect(baseline.inspect.cases.every(item => item.wireBytes > 0)).toBe(true)
  })

  it('creates Search -> top-1 Inspect paths only from actual production Search matches', async () => {
    const { buildCompactnessBaselineV1 } = await loadBaseline()
    const baseline = await buildCompactnessBaselineV1()
    const matchedSearchCases = baseline.search.cases.filter(item => item.status === 'ok' && item.topContractId !== null)

    expect(baseline.searchInspect.paths).toHaveLength(matchedSearchCases.length)
    expect(new Set(baseline.searchInspect.paths.map(item => item.searchCaseId))).toEqual(
      new Set(matchedSearchCases.map(item => item.caseId)),
    )
    for (const path of baseline.searchInspect.paths) {
      expect(path.contractId).toBe(
        baseline.search.cases.find(item => item.caseId === path.searchCaseId)?.topContractId,
      )
      expect(path.exact).toBeTypeOf('object')
      expect(path.lexical).toBeTypeOf('object')
    }
  })

  it('uses distinct production-length deterministic UUID request ids', async () => {
    const { SEARCH_REQUEST_ID, INSPECT_REQUEST_ID } = await loadBaseline()

    expect(SEARCH_REQUEST_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(INSPECT_REQUEST_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(SEARCH_REQUEST_ID).toHaveLength(36)
    expect(INSPECT_REQUEST_ID).toHaveLength(36)
    expect(SEARCH_REQUEST_ID).not.toBe(INSPECT_REQUEST_ID)
  })

  it('matches the exact JSON text rendered by native DSH Search and Inspect tools', async () => {
    const { SEARCH_REQUEST_ID, INSPECT_REQUEST_ID } = await loadBaseline()
    const harness = await createFrozenM2KernelHarness()
    const search = await searchContractsResponse(
      harness.kernel,
      { target: { profile: 'web' }, query: 'ToolRuntimeScheduler' },
      SEARCH_REQUEST_ID,
    )
    expect(search.status).toBe('ok')
    if (search.status !== 'ok') throw new Error('Expected frozen Search response to resolve')

    const searchTool = createContractSearchToolDefinition(async () => search)
    expect(searchTool.output.render({}, search)).toEqual([
      { type: 'text', text: JSON.stringify(search) },
    ])

    const top = search.data.matches[0]
    if (top === undefined) throw new Error('Expected frozen Search response to have a top match')
    const inspect = await inspectContractResponse(
      harness.kernel,
      {
        target: { profile: 'web' },
        contractIndexFingerprint: search.data.contractIndexFingerprint,
        contractId: top.id,
      },
      INSPECT_REQUEST_ID,
    )
    expect(inspect.status).toBe('ok')

    const inspectTool = createContractInspectToolDefinition(async () => inspect)
    expect(inspectTool.output.render({}, inspect)).toEqual([
      { type: 'text', text: JSON.stringify(inspect) },
    ])
  })
})
