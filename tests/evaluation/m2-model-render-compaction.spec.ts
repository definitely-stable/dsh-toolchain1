import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { MODEL_COMPACT_SERIALIZER_POLICY } from '../../src/model/compact-response.js'
import type { PluginCheckResponse } from '../../src/protocol/index.js'
import { expandModelFacingText } from '../model/model-facing-inverse.js'
import {
  MODEL_RENDER_CLASSIFICATION,
  MODEL_RENDER_COMPACTION_SCHEMA,
  MODEL_RENDER_DECLINE_DEDUPLICATION_CEILING_BYTES,
  MODEL_RENDER_DECLINE_ENVELOPE_CEILING_BYTES,
  MODEL_RENDER_METRIC_VERSION,
  buildModelRenderCompactionMeasurementV1,
  collectModelRenderCases,
  type ModelRenderCase,
} from './m2-model-render-compaction-measurement.js'
import { nativeToolDefinitions } from './m2-model-surface-baseline.js'

const RECEIPT_URL = new URL('../../docs/evaluation/m2/model-render-compaction-v1.json', import.meta.url)

const CASES = await collectModelRenderCases()
const ALL_CASES: readonly ModelRenderCase[] = Object.freeze([...CASES.search, ...CASES.pluginCheck])

function compactRepresentation(rendered: string): string | null {
  const parsed = JSON.parse(rendered) as { representation?: unknown }
  return typeof parsed.representation === 'string' ? parsed.representation : null
}

