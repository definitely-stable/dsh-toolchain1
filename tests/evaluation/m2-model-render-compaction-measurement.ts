import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'

import { checkPluginResponse, searchContractsResponse } from '../../src/kernel/index.js'
import { MODEL_COMPACT_SERIALIZER_POLICY } from '../../src/model/compact-response.js'
import { CONTRACT_INSPECT_COMPACT_REPRESENTATION } from '../../src/model/contract-inspect-compact.js'
import {
  CONTRACT_SEARCH_COMPACT_REPRESENTATION,
  serializeContractSearchModelResponse,
} from '../../src/model/contract-search-compact.js'
import {
  PLUGIN_CHECK_COMPACT_REPRESENTATION,
  serializePluginCheckModelResponse,
} from '../../src/model/plugin-check-compact.js'
import type { ContractIndex } from '../../src/model/contract.js'
import type { AcquiredPluginRequirement, AcquiredPluginSubject } from '../../src/model/plugin.js'
import type { ContractSearchResponse, Evidence, PluginCheckResponse } from '../../src/protocol/index.js'
import {
  measureWireResponse,
  summarizeDistribution,
  type DistributionSummary,
} from './m2-compactness-metrics.js'
import { compactnessCorpusFingerprint } from './m2-compactness-baseline.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import {
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  M2_RETRIEVAL_TARGET,
  createFrozenM2RetrievalIndex,
} from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

export const MODEL_RENDER_COMPACTION_SCHEMA = 'dsh-model-render-compaction-measurement-v1' as const
export const MODEL_RENDER_METRIC_VERSION = 'dsh-model-render-compaction-v1' as const

/**
 * A projection is accepted only when it can shorten a model-facing payload without losing a
 * decision-relevant field. These ceilings bound the alternative "elide the success envelope only"
 * mechanism for operations that have no repeated evidence graph to intern: they are measured, not
 * assumed, and a declined operation that exceeded either bound would fail its gate and force the
 * decline to be revisited instead of being recorded.
 */
export const MODEL_RENDER_DECLINE_DEDUPLICATION_CEILING_BYTES = 256
export const MODEL_RENDER_DECLINE_ENVELOPE_CEILING_BYTES = 19

const FIXTURE_VERSION = 'rc2-web-v1'
const DERIVED_CHECK_POPULATION = 'derived-from-frozen-contract-index-v1'
const SEARCH_REQUEST_ID = '00000000-0000-4000-8000-000000000011'
const CHECK_REQUEST_ID = '00000000-0000-4000-8000-000000000012'
const PROFILE = 'web'
const SUBJECT_EVIDENCE_ID = 'plugin:derived-manifest'

/**
 * How many Host peer requirements each derived plugin.check subject declares.
 *
 * A real DSH plugin declares a bounded handful of Host peers, so a subject that required every
 * package in the exact target would measure a pathological multi-hundred-kilobyte response and
 * publish a saving that describes that construction rather than the product. Five versioned package
 * contracts, chosen deterministically by name from the frozen index, keep the measured responses in
 * the same order of magnitude as a real `plugin.check` result while still repeating the subject
 * manifest evidence across rows.
 */
const REQUIREMENT_SAMPLE_SIZE = 5

export type ModelRenderResponse = ContractSearchResponse | PluginCheckResponse

export interface ModelRenderProjectionEntry {
  readonly projection: string
}

export interface ModelRenderDeclineEntry {
  readonly projection: null
  /** Why this operation stays on canonical Protocol v1 JSON. */
  readonly reason: 'no-scaling-evidence-graph'
}

export type ModelRenderClassificationEntry = ModelRenderProjectionEntry | ModelRenderDeclineEntry

/**
 * Which model-facing representation each native Toolchain operation uses.
 *
 * This registry is the decline rule in executable form: an operation either names the projection
 * that shortens its model-facing text or records that it deliberately stays canonical. A newly
 * added operation cannot reach the model unclassified, because the coverage gate compares this map
 * against the registered tool definitions.
 */
