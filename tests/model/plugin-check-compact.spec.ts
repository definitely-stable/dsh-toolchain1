import { describe, expect, it } from 'vitest'

import {
  compactPluginCheckModelResponse,
  serializePluginCheckModelResponse,
} from '../../src/model/plugin-check-compact.js'
import type { Evidence, PluginCheckResponse } from '../../src/protocol/index.js'
import { expandModelFacingText } from './model-facing-inverse.js'

const snapshotFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
const cordisEvidenceId = 'manifest:@deepseek-ai/cordis'
const pluginEvidenceId = 'plugin:manifest'

type PluginCheckSuccess = Extract<PluginCheckResponse, { readonly status: 'ok' }>

function evidence(id: string, source: string): Evidence {
  return {
    id,
    kind: 'manifest',
    strength: 'authoritative',
    source,
    contentHash: 'd'.repeat(64),
  }
}

function successResponse(overrides: Partial<PluginCheckSuccess['data']> = {}): PluginCheckSuccess {
  return {
    protocolVersion: '1',
    requestId: 'compact-check-test',
    snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      subjectFingerprint: `dsh-plugin-subject-v1:${'e'.repeat(64)}`,
      subjectCompleteness: 'complete',
      ruleset: 'plugin-static-alpha-v1',
      scopeComplete: false,
      verdict: 'incompatible',
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^5.0.0',
        relationship: 'host-peer-required',
        status: 'version-mismatch',
        targetVersion: '4.0.2',
        evidenceIds: [cordisEvidenceId, pluginEvidenceId],
      }],
      evidence: [
        evidence(cordisEvidenceId, '@deepseek-ai/cordis/package.json'),
        evidence(pluginEvidenceId, 'package.json'),
      ],
      candidateCodeExecuted: false,
      ...overrides,
    },
    diagnostics: [],
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