describe('model-facing render compaction', () => {
  it('measures the frozen Search corpus and the derived plugin.check population', () => {
    // The measured population is the real frozen R1 corpus plus subjects derived from the real
    // frozen Contract Index, not the hand-written spec examples: those carry no repeated evidence
    // graph and therefore cannot show whether an evidence-interning projection pays at all.
    expect(CASES.search.length).toBeGreaterThanOrEqual(36)
    expect(CASES.pluginCheck).toHaveLength(4)
    expect(ALL_CASES.every(item => item.canonicalBytes > 0)).toBe(true)
  })

  it('round-trips every projected response back to the exact canonical Protocol v1 value', () => {
    for (const item of ALL_CASES) {
      expect(expandModelFacingText(item.rendered), item.caseId).toEqual(item.canonical)
    }
  })

  it('never emits more bytes than canonical JSON for any measured response', () => {
    for (const item of ALL_CASES) {
      expect(item.modelBytes, `${item.caseId} model bytes`).toBeLessThanOrEqual(item.canonicalBytes)
      expect(item.savedBytes, `${item.caseId} saved bytes`).toBeGreaterThanOrEqual(0)
    }
  })

  it('strictly shortens every response that repeats a canonical evidence id', () => {
    // A response with repeated evidence ids is exactly the case a projection exists for, so it must
    // improve rather than merely be protected by the canonical fallback.
    const repeated = ALL_CASES.filter(item => item.repeatedEvidenceReference)
    expect(repeated.length).toBeGreaterThan(0)
    for (const item of repeated) {
      expect(item.modelBytes, `${item.caseId} repeated-evidence bytes`).toBeLessThan(item.canonicalBytes)
    }
  })

  it('keeps failed and stale responses on canonical Protocol v1 JSON', () => {
    const nonSuccess = ALL_CASES.filter(item => item.status !== 'ok')
    for (const item of nonSuccess) {
      expect(item.rendered, item.caseId).toBe(JSON.stringify(item.canonical))
      expect(item.savedBytes, item.caseId).toBe(0)
    }
  })

  it('keeps the decision-relevant verdict, completeness and diagnostics explicit', () => {
    for (const item of CASES.pluginCheck) {
      const canonical = item.canonical as PluginCheckResponse
      const expanded = expandModelFacingText(item.rendered) as PluginCheckResponse
      if (canonical.status !== 'ok' || expanded.status !== 'ok') continue
      expect(expanded.data.verdict, item.caseId).toBe(canonical.data.verdict)
      expect(expanded.data.subjectCompleteness, item.caseId).toBe(canonical.data.subjectCompleteness)
      expect(expanded.data.scopeComplete, item.caseId).toBe(false)
      expect(expanded.data.candidateCodeExecuted, item.caseId).toBe(false)
      expect(expanded.diagnostics, item.caseId).toEqual(canonical.diagnostics)
    }

    const checkResponses = CASES.pluginCheck.map(item => item.canonical as PluginCheckResponse)
    const verdicts = checkResponses.map(response =>
      response.status === 'ok' ? response.data.verdict : 'non-success')
    // The derived population must reach the incompatible and unproven branches, because those are
    // the branches where a projection could hide a bad verdict behind a smaller payload.
    expect(verdicts).toEqual(expect.arrayContaining(['incompatible', 'unproven']))
    const withDiagnostics = checkResponses.filter(response =>
      response.status === 'ok' && response.diagnostics.length > 0)
    expect(withDiagnostics.length).toBeGreaterThan(0)
  })

  it('classifies every registered native tool and publishes only its declared representation', () => {
    const registered = nativeToolDefinitions().map(definition => definition.name)
    expect(registered.toSorted()).toEqual(Object.keys(MODEL_RENDER_CLASSIFICATION).toSorted())

    const declared = new Set(Object.values(MODEL_RENDER_CLASSIFICATION)
      .map(entry => entry.projection)
      .filter((projection): projection is string => projection !== null))
    expect(declared.size).toBe(3)

    for (const item of ALL_CASES) {
      const representation = compactRepresentation(item.rendered)
      if (representation === null) continue
      expect(declared.has(representation), `${item.caseId} representation`).toBe(true)
    }
  })

  it('declines operations whose only recoverable duplication is fixed and bounded', async () => {
    const measured = await buildModelRenderCompactionMeasurementV1()
    const declined = Object.entries(MODEL_RENDER_CLASSIFICATION)
      .filter(entry => entry[1].projection === null)
      .map(entry => entry[0])
    expect(measured.decline.tools.map(item => item.tool)).toEqual(declined.toSorted())

    for (const item of measured.decline.tools) {
      // Envelope elision is the only mechanism left once there is no evidence graph to intern. The
      // ceilings are recorded so a future operation that could actually be compacted fails here
      // instead of being silently declined.
      expect(item.repeatedStringBytes, `${item.tool} dedup ceiling`)
        .toBeLessThanOrEqual(MODEL_RENDER_DECLINE_DEDUPLICATION_CEILING_BYTES)
      expect(item.envelopeSavingBytes, `${item.tool} envelope ceiling`)
        .toBeLessThanOrEqual(MODEL_RENDER_DECLINE_ENVELOPE_CEILING_BYTES)
    }

    expect(measured.decline.deduplicationCeilingBytes).toBe(MODEL_RENDER_DECLINE_DEDUPLICATION_CEILING_BYTES)
    expect(measured.decline.envelopeCeilingBytes).toBe(MODEL_RENDER_DECLINE_ENVELOPE_CEILING_BYTES)
  })

  it('records a material exact-byte improvement on both projected populations', async () => {
    const measured = await buildModelRenderCompactionMeasurementV1()

    expect(measured.search.improved).toBeGreaterThan(0)
    expect(measured.search.regressed).toBe(0)
    expect(measured.pluginCheck.improved).toBeGreaterThan(0)
    expect(measured.pluginCheck.regressed).toBe(0)
    expect(measured.pluginCheck.totalSavedBytes).toBeGreaterThan(0)
    expect(measured.identity.serializerPolicy).toBe(MODEL_COMPACT_SERIALIZER_POLICY)
  })

  it('freezes the measured model render receipt against implementation and fixture drift', async () => {
    const receipt = JSON.parse(await readFile(RECEIPT_URL, 'utf8')) as {
      readonly schema: string
      readonly identity: { readonly metricVersion: string }
    }
    const measured = await buildModelRenderCompactionMeasurementV1()

    expect(receipt.schema).toBe(MODEL_RENDER_COMPACTION_SCHEMA)
    expect(receipt.identity.metricVersion).toBe(MODEL_RENDER_METRIC_VERSION)
    expect(receipt).toEqual(measured)
  })
})