export const MODEL_RENDER_CLASSIFICATION: Readonly<Record<string, ModelRenderClassificationEntry>> =
  Object.freeze({
    toolchain_target_resolve: Object.freeze({ projection: null, reason: 'no-scaling-evidence-graph' }),
    toolchain_contract_search: Object.freeze({ projection: CONTRACT_SEARCH_COMPACT_REPRESENTATION }),
    toolchain_contract_inspect: Object.freeze({ projection: CONTRACT_INSPECT_COMPACT_REPRESENTATION }),
    toolchain_plugin_check: Object.freeze({ projection: PLUGIN_CHECK_COMPACT_REPRESENTATION }),
    toolchain_plugin_verify: Object.freeze({ projection: null, reason: 'no-scaling-evidence-graph' }),
    toolchain_plugin_verify_start: Object.freeze({ projection: null, reason: 'no-scaling-evidence-graph' }),
    toolchain_operation_get: Object.freeze({ projection: null, reason: 'no-scaling-evidence-graph' }),
    toolchain_operation_cancel: Object.freeze({ projection: null, reason: 'no-scaling-evidence-graph' }),
  })

/** Canonical Protocol v1 example each declined operation is measured on, and its prospective id. */
const DECLINED_EXAMPLE_BY_TOOL: Readonly<Record<string, { readonly example: string; readonly representation: string }>> =
  Object.freeze({
    toolchain_target_resolve: Object.freeze({
      example: 'target-resolved.json',
      representation: 'dsh-target-resolve-compact-v1',
    }),
    toolchain_plugin_verify: Object.freeze({
      example: 'verification-passed.json',
      representation: 'dsh-plugin-verify-compact-v1',
    }),
    toolchain_plugin_verify_start: Object.freeze({
      example: 'plugin-verify-operation-running.json',
      representation: 'dsh-plugin-verify-start-compact-v1',
    }),
    toolchain_operation_get: Object.freeze({
      example: 'plugin-verify-operation-succeeded.json',
      representation: 'dsh-operation-get-compact-v1',
    }),
    toolchain_operation_cancel: Object.freeze({
      example: 'plugin-verify-operation-running.json',
      representation: 'dsh-operation-cancel-compact-v1',
    }),
  })

export interface ModelRenderCase {
  readonly caseId: string
  readonly status: ModelRenderResponse['status']
  /** Canonical Protocol v1 value the frontends execute with; also the renderer's input. */
  readonly canonical: ModelRenderResponse
  /** Exact model-facing text the frontends emit, whether projected or canonical. */
  readonly rendered: string
  readonly canonicalBytes: number
  readonly modelBytes: number
  readonly savedBytes: number
  readonly savingRate: number
  /**
   * Does this canonical response repeat a canonical evidence id? Only such a response gives an
   * evidence-interning projection anything to remove, so only such a response may be required to
   * improve strictly rather than merely not regress.
   */
  readonly repeatedEvidenceReference: boolean
}

export interface ModelRenderPopulationMeasurement {
  readonly population: string
  readonly cases: number
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
  readonly worstCases: {
    readonly largestCanonical: { readonly caseId: string; readonly bytes: number }
    readonly largestModel: { readonly caseId: string; readonly bytes: number }
    readonly largestSaving: { readonly caseId: string; readonly bytes: number }
  }
}

export interface ModelRenderCompactionMeasurementV1 {
  readonly schema: typeof MODEL_RENDER_COMPACTION_SCHEMA
  readonly identity: {
    readonly fixtureVersion: string
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly searchCorpusFingerprint: string
    readonly checkPopulation: string
    readonly serializerPolicy: typeof MODEL_COMPACT_SERIALIZER_POLICY
    readonly metricVersion: typeof MODEL_RENDER_METRIC_VERSION
    readonly projections: readonly { readonly tool: string; readonly representation: string }[]
  }
  readonly search: ModelRenderPopulationMeasurement
  readonly pluginCheck: ModelRenderPopulationMeasurement
  readonly decline: {
    readonly deduplicationCeilingBytes: number
    readonly envelopeCeilingBytes: number
    readonly tools: readonly ModelRenderEvidenceSummary[]
  }
}

interface ModelRenderEvidenceSummary {
  readonly tool: string
  readonly example: string
  readonly representation: string
  readonly canonicalBytes: number
  /** Upper bound on bytes recoverable by interning repeated string scalars, ignoring refs. */
  readonly repeatedStringBytes: number
  /** Bytes an envelope-only projection would save once it carries its own representation id. */
  readonly envelopeSavingBytes: number
}

