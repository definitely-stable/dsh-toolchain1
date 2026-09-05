import { createHash } from 'node:crypto'

import {
  inspectContractResponse,
  searchContractsResponse,
} from '../../src/kernel/index.js'
import { CONTRACT_SEARCH_RANKER_VERSION } from '../../src/model/contract.js'
import type { ContractInspectResponse, ContractSearchResponse } from '../../src/protocol/index.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import type { M2RetrievalCategory } from './m2-retrieval-metrics.js'
import {
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  M2_RETRIEVAL_TARGET,
  createFrozenM2RetrievalIndex,
} from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'
import {
  COMPACTNESS_METRIC_VERSION,
  LEXICAL_NORMALIZER_VERSION,
  LEXICAL_SHINGLE_SIZE,
  measureDirectionalOverlap,
  measureExactLeafOverlap,
  measureLeafContent,
  measureWireResponse,
  stableJsonV1,
  summarizeDistribution,
  type DistributionSummary,
  type LeafContentMeasurement,
} from './m2-compactness-metrics.js'

export const SEARCH_REQUEST_ID = '00000000-0000-4000-8000-000000000001'
export const INSPECT_REQUEST_ID = '00000000-0000-4000-8000-000000000002'

const BASE_PRODUCT_COMMIT = 'a9465a962e99ebca685f0af4c308007117dbdc41'
const BASELINE_SCHEMA = 'dsh-contract-compactness-baseline-v1'
const CORPUS_FINGERPRINT_PREFIX = 'dsh-contract-compactness-r1-v1:'
const EXPECTED_FIXTURE_VERSION = 'rc2-web-v1'
const EXPECTED_DSH_PACKAGE = '@deepseek-ai/dsh'
const EXPECTED_DSH_VERSION = '0.1.1-rc.2'
const EXPECTED_PROFILE = 'web'
const EXPECTED_RANKER = 'dsh-contract-search-v3-conservative-abstention'

interface ResponseCompactnessMetrics {
  readonly wireBytes: number
  readonly codePoints: number
  readonly whitespaceTokens: number
  readonly scalarContentBytes: number
  readonly structuralBytes: number
  readonly identityBytes: number
  readonly evidenceBytes: number
  readonly descriptiveBytes: number
  readonly controlBytes: number
  readonly otherScalarBytes: number
  readonly repeatedLeafBytes: number
  readonly repeatedLeafRate: number
  readonly repeatedIdentityBytes: number
  readonly repeatedEvidenceBytes: number
  readonly repeatedDescriptiveBytes: number
  readonly lexicalDuplicationRate: number
  readonly evidenceIdCount: number
  readonly uniqueEvidenceIdCount: number
  readonly uniqueEvidencePerKiB: number
}

export interface CompactnessSearchCase extends ResponseCompactnessMetrics {
  readonly caseId: string
  readonly category: M2RetrievalCategory
  readonly status: ContractSearchResponse['status']
  readonly matchCount: number
  readonly topContractId: string | null
}

export interface CompactnessInspectCase extends ResponseCompactnessMetrics {
  readonly contractId: string
  readonly kind: string
  readonly factCount: number
}

interface ExactOverlapBreakdown {
  readonly all: ReturnType<typeof measureExactLeafOverlap>
  readonly continuity: ReturnType<typeof measureExactLeafOverlap>
  readonly identity: ReturnType<typeof measureExactLeafOverlap>
  readonly evidence: ReturnType<typeof measureExactLeafOverlap>
  readonly descriptive: ReturnType<typeof measureExactLeafOverlap>
}

interface LexicalOverlapBreakdown {
  readonly all: ReturnType<typeof measureDirectionalOverlap>
  readonly continuity: ReturnType<typeof measureDirectionalOverlap>
  readonly identity: ReturnType<typeof measureDirectionalOverlap>
  readonly evidence: ReturnType<typeof measureDirectionalOverlap>
  readonly descriptive: ReturnType<typeof measureDirectionalOverlap>
}