describe('Plugin Check compact model projection', () => {
  it('interns requirement evidence ids while keeping decision-relevant fields explicit', () => {
    const canonical = successResponse()
    const compact = compactPluginCheckModelResponse(canonical)

    expect(compact).toEqual({
      representation: 'dsh-plugin-check-compact-v1',
      requestId: 'compact-check-test',
      snapshotFingerprint,
      data: {
        contractIndexFingerprint,
        subjectFingerprint: `dsh-plugin-subject-v1:${'e'.repeat(64)}`,
        subjectCompleteness: 'complete',
        ruleset: 'plugin-static-alpha-v1',
        scopeComplete: false,
        verdict: 'incompatible',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '^5.0.0',
          relationship: 'host-peer-required',
          status: 'version-mismatch',
          targetVersion: '4.0.2',
          evidenceRefs: ['e0', 'e1'],
        }],
        evidenceByRef: {
          e0: evidence(cordisEvidenceId, '@deepseek-ai/cordis/package.json'),
          e1: evidence(pluginEvidenceId, 'package.json'),
        },
        candidateCodeExecuted: false,
      },
    })

    expect(compact).not.toHaveProperty('protocolVersion')
    expect(compact).not.toHaveProperty('status')
    expect(compact).not.toHaveProperty('diagnostics')
  })

  it('round-trips a requirement-bearing check response back to the exact canonical value', () => {
    const canonical = successResponse()
    const rendered = serializePluginCheckModelResponse(canonical)

    expect(JSON.parse(rendered)).toHaveProperty('representation', 'dsh-plugin-check-compact-v1')
    expect(expandModelFacingText(rendered)).toEqual(canonical)
  })

  it('keeps an unproven verdict explicit and never lets it look like a pass', () => {
    const canonical = successResponse({
      verdict: 'unproven',
      subjectCompleteness: 'partial',
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^4.0.0',
        relationship: 'host-peer-required',
        status: 'unproven',
        evidenceIds: [cordisEvidenceId],
      }],
    })

    const expanded = expandModelFacingText(serializePluginCheckModelResponse(canonical)) as PluginCheckSuccess
    expect(expanded).toEqual(canonical)
    expect(expanded.data.verdict).toBe('unproven')
    expect(expanded.data.subjectCompleteness).toBe('partial')
  })

  it('round-trips a response with no subject fingerprint and no requirements', () => {
    const base = successResponse({
      subjectCompleteness: 'invalid',
      verdict: 'unproven',
      requirements: [],
      evidence: [],
    })
    // The fingerprint is optional in Protocol v1, so the absent case must round-trip as an absent
    // property rather than as an explicit `undefined`.
    const { subjectFingerprint: _omittedSubjectFingerprint, ...data } = base.data
    const canonical: PluginCheckSuccess = { ...base, data }

    const rendered = serializePluginCheckModelResponse(canonical)
    expect(expandModelFacingText(rendered)).toEqual(canonical)
  })

  it('never emits more bytes than canonical JSON', () => {
    const canonical = successResponse()
    const rendered = serializePluginCheckModelResponse(canonical)

    expect(utf8Bytes(rendered)).toBeLessThanOrEqual(utf8Bytes(JSON.stringify(canonical)))
  })

  it('emits the compact envelope for a minimal response, where the envelope alone is strictly smaller', () => {
    // Plugin Check is the one operation whose envelope elision pays for itself without any
    // evidence payload: removing protocolVersion/status/empty diagnostics costs 53 bytes and the
    // representation field plus the evidenceByRef rename costs 52. That one byte is the whole
    // margin, so this test pins the arithmetic rather than assuming a minimal response falls back.
    const canonical = successResponse({
      verdict: 'compatible-in-scope',
      requirements: [],
      evidence: [],
    })
    const rendered = serializePluginCheckModelResponse(canonical)

    expect(utf8Bytes(rendered)).toBe(utf8Bytes(JSON.stringify(canonical)) - 1)
    expect(JSON.parse(rendered)).toHaveProperty('representation', 'dsh-plugin-check-compact-v1')
    expect(expandModelFacingText(rendered)).toEqual(canonical)
  })

  it('falls back to canonical JSON when short evidence ids would make the projection larger', () => {
    // A short canonical id plus the local-ref key costs more than the reference saves, so the
    // serializer must decline. This is the guard that keeps "never larger than canonical" true
    // for adversarial payload shapes rather than only for the fixtures we happened to measure.
    const shortId = 'x'
    const canonical = successResponse({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^5.0.0',
        relationship: 'host-peer-required',
        status: 'missing',
        evidenceIds: [shortId],
      }],
      evidence: [evidence(shortId, 'x')],
    })
    const canonicalJson = JSON.stringify(canonical)

    expect(utf8Bytes(JSON.stringify(compactPluginCheckModelResponse(canonical)) as string))
      .toBeGreaterThan(utf8Bytes(canonicalJson))
    expect(serializePluginCheckModelResponse(canonical)).toBe(canonicalJson)
    expect(expandModelFacingText(canonicalJson)).toEqual(canonical)
  })

  it('declines the projection when a canonical evidence id already looks like a local ref', () => {
    const canonical = successResponse({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^5.0.0',
        relationship: 'host-peer-required',
        status: 'missing',
        evidenceIds: ['e0'],
      }],
      evidence: [evidence('e0', 'collision.json')],
    })

    expect(compactPluginCheckModelResponse(canonical)).toBeUndefined()
    expect(serializePluginCheckModelResponse(canonical)).toBe(JSON.stringify(canonical))
  })

  it('keeps non-empty success diagnostics explicit', () => {
    const canonical = successResponse()
    canonical.diagnostics.push({
      code: 'PLUGIN_DSH_VERSION_MISMATCH',
      severity: 'error',
      domain: 'plugin',
      summary: 'Synthetic mismatch.',
    })

    expect(compactPluginCheckModelResponse(canonical))
      .toMatchObject({ diagnostics: canonical.diagnostics })
    expect(expandModelFacingText(serializePluginCheckModelResponse(canonical))).toEqual(canonical)
  })

  it('fails loud when a requirement references evidence absent from data.evidence', () => {
    const canonical = successResponse({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^5.0.0',
        relationship: 'host-peer-required',
        status: 'missing',
        evidenceIds: ['manifest:not-collected'],
      }],
      evidence: [],
    })

    expect(() => compactPluginCheckModelResponse(canonical)).toThrow(/absent from data\.evidence/u)
  })

  it('fails loud on duplicate canonical evidence ids', () => {
    const item = evidence(cordisEvidenceId, 'duplicate.json')
    const canonical = successResponse({ evidence: [item, { ...item }] })

    expect(() => compactPluginCheckModelResponse(canonical)).toThrow(/duplicate evidence id/u)
  })

  it.each([
    {
      protocolVersion: '1',
      requestId: 'failed-check',
      status: 'failed',
      diagnostics: [{
        code: 'PLUGIN_MANIFEST_READ_FAILED',
        severity: 'error',
        domain: 'plugin',
        summary: 'Unreadable.',
      }],
    },
    {
      protocolVersion: '1',
      requestId: 'stale-check',
      snapshotFingerprint,
      status: 'stale',
      diagnostics: [{
        code: 'CONTRACT_INDEX_STALE',
        severity: 'error',
        domain: 'contract',
        summary: 'Stale.',
      }],
    },
  ] satisfies readonly PluginCheckResponse[])(
    'leaves non-success Protocol responses semantically unchanged: $status',
    (canonical) => {
      expect(compactPluginCheckModelResponse(canonical)).toEqual(canonical)
      expect(serializePluginCheckModelResponse(canonical)).toBe(JSON.stringify(canonical))
      expect(expandModelFacingText(JSON.stringify(canonical))).toEqual(canonical)
    },
  )
})