interface DerivedCheckCase {
  readonly caseId: string
  readonly subject: AcquiredPluginSubject
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/**
 * Upper bound on the bytes losslessly recoverable by interning repeated string scalars.
 *
 * This walks the whole response rather than only `data` leaves on purpose: the duplication these
 * declined operations actually contain is a fingerprint repeated between the success envelope and
 * the payload, so a data-leaf metric would report zero and understate the only mechanism available
 * to them. The bound ignores the cost of the reference table and refs a real projection would pay,
 * which makes it deliberately generous: an operation that stays under the decline ceiling even by
 * this overestimate cannot be worth a permanent second representation identity.
 */
function repeatedStringUpperBoundBytes(value: unknown): number {
  const occurrences = new Map<string, { readonly bytes: number; count: number }>()
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      const current = occurrences.get(node)
      if (current === undefined) {
        occurrences.set(node, { bytes: utf8Bytes(JSON.stringify(node)), count: 1 })
      } else {
        current.count += 1
      }
      return
    }
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    for (const child of Object.values(node as Record<string, unknown>)) visit(child)
  }
  visit(value)

  let repeated = 0
  for (const entry of occurrences.values()) {
    if (entry.count > 1) repeated += entry.bytes * (entry.count - 1)
  }
  return repeated
}

function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function countEvidenceIdOccurrences(response: ModelRenderResponse): Map<string, number> {
  const counts = new Map<string, number>()
  const count = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  if (response.status !== 'ok') return counts
  if ('matches' in response.data) {
    for (const match of response.data.matches) {
      for (const id of match.evidenceIds) count(id)
    }
  } else {
    for (const requirement of response.data.requirements) {
      for (const id of requirement.evidenceIds) count(id)
    }
  }
  for (const evidence of response.data.evidence) count(evidence.id)
  return counts
}

function hasRepeatedEvidenceReference(response: ModelRenderResponse): boolean {
  for (const occurrences of countEvidenceIdOccurrences(response).values()) {
    if (occurrences > 1) return true
  }
  return false
}

function modelRenderCase(
  caseId: string,
  canonical: ModelRenderResponse,
  rendered: string,
): ModelRenderCase {
  const canonicalBytes = measureWireResponse(canonical).wireBytes
  const modelBytes = utf8Bytes(rendered)
  const savedBytes = canonicalBytes - modelBytes
  return Object.freeze({
    caseId,
    status: canonical.status,
    canonical,
    rendered,
    canonicalBytes,
    modelBytes,
    savedBytes,
    savingRate: canonicalBytes === 0 ? 0 : roundRate(savedBytes / canonicalBytes),
    repeatedEvidenceReference: hasRepeatedEvidenceReference(canonical),
  })
}

function largestBy(
  cases: readonly ModelRenderCase[],
  selector: (item: ModelRenderCase) => number,
): ModelRenderCase {
  const sorted = cases.toSorted((left, right) => {
    const delta = selector(right) - selector(left)
    return delta !== 0 ? delta : compareCodePoints(left.caseId, right.caseId)
  })
  const item = sorted[0]
  if (item === undefined) throw new Error('Model render measurement requires at least one case')
  return item
}

function summarizePopulation(
  population: string,
  cases: readonly ModelRenderCase[],
): ModelRenderPopulationMeasurement {
  if (cases.length === 0) throw new Error(`Model render population ${population} must not be empty`)
  const totalCanonicalBytes = cases.reduce((total, item) => total + item.canonicalBytes, 0)
  const totalModelBytes = cases.reduce((total, item) => total + item.modelBytes, 0)
  const totalSavedBytes = totalCanonicalBytes - totalModelBytes
  const largestCanonical = largestBy(cases, item => item.canonicalBytes)
  const largestModel = largestBy(cases, item => item.modelBytes)
  const largestSaving = largestBy(cases, item => item.savedBytes)

  return Object.freeze({
    population,
    cases: cases.length,
    improved: cases.filter(item => item.savedBytes > 0).length,
    unchanged: cases.filter(item => item.savedBytes === 0).length,
    regressed: cases.filter(item => item.savedBytes < 0).length,
    totalCanonicalBytes,
    totalModelBytes,
    totalSavedBytes,
    aggregateSavingRate: roundRate(totalSavedBytes / totalCanonicalBytes),
    canonicalBytes: summarizeDistribution(cases.map(item => item.canonicalBytes)),
    modelBytes: summarizeDistribution(cases.map(item => item.modelBytes)),
    savedBytes: summarizeDistribution(cases.map(item => item.savedBytes)),
    savingRate: summarizeDistribution(cases.map(item => item.savingRate)),
    worstCases: Object.freeze({
      largestCanonical: Object.freeze({ caseId: largestCanonical.caseId, bytes: largestCanonical.canonicalBytes }),
      largestModel: Object.freeze({ caseId: largestModel.caseId, bytes: largestModel.modelBytes }),
      largestSaving: Object.freeze({ caseId: largestSaving.caseId, bytes: largestSaving.savedBytes }),
    }),
  })
}