export interface CompactnessSearchInspectPath {
  readonly searchCaseId: string
  readonly category: M2RetrievalCategory
  readonly contractId: string
  readonly searchWireBytes: number
  readonly inspectWireBytes: number
  readonly exact: ExactOverlapBreakdown
  readonly lexical: LexicalOverlapBreakdown
}

interface ResponseDistributions {
  readonly wireBytes: DistributionSummary
  readonly descriptiveBytes: DistributionSummary
  readonly evidenceBytes: DistributionSummary
  readonly repeatedLeafBytes: DistributionSummary
  readonly repeatedLeafRate: DistributionSummary
  readonly lexicalDuplicationRate: DistributionSummary
  readonly uniqueEvidencePerKiB: DistributionSummary
}

interface PathDistributions {
  readonly exactSearchCoveredByInspect: DistributionSummary
  readonly exactInspectAlreadyInSearch: DistributionSummary
  readonly exactDescriptiveSearchCoveredByInspect: DistributionSummary
  readonly exactDescriptiveInspectAlreadyInSearch: DistributionSummary
  readonly lexicalSearchCoveredByInspect: DistributionSummary
  readonly lexicalInspectAlreadyInSearch: DistributionSummary
  readonly lexicalDescriptiveSearchCoveredByInspect: DistributionSummary
  readonly lexicalDescriptiveInspectAlreadyInSearch: DistributionSummary
}

export interface CompactnessBaselineV1 {
  readonly schema: typeof BASELINE_SCHEMA
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
    readonly cases: readonly CompactnessSearchCase[]
    readonly distributions: ResponseDistributions
    readonly byCategory: Readonly<Record<M2RetrievalCategory, ResponseDistributions>>
  }
  readonly inspect: {
    readonly cases: readonly CompactnessInspectCase[]
    readonly distributions: ResponseDistributions
  }
  readonly searchInspect: {
    readonly paths: readonly CompactnessSearchInspectPath[]
    readonly distributions: PathDistributions
  }
  readonly worstCases: {
    readonly largestSearch: { readonly caseId: string; readonly wireBytes: number }
    readonly largestInspect: { readonly contractId: string; readonly wireBytes: number }
    readonly mostRepeatedSearch: { readonly caseId: string; readonly repeatedLeafBytes: number }
    readonly mostRepeatedInspect: { readonly contractId: string; readonly repeatedLeafBytes: number }
    readonly highestDescriptiveInspectReuse: {
      readonly searchCaseId: string
      readonly contractId: string
      readonly lexicalContainment: number
    }
  }
}

interface MeasuredSearchInternal {
  readonly receipt: CompactnessSearchCase
  readonly response: ContractSearchResponse
  readonly leaf: LeafContentMeasurement
}

function assertFrozenIdentity(): void {
  const manifest = M2_RETRIEVAL_FIXTURE_MANIFEST
  if (manifest.fixtureVersion !== EXPECTED_FIXTURE_VERSION) {
    throw new Error(`Compactness baseline fixture drift: ${manifest.fixtureVersion}`)
  }
  if (
    manifest.canonicalTarget.package !== EXPECTED_DSH_PACKAGE
    || manifest.canonicalTarget.version !== EXPECTED_DSH_VERSION
    || manifest.canonicalTarget.profile !== EXPECTED_PROFILE
  ) {
    throw new Error('Compactness baseline canonical target drifted from frozen rc2 Web identity')
  }
  if (manifest.expected.targetFingerprint !== M2_RETRIEVAL_TARGET.targetFingerprint) {
    throw new Error('Compactness baseline target fingerprint identity mismatch')
  }
  if (manifest.expected.contractIndexFingerprint !== M2_RETRIEVAL_TARGET.contractIndexFingerprint) {
    throw new Error('Compactness baseline Contract Index fingerprint identity mismatch')
  }
  if (CONTRACT_SEARCH_RANKER_VERSION !== EXPECTED_RANKER) {
    throw new Error(`Compactness baseline ranker drift: ${CONTRACT_SEARCH_RANKER_VERSION}`)
  }
}

