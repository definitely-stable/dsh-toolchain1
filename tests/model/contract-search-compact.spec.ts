import { describe, expect, it } from 'vitest'

import {
  compactContractSearchModelResponse,
  serializeContractSearchModelResponse,
} from '../../src/model/contract-search-compact.js'
import type { ContractSearchResponse, Evidence } from '../../src/protocol/index.js'
import { expandModelFacingText } from './model-facing-inverse.js'

const snapshotFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
const manifestId = 'manifest:@deepseek-ai/dsh-tools'
const typesId = 'types:@deepseek-ai/dsh-tools:lib/contracts/tool-definition.d.ts#ToolDefinition'

type ContractSearchSuccess = Extract<ContractSearchResponse, { readonly status: 'ok' }>

function evidence(id: string, source: string): Evidence {
  return {
    id,
    kind: 'type-declaration',
    strength: 'authoritative',
    source,
    contentHash: 'c'.repeat(64),
  }
}

function successResponse(
  matches: ContractSearchSuccess['data']['matches'] = [{
    id: 'package:@deepseek-ai/dsh-tools',
    kind: 'package',
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: 'package:@deepseek-ai/dsh-tools',
    availability: 'unknown',
    score: 600,
    summary: 'Installed package @deepseek-ai/dsh-tools',
    evidenceIds: [manifestId, typesId],
  }],
  evidenceItems: Evidence[] = [
    evidence(manifestId, '@deepseek-ai/dsh-tools/package.json'),
    evidence(typesId, '@deepseek-ai/dsh-tools/lib/contracts/tool-definition.d.ts'),
  ],
): ContractSearchSuccess {
  return {
    protocolVersion: '1',
    requestId: 'compact-search-test',
    snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      matches,
      evidence: evidenceItems,
    },
    diagnostics: [],
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

describe('Contract Search compact model projection', () => {
  it('interns repeated evidence ids and omits only success-envelope invariants implied by compact-v1', () => {
    const canonical = successResponse()
    const compact = compactContractSearchModelResponse(canonical)

    expect(compact).toEqual({
      representation: 'dsh-contract-search-compact-v1',
      requestId: 'compact-search-test',
      snapshotFingerprint,
      data: {
        contractIndexFingerprint,
        matches: [{
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package',
          name: '@deepseek-ai/dsh-tools',
          qualifiedName: 'package:@deepseek-ai/dsh-tools',
          availability: 'unknown',
          score: 600,
          summary: 'Installed package @deepseek-ai/dsh-tools',
          evidenceRefs: ['e0', 'e1'],
        }],
        evidenceByRef: {
          e0: evidence(manifestId, '@deepseek-ai/dsh-tools/package.json'),
          e1: evidence(typesId, '@deepseek-ai/dsh-tools/lib/contracts/tool-definition.d.ts'),
        },
      },
    })

    expect(compact).not.toHaveProperty('protocolVersion')
    expect(compact).not.toHaveProperty('status')
    expect(compact).not.toHaveProperty('diagnostics')
  })

  it('round-trips a repeated-evidence search response back to the exact canonical value', () => {
    const canonical = successResponse()
    const rendered = serializeContractSearchModelResponse(canonical)

    expect(JSON.parse(rendered)).toHaveProperty('representation', 'dsh-contract-search-compact-v1')
    expect(expandModelFacingText(rendered)).toEqual(canonical)
  })

  it('round-trips every match row without reordering or losing a match', () => {
    const matches: ContractSearchSuccess['data']['matches'] = Array.from({ length: 12 }, (_, index) => ({
      id: `method:@deepseek-ai/dsh-tools#m${index}`,
      kind: 'method' as const,
      name: `m${index}`,
      qualifiedName: `@deepseek-ai/dsh-tools.m${index}`,
      availability: 'unknown' as const,
      score: 100 - index,
      evidenceIds: [typesId, manifestId],
    }))
    const canonical = successResponse(matches)
    const rendered = serializeContractSearchModelResponse(canonical)
    const expanded = expandModelFacingText(rendered) as ContractSearchSuccess

    expect(expanded).toEqual(canonical)
    expect(expanded.data.matches.map(match => match.id))
      .toEqual(canonical.data.matches.map(match => match.id))
    expect(expanded.data.matches[0]?.evidenceIds).toEqual([typesId, manifestId])
  })

  it('never emits more bytes than canonical JSON', () => {
    for (const canonical of [
      successResponse(),
      successResponse([], []),
      successResponse([{
        id: 'package:@deepseek-ai/dsh-tools',
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: 'package:@deepseek-ai/dsh-tools',
        availability: 'unknown',
        score: 600,
        evidenceIds: [manifestId],
      }], [evidence(manifestId, 'package.json')]),
    ]) {
      const rendered = serializeContractSearchModelResponse(canonical)
      expect(utf8Bytes(rendered)).toBeLessThanOrEqual(utf8Bytes(JSON.stringify(canonical)))
      expect(expandModelFacingText(rendered)).toEqual(canonical)
    }
  })

  it('keeps a minimal response canonical when the compact envelope has no payload benefit', () => {
    const canonical = successResponse([], [])
    const canonicalJson = JSON.stringify(canonical)

    expect(serializeContractSearchModelResponse(canonical)).toBe(canonicalJson)
    expect(expandModelFacingText(canonicalJson)).toEqual(canonical)
  })

  it('declines the projection when a canonical evidence id already looks like a local ref', () => {
    const canonical = successResponse(
      [{
        id: 'package:collision',
        kind: 'package',
        name: 'collision',
        qualifiedName: 'package:collision',
        availability: 'unknown',
        score: 1,
        evidenceIds: ['e0'],
      }],
      [evidence('e0', 'collision.json')],
    )

    expect(compactContractSearchModelResponse(canonical)).toBeUndefined()
    expect(serializeContractSearchModelResponse(canonical)).toBe(JSON.stringify(canonical))
  })

  it('keeps non-empty success diagnostics explicit', () => {
    const canonical = successResponse()
    canonical.diagnostics.push({
      code: 'CONTRACT_SEARCH_TRUNCATED',
      severity: 'warning',
      domain: 'contract',
      summary: 'Synthetic warning.',
    })

    const compact = compactContractSearchModelResponse(canonical)
    expect(compact).toMatchObject({ diagnostics: canonical.diagnostics })
    expect(expandModelFacingText(serializeContractSearchModelResponse(canonical))).toEqual(canonical)
  })

  it('fails loud when a successful response references evidence absent from data.evidence', () => {
    const canonical = successResponse(undefined, [])

    expect(() => compactContractSearchModelResponse(canonical)).toThrow(/absent from data\.evidence/u)
  })

  it('fails loud on duplicate canonical evidence ids', () => {
    const item = evidence(manifestId, 'duplicate.json')
    const canonical = successResponse(undefined, [item, { ...item }])

    expect(() => compactContractSearchModelResponse(canonical)).toThrow(/duplicate evidence id/u)
  })

  it.each([
    {
      protocolVersion: '1',
      requestId: 'failed-search',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
        summary: 'Missing.',
      }],
    },
    {
      protocolVersion: '1',
      requestId: 'stale-search',
      snapshotFingerprint,
      status: 'stale',
      diagnostics: [{
        code: 'CONTRACT_INDEX_STALE',
        severity: 'error',
        domain: 'contract',
        summary: 'Stale.',
      }],
    },
  ] satisfies readonly ContractSearchResponse[])(
    'leaves non-success Protocol responses semantically unchanged: $status',
    (canonical) => {
      expect(compactContractSearchModelResponse(canonical)).toEqual(canonical)
      expect(serializeContractSearchModelResponse(canonical)).toBe(JSON.stringify(canonical))
      expect(expandModelFacingText(JSON.stringify(canonical))).toEqual(canonical)
    },
  )
})