function derivedSubjectEvidence(): readonly Evidence[] {
  return Object.freeze([Object.freeze({
    id: SUBJECT_EVIDENCE_ID,
    kind: 'manifest' as const,
    strength: 'authoritative' as const,
    source: 'derived-candidate/package.json',
    contentHash: 'a'.repeat(64),
  })])
}

/**
 * One `host-peer-required` row per package contract that exposes an exact `version` fact.
 *
 * The frozen fixture is a real DSH target and Contract Index, but it contains no plugin workspace,
 * so the plugin.check population is derived from that index instead: each requirement names a
 * package the exact target really exposes, and its range decides which real compatibility branch the
 * kernel takes. Two or more such rows also guarantee the response repeats the subject manifest
 * evidence id across rows, which is precisely the duplication an evidence-interning projection
 * removes — a population of one requirement could not demonstrate that.
 */
function packageRequirements(
  index: ContractIndex,
  range: (version: string) => string,
): readonly AcquiredPluginRequirement[] {
  const requirements: AcquiredPluginRequirement[] = []
  for (const contract of index.contracts) {
    if (contract.kind !== 'package') continue
    const version = contract.facts.find(fact => fact.key === 'version' && fact.value.length > 0)?.value
    if (version === undefined) continue
    requirements.push(Object.freeze({
      packageName: contract.name,
      range: range(version),
      relationship: 'host-peer-required' as const,
    }))
  }
  const sampled = requirements
    .toSorted((left, right) => compareCodePoints(left.packageName, right.packageName))
    .slice(0, REQUIREMENT_SAMPLE_SIZE)
  if (sampled.length < 2) {
    throw new Error('Derived plugin.check population requires at least two versioned package contracts')
  }
  return Object.freeze(sampled)
}

function derivedSubject(
  completeness: AcquiredPluginSubject['completeness'],
  requirements: readonly AcquiredPluginRequirement[],
): AcquiredPluginSubject {
  return Object.freeze({
    completeness,
    packageName: 'dsh-toolchain-derived-candidate',
    packageVersion: '1.0.0',
    bundlePatchHash: 'b'.repeat(64),
    requirements,
    evidence: derivedSubjectEvidence(),
    diagnostics: [],
  })
}

function derivedCheckPopulation(index: ContractIndex): readonly DerivedCheckCase[] {
  const satisfied = packageRequirements(index, version => version)
  const mismatch = packageRequirements(index, () => '^999.0.0')
  return Object.freeze([
    Object.freeze({ caseId: 'satisfied-all-packages', subject: derivedSubject('complete', satisfied) }),
    Object.freeze({ caseId: 'mismatch-all-packages', subject: derivedSubject('complete', mismatch) }),
    Object.freeze({ caseId: 'partial-subject', subject: derivedSubject('partial', satisfied.slice(0, 3)) }),
    Object.freeze({ caseId: 'empty-requirements', subject: derivedSubject('complete', []) }),
  ])
}

async function collectSearchCases(
  harness: Awaited<ReturnType<typeof createFrozenM2KernelHarness>>,
): Promise<readonly ModelRenderCase[]> {
  const cases: ModelRenderCase[] = []
  for (const task of M2_RETRIEVAL_R1) {
    const canonical = await searchContractsResponse(
      harness.kernel,
      { target: { profile: PROFILE }, query: task.query },
      SEARCH_REQUEST_ID,
    )
    cases.push(modelRenderCase(task.id, canonical, serializeContractSearchModelResponse(canonical)))
  }
  return Object.freeze(cases)
}