function corpusFingerprint(): string {
  const digest = createHash('sha256').update(stableJsonV1(M2_RETRIEVAL_R1), 'utf8').digest('hex')
  return `${CORPUS_FINGERPRINT_PREFIX}${digest}`
}

function finiteRatio(numerator: number, denominator: number, label: string): number {
  const value = denominator === 0 ? 0 : numerator / denominator
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid compactness ratio ${label}: ${value}`)
  return value
}

function publicMetrics(value: unknown, leaf: LeafContentMeasurement): ResponseCompactnessMetrics {
  const wire = measureWireResponse(value)
  if (wire.wireBytes <= 0) throw new Error('Compactness baseline received an empty wire response')
  const metrics: ResponseCompactnessMetrics = {
    wireBytes: wire.wireBytes,
    codePoints: wire.codePoints,
    whitespaceTokens: wire.whitespaceTokens,
    scalarContentBytes: leaf.scalarContentBytes,
    structuralBytes: leaf.structuralBytes,
    identityBytes: leaf.identityBytes,
    evidenceBytes: leaf.evidenceBytes,
    descriptiveBytes: leaf.descriptiveBytes,
    controlBytes: leaf.controlBytes,
    otherScalarBytes: leaf.otherScalarBytes,
    repeatedLeafBytes: leaf.repeatedLeafBytes,
    repeatedLeafRate: finiteRatio(leaf.repeatedLeafBytes, wire.wireBytes, 'repeatedLeafRate'),
    repeatedIdentityBytes: leaf.repeatedLeafBytesByClass.identity,
    repeatedEvidenceBytes: leaf.repeatedLeafBytesByClass.evidence,
    repeatedDescriptiveBytes: leaf.repeatedLeafBytesByClass.descriptive,
    lexicalDuplicationRate: leaf.lexical.duplicationRate,
    evidenceIdCount: leaf.evidenceIdCount,
    uniqueEvidenceIdCount: leaf.uniqueEvidenceIdCount,
    uniqueEvidencePerKiB: finiteRatio(leaf.uniqueEvidenceIdCount * 1024, wire.wireBytes, 'uniqueEvidencePerKiB'),
  }
  for (const [key, metric] of Object.entries(metrics)) {
    if (typeof metric === 'number' && !Number.isFinite(metric)) {
      throw new Error(`Non-finite compactness metric ${key}`)
    }
  }
  return Object.freeze(metrics)
}

function responseDistributions(cases: readonly ResponseCompactnessMetrics[]): ResponseDistributions {
  if (cases.length === 0) throw new Error('Compactness response distribution requires at least one case')
  return Object.freeze({
    wireBytes: summarizeDistribution(cases.map(item => item.wireBytes)),
    descriptiveBytes: summarizeDistribution(cases.map(item => item.descriptiveBytes)),
    evidenceBytes: summarizeDistribution(cases.map(item => item.evidenceBytes)),
    repeatedLeafBytes: summarizeDistribution(cases.map(item => item.repeatedLeafBytes)),
    repeatedLeafRate: summarizeDistribution(cases.map(item => item.repeatedLeafRate)),
    lexicalDuplicationRate: summarizeDistribution(cases.map(item => item.lexicalDuplicationRate)),
    uniqueEvidencePerKiB: summarizeDistribution(cases.map(item => item.uniqueEvidencePerKiB)),
  })
}

function byCategory(
  cases: readonly CompactnessSearchCase[],
): Readonly<Record<M2RetrievalCategory, ResponseDistributions>> {
  const categories = [...new Set(M2_RETRIEVAL_R1.map(task => task.category))].toSorted()
  const entries = categories.map(category => {
    const selected = cases.filter(item => item.category === category)
    if (selected.length === 0) throw new Error(`Compactness baseline omitted category ${category}`)
    return [category, responseDistributions(selected)] as const
  })
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<M2RetrievalCategory, ResponseDistributions>>
}

function continuityStrings(leaf: LeafContentMeasurement): readonly string[] {
  return Object.freeze([...leaf.identityLeafStrings, ...leaf.evidenceLeafStrings])
}

function exactOverlap(search: LeafContentMeasurement, inspect: LeafContentMeasurement): ExactOverlapBreakdown {
  return Object.freeze({
    all: measureExactLeafOverlap(search.dataLeafStrings, inspect.dataLeafStrings),
    continuity: measureExactLeafOverlap(continuityStrings(search), continuityStrings(inspect)),
    identity: measureExactLeafOverlap(search.identityLeafStrings, inspect.identityLeafStrings),
    evidence: measureExactLeafOverlap(search.evidenceLeafStrings, inspect.evidenceLeafStrings),
    descriptive: measureExactLeafOverlap(search.descriptiveLeafStrings, inspect.descriptiveLeafStrings),
  })
}

function lexicalOverlap(search: LeafContentMeasurement, inspect: LeafContentMeasurement): LexicalOverlapBreakdown {
  return Object.freeze({
    all: measureDirectionalOverlap(search.dataLeafStrings, inspect.dataLeafStrings),
    continuity: measureDirectionalOverlap(continuityStrings(search), continuityStrings(inspect)),
    identity: measureDirectionalOverlap(search.identityLeafStrings, inspect.identityLeafStrings),
    evidence: measureDirectionalOverlap(search.evidenceLeafStrings, inspect.evidenceLeafStrings),
    descriptive: measureDirectionalOverlap(search.descriptiveLeafStrings, inspect.descriptiveLeafStrings),
  })
}

function pathDistributions(paths: readonly CompactnessSearchInspectPath[]): PathDistributions {
  if (paths.length === 0) throw new Error('Compactness Search -> Inspect distribution requires at least one path')
  return Object.freeze({
    exactSearchCoveredByInspect: summarizeDistribution(paths.map(item => item.exact.all.leftContainment)),
    exactInspectAlreadyInSearch: summarizeDistribution(paths.map(item => item.exact.all.rightContainment)),
    exactDescriptiveSearchCoveredByInspect: summarizeDistribution(paths.map(item => item.exact.descriptive.leftContainment)),
    exactDescriptiveInspectAlreadyInSearch: summarizeDistribution(paths.map(item => item.exact.descriptive.rightContainment)),
    lexicalSearchCoveredByInspect: summarizeDistribution(paths.map(item => item.lexical.all.leftContainment)),
    lexicalInspectAlreadyInSearch: summarizeDistribution(paths.map(item => item.lexical.all.rightContainment)),
    lexicalDescriptiveSearchCoveredByInspect: summarizeDistribution(paths.map(item => item.lexical.descriptive.leftContainment)),
    lexicalDescriptiveInspectAlreadyInSearch: summarizeDistribution(paths.map(item => item.lexical.descriptive.rightContainment)),
  })
}

function validateInspectEvidence(response: Extract<ContractInspectResponse, { readonly status: 'ok' }>): void {
  const returned = new Set(response.data.evidence.map(item => item.id))
  const referenced = [
    ...response.data.contract.evidenceIds,
    ...response.data.contract.facts.flatMap(fact => fact.evidenceIds),
  ]
  for (const evidenceId of referenced) {
    if (!returned.has(evidenceId)) {
      throw new Error(`Compactness Inspect response omitted referenced evidence ${evidenceId}`)
    }
  }
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function maxBy<T>(
  values: readonly T[],
  metric: (value: T) => number,
  id: (value: T) => string,
): T {
  const sorted = values.toSorted((left, right) => {
    const byMetric = metric(right) - metric(left)
    return byMetric || compareCodePoints(id(left), id(right))
  })
  const first = sorted[0]
  if (first === undefined) throw new Error('Compactness worst-case selection requires at least one value')
  return first
}

async function buildUncached(): Promise<CompactnessBaselineV1> {
  assertFrozenIdentity()
  const index = await createFrozenM2RetrievalIndex()
  if (index.fingerprint !== M2_RETRIEVAL_TARGET.contractIndexFingerprint) {
    throw new Error(`Compactness baseline built unexpected Contract Index ${index.fingerprint}`)
  }
  if (index.contracts.length !== M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount) {
    throw new Error(`Compactness baseline contract count drift: ${index.contracts.length}`)
  }

  const taskIds = new Set<string>()
  for (const task of M2_RETRIEVAL_R1) {
    if (taskIds.has(task.id)) throw new Error(`Duplicate compactness Search case id ${task.id}`)
    taskIds.add(task.id)
  }

  const harness = await createFrozenM2KernelHarness()
  const measuredSearch: MeasuredSearchInternal[] = []

  for (const task of M2_RETRIEVAL_R1) {
    const response = await searchContractsResponse(
      harness.kernel,
      { target: { profile: EXPECTED_PROFILE }, query: task.query },
      SEARCH_REQUEST_ID,
    )
    const leaf = measureLeafContent(response)
    const topContractId = response.status === 'ok' ? response.data.matches[0]?.id ?? null : null
    measuredSearch.push(Object.freeze({
      response,
      leaf,
      receipt: Object.freeze({
        caseId: task.id,
        category: task.category,
        status: response.status,
        matchCount: response.status === 'ok' ? response.data.matches.length : 0,
        topContractId,
        ...publicMetrics(response, leaf),
      }),
    }))
  }

  const inspectCases: CompactnessInspectCase[] = []
  const inspectContractIds = new Set<string>()
  for (const contract of index.contracts) {
    if (inspectContractIds.has(contract.id)) {
      throw new Error(`Duplicate compactness Inspect contract id ${contract.id}`)
    }
    inspectContractIds.add(contract.id)
    const response = await inspectContractResponse(
      harness.kernel,
      {
        target: { profile: EXPECTED_PROFILE },
        contractIndexFingerprint: index.fingerprint,
        contractId: contract.id,
      },
      INSPECT_REQUEST_ID,
    )
    if (response.status !== 'ok') {
      throw new Error(`Compactness exhaustive Inspect failed for ${contract.id}: ${response.status}`)
    }
    if (response.data.contractIndexFingerprint !== index.fingerprint) {
      throw new Error(`Compactness Inspect Contract Index drift for ${contract.id}`)
    }
    if (response.data.contract.id !== contract.id) {
      throw new Error(`Compactness Inspect returned ${response.data.contract.id} for ${contract.id}`)
    }
    validateInspectEvidence(response)
    const leaf = measureLeafContent(response)
    inspectCases.push(Object.freeze({
      contractId: contract.id,
      kind: contract.kind,
      factCount: response.data.contract.facts.length,
      ...publicMetrics(response, leaf),
    }))
  }

  const paths: CompactnessSearchInspectPath[] = []
  for (const search of measuredSearch) {
    if (search.response.status !== 'ok') continue
    const top = search.response.data.matches[0]
    if (top === undefined) continue
    const inspect = await inspectContractResponse(
      harness.kernel,
      {
        target: { profile: EXPECTED_PROFILE },
        contractIndexFingerprint: search.response.data.contractIndexFingerprint,
        contractId: top.id,
      },
      INSPECT_REQUEST_ID,
    )
    if (inspect.status !== 'ok') {
      throw new Error(`Compactness Search -> Inspect failed for ${search.receipt.caseId}: ${inspect.status}`)
    }
    if (inspect.data.contractIndexFingerprint !== search.response.data.contractIndexFingerprint) {
      throw new Error(`Compactness Search -> Inspect index mismatch for ${search.receipt.caseId}`)
    }
    if (inspect.data.contract.id !== top.id) {
      throw new Error(`Compactness Search -> Inspect contract mismatch for ${search.receipt.caseId}`)
    }
    validateInspectEvidence(inspect)
    const inspectLeaf = measureLeafContent(inspect)
    paths.push(Object.freeze({
      searchCaseId: search.receipt.caseId,
      category: search.receipt.category,
      contractId: top.id,
      searchWireBytes: search.receipt.wireBytes,
      inspectWireBytes: measureWireResponse(inspect).wireBytes,
      exact: exactOverlap(search.leaf, inspectLeaf),
      lexical: lexicalOverlap(search.leaf, inspectLeaf),
    }))
  }

  const searchCases = Object.freeze(measuredSearch.map(item => item.receipt))
  const frozenInspectCases = Object.freeze(inspectCases)
  const frozenPaths = Object.freeze(paths)

  const largestSearch = maxBy(searchCases, item => item.wireBytes, item => item.caseId)
  const largestInspect = maxBy(frozenInspectCases, item => item.wireBytes, item => item.contractId)
  const mostRepeatedSearch = maxBy(searchCases, item => item.repeatedLeafBytes, item => item.caseId)
  const mostRepeatedInspect = maxBy(frozenInspectCases, item => item.repeatedLeafBytes, item => item.contractId)
  const highestDescriptiveInspectReuse = maxBy(
    frozenPaths,
    item => item.lexical.descriptive.rightContainment,
    item => `${item.searchCaseId}\u0000${item.contractId}`,
  )

  return Object.freeze({
    schema: BASELINE_SCHEMA,
    identity: Object.freeze({
      baseCommit: BASE_PRODUCT_COMMIT,
      fixtureVersion: EXPECTED_FIXTURE_VERSION,
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      rankerVersion: CONTRACT_SEARCH_RANKER_VERSION,
      corpusFingerprint: corpusFingerprint(),
      metricVersion: COMPACTNESS_METRIC_VERSION,
      lexicalNormalizerVersion: LEXICAL_NORMALIZER_VERSION,
      lexicalShingleSize: LEXICAL_SHINGLE_SIZE,
    }),
    search: Object.freeze({
      cases: searchCases,
      distributions: responseDistributions(searchCases),
      byCategory: byCategory(searchCases),
    }),
    inspect: Object.freeze({
      cases: frozenInspectCases,
      distributions: responseDistributions(frozenInspectCases),
    }),
    searchInspect: Object.freeze({
      paths: frozenPaths,
      distributions: pathDistributions(frozenPaths),
    }),
    worstCases: Object.freeze({
      largestSearch: Object.freeze({ caseId: largestSearch.caseId, wireBytes: largestSearch.wireBytes }),
      largestInspect: Object.freeze({ contractId: largestInspect.contractId, wireBytes: largestInspect.wireBytes }),
      mostRepeatedSearch: Object.freeze({
        caseId: mostRepeatedSearch.caseId,
        repeatedLeafBytes: mostRepeatedSearch.repeatedLeafBytes,
      }),
      mostRepeatedInspect: Object.freeze({
        contractId: mostRepeatedInspect.contractId,
        repeatedLeafBytes: mostRepeatedInspect.repeatedLeafBytes,
      }),
      highestDescriptiveInspectReuse: Object.freeze({
        searchCaseId: highestDescriptiveInspectReuse.searchCaseId,
        contractId: highestDescriptiveInspectReuse.contractId,
        lexicalContainment: highestDescriptiveInspectReuse.lexical.descriptive.rightContainment,
      }),
    }),
  })
}

let baselinePromise: Promise<CompactnessBaselineV1> | undefined

export function buildCompactnessBaselineV1(): Promise<CompactnessBaselineV1> {
  baselinePromise ??= buildUncached()
  return baselinePromise
}