async function collectPluginCheckCases(
  harness: Awaited<ReturnType<typeof createFrozenM2KernelHarness>>,
  index: ContractIndex,
): Promise<readonly ModelRenderCase[]> {
  const cases: ModelRenderCase[] = []
  for (const derived of derivedCheckPopulation(index)) {
    harness.setPluginSubject(derived.subject)
    const canonical = await checkPluginResponse(
      harness.kernel,
      { target: { profile: PROFILE }, subject: { kind: 'directory', path: '/derived-candidate' } },
      CHECK_REQUEST_ID,
    )
    cases.push(modelRenderCase(derived.caseId, canonical, serializePluginCheckModelResponse(canonical)))
  }
  return Object.freeze(cases)
}

/**
 * Every measured case behind both populations, exposed so parity gates can expand the exact
 * model-facing text the receipt only summarizes.
 */
export async function collectModelRenderCases(): Promise<{
  readonly search: readonly ModelRenderCase[]
  readonly pluginCheck: readonly ModelRenderCase[]
}> {
  const index = await createFrozenM2RetrievalIndex()
  if (index.contracts.length !== M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount) {
    throw new Error('Frozen model render population no longer matches its fixture manifest')
  }
  const harness = await createFrozenM2KernelHarness()
  return Object.freeze({
    search: await collectSearchCases(harness),
    pluginCheck: await collectPluginCheckCases(harness, index),
  })
}

function declinedExamplePath(example: string): URL {
  return new URL(`../../spec/examples/v1/${example}`, import.meta.url)
}

function measureDeclineEvidence(): readonly ModelRenderEvidenceSummary[] {
  const summaries: ModelRenderEvidenceSummary[] = []
  for (const [tool, config] of Object.entries(DECLINED_EXAMPLE_BY_TOOL)) {
    const canonical = JSON.parse(readFileSync(declinedExamplePath(config.example), 'utf8')) as Record<string, unknown>
    const canonicalJson = JSON.stringify(canonical)
    const canonicalBytes = utf8Bytes(canonicalJson)

    // The only lossless mechanism available without an evidence graph: drop the success envelope
    // and add a representation identity so a reader can reconstruct what was elided.
    const elided: Record<string, unknown> = { representation: config.representation, ...canonical }
    delete elided.protocolVersion
    delete elided.status
    delete elided.diagnostics
    const envelopeJson = JSON.stringify(elided)

    summaries.push(Object.freeze({
      tool,
      example: config.example,
      representation: config.representation,
      canonicalBytes,
      repeatedStringBytes: repeatedStringUpperBoundBytes(canonical),
      envelopeSavingBytes: canonicalBytes - utf8Bytes(envelopeJson),
    }))
  }
  return Object.freeze(summaries.toSorted((left, right) => compareCodePoints(left.tool, right.tool)))
}

export async function buildModelRenderCompactionMeasurementV1(): Promise<ModelRenderCompactionMeasurementV1> {
  if (M2_RETRIEVAL_FIXTURE_MANIFEST.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(`Model render measurement fixture drift: ${M2_RETRIEVAL_FIXTURE_MANIFEST.fixtureVersion}`)
  }

  const cases = await collectModelRenderCases()
  const declineTools = measureDeclineEvidence()
  const projections = Object.entries(MODEL_RENDER_CLASSIFICATION)
    .filter((entry): entry is [string, ModelRenderProjectionEntry] => entry[1].projection !== null)
    .map(([tool, entry]) => Object.freeze({ tool, representation: entry.projection }))
    .toSorted((left, right) => compareCodePoints(left.tool, right.tool))

  return Object.freeze({
    schema: MODEL_RENDER_COMPACTION_SCHEMA,
    identity: Object.freeze({
      fixtureVersion: FIXTURE_VERSION,
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
      searchCorpusFingerprint: compactnessCorpusFingerprint(),
      checkPopulation: DERIVED_CHECK_POPULATION,
      serializerPolicy: MODEL_COMPACT_SERIALIZER_POLICY,
      metricVersion: MODEL_RENDER_METRIC_VERSION,
      projections: Object.freeze(projections),
    }),
    search: summarizePopulation('contract.search', cases.search),
    pluginCheck: summarizePopulation('plugin.check', cases.pluginCheck),
    decline: Object.freeze({
      deduplicationCeilingBytes: MODEL_RENDER_DECLINE_DEDUPLICATION_CEILING_BYTES,
      envelopeCeilingBytes: MODEL_RENDER_DECLINE_ENVELOPE_CEILING_BYTES,
      tools: declineTools,
    }),
  })
}
