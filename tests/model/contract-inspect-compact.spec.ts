import { describe, expect, it } from 'vitest'

import * as compactModel from '../../src/model/contract-inspect-compact.js'
import type {
  ContractInspectResponse,
  Evidence,
} from '../../src/protocol/index.js'

const snapshotFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
const longEvidenceId = 'types:@deepseek-ai/dsh-tools:lib/contracts/tool-definition.d.ts#ToolDefinition'

type ContractInspectSuccess = Extract<ContractInspectResponse, { readonly status: 'ok' }>
type CompactProjector = (response: ContractInspectResponse) => unknown
type ModelSerializer = (response: ContractInspectResponse) => string

function compactProjector(): CompactProjector {
  const compact = (compactModel as unknown as {
    readonly compactContractInspectModelResponse?: CompactProjector
  }).compactContractInspectModelResponse
  expect(compact, 'compact model must expose compactContractInspectModelResponse').toBeTypeOf('function')
  if (compact === undefined) throw new Error('compactContractInspectModelResponse is unavailable')
  return compact
}

function modelSerializer(): ModelSerializer {
  const serialize = (compactModel as unknown as {
    readonly serializeContractInspectModelResponse?: ModelSerializer
  }).serializeContractInspectModelResponse
  expect(serialize, 'compact model must expose serializeContractInspectModelResponse').toBeTypeOf('function')
  if (serialize === undefined) throw new Error('serializeContractInspectModelResponse is unavailable')
  return serialize
}

function evidence(id: string, source: string): Evidence {
  return {
    id,
    kind: 'type-declaration',
    strength: 'authoritative',
    source,
    contentHash: id === longEvidenceId ? '1'.repeat(64) : '2'.repeat(64),
    location: `/fixture/${source}`,
  }
}

function successResponse(
  evidenceItems: Evidence[] = [evidence(longEvidenceId, '@deepseek-ai/dsh-tools/lib/contracts/tool-definition.d.ts')],
): ContractInspectSuccess {
  return {
    protocolVersion: '1',
    requestId: 'compact-test',
    snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      contract: {
        id: 'package:@deepseek-ai/dsh-tools',
        kind: 'package',
        name: '@deepseek-ai/dsh-tools',
        qualifiedName: 'package:@deepseek-ai/dsh-tools',
        availability: 'unknown',
        summary: 'Tool package declarations.',
        facts: [
          { key: 'declaration-export', value: 'ToolDefinition', evidenceIds: [longEvidenceId] },
          { key: 'declaration-export', value: 'ToolSchema', evidenceIds: [longEvidenceId] },
        ],
        evidenceIds: [longEvidenceId],
      },
      evidence: evidenceItems,
    },
    diagnostics: [],
  }
}

function minimalSuccessResponse(): ContractInspectSuccess {
  return {
    protocolVersion: '1',
    requestId: 'minimal-compact-test',
    snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint,
      contract: {
        id: 'package:@deepseek-ai/dsh',
        kind: 'package',
        name: '@deepseek-ai/dsh',
        qualifiedName: 'package:@deepseek-ai/dsh',
        availability: 'unknown',
        facts: [],
        evidenceIds: [],
      },
      evidence: [],
    },
    diagnostics: [],
  }
}

function shortEvidenceRegressionResponse(): ContractInspectSuccess {
  const shortId = 'x'
  const canonical = successResponse([evidence(shortId, 'x')])
  canonical.data.contract.evidenceIds.splice(0, canonical.data.contract.evidenceIds.length, shortId)
  canonical.data.contract.facts.splice(
    0,
    canonical.data.contract.facts.length,
    ...Array.from({ length: 80 }, (_, index) => ({
      key: `k${index}`,
      value: 'v',
      evidenceIds: [shortId] as [string],
    })),
  )
  return canonical
}

function occurrences(serialized: string, value: string): number {
  const needle = JSON.stringify(value)
  let count = 0
  let cursor = 0
  while (true) {
    const index = serialized.indexOf(needle, cursor)
    if (index < 0) return count
    count += 1
    cursor = index + needle.length
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

const nonSuccessResponses = [
  {
    protocolVersion: '1',
    requestId: 'failed-test',
    status: 'failed',
    diagnostics: [{
      code: 'CONTRACT_NOT_FOUND',
      severity: 'error',
      domain: 'contract',
      summary: 'Not found.',
    }],
  },
  {
    protocolVersion: '1',
    requestId: 'stale-test',
    snapshotFingerprint,
    status: 'stale',
    diagnostics: [{
      code: 'CONTRACT_INDEX_STALE',
      severity: 'error',
      domain: 'contract',
      summary: 'Stale.',
    }],
  },
] satisfies readonly ContractInspectResponse[]

describe('Contract Inspect compact model projection', () => {
  it('interns repeated canonical evidence ids and omits only success-envelope invariants implied by compact-v1', () => {
    const canonical = successResponse()
    const compact = compactProjector()(canonical)

    expect(compact).toEqual({
      representation: 'dsh-contract-inspect-compact-v1',
      requestId: 'compact-test',
      snapshotFingerprint,
      data: {
        contractIndexFingerprint,
        contract: {
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package',
          name: '@deepseek-ai/dsh-tools',
          qualifiedName: 'package:@deepseek-ai/dsh-tools',
          availability: 'unknown',
          summary: 'Tool package declarations.',
          facts: [
            { key: 'declaration-export', value: 'ToolDefinition', evidenceRefs: ['e0'] },
            { key: 'declaration-export', value: 'ToolSchema', evidenceRefs: ['e0'] },
          ],
          evidenceRefs: ['e0'],
        },
        evidenceByRef: {
          e0: evidence(longEvidenceId, '@deepseek-ai/dsh-tools/lib/contracts/tool-definition.d.ts'),
        },
      },
    })

    expect(occurrences(JSON.stringify(canonical), longEvidenceId)).toBe(4)
    expect(occurrences(JSON.stringify(compact), longEvidenceId)).toBe(1)
    expect(compact).not.toHaveProperty('protocolVersion')
    expect(compact).not.toHaveProperty('status')
    expect(compact).not.toHaveProperty('diagnostics')
  })

  it('keeps non-empty success diagnostics explicit even though empty diagnostics are implied', () => {
    const canonical = successResponse()
    canonical.diagnostics.push({
      code: 'COMPACT_TEST_WARNING',
      severity: 'warning',
      domain: 'contract',
      summary: 'Synthetic warning.',
    })

    expect(compactProjector()(canonical)).toMatchObject({
      representation: 'dsh-contract-inspect-compact-v1',
      diagnostics: canonical.diagnostics,
    })
  })

  it('assigns deterministic local refs from canonical evidence-array order, not lexical evidence-id order', () => {
    const evidenceB = evidence('types:z-last', 'z-last.d.ts')
    const evidenceA = evidence('types:a-first', 'a-first.d.ts')
    const canonical = successResponse([evidenceB, evidenceA])
    canonical.data.contract.evidenceIds.splice(0, canonical.data.contract.evidenceIds.length, evidenceA.id, evidenceB.id)
    canonical.data.contract.facts.splice(
      0,
      canonical.data.contract.facts.length,
      { key: 'pair', value: 'ordered', evidenceIds: [evidenceB.id, evidenceA.id] },
    )

    const compact = compactProjector()(canonical) as {
      readonly data: {
        readonly contract: {
          readonly evidenceRefs: readonly string[]
          readonly facts: readonly { readonly evidenceRefs: readonly string[] }[]
        }
        readonly evidenceByRef: Readonly<Record<string, Evidence>>
      }
    }

    expect(Object.keys(compact.data.evidenceByRef)).toEqual(['e0', 'e1'])
    expect(compact.data.evidenceByRef.e0).toEqual(evidenceB)
    expect(compact.data.evidenceByRef.e1).toEqual(evidenceA)
    expect(compact.data.contract.evidenceRefs).toEqual(['e1', 'e0'])
    expect(compact.data.contract.facts[0]?.evidenceRefs).toEqual(['e0', 'e1'])
  })

  it('serializes the compact projection only when its exact UTF-8 payload is smaller', () => {
    const canonical = successResponse()
    const canonicalJson = JSON.stringify(canonical)
    const compact = compactProjector()(canonical)
    const compactJson = JSON.stringify(compact)

    expect(utf8Bytes(compactJson)).toBeLessThan(utf8Bytes(canonicalJson))
    expect(modelSerializer()(canonical)).toBe(compactJson)
  })

  it('makes the minimal successful envelope smaller without hiding variable semantics', () => {
    const canonical = minimalSuccessResponse()
    const canonicalJson = JSON.stringify(canonical)
    const compactJson = JSON.stringify(compactProjector()(canonical))

    expect(utf8Bytes(compactJson)).toBeLessThan(utf8Bytes(canonicalJson))
    expect(modelSerializer()(canonical)).toBe(compactJson)
  })

  it('falls back to canonical JSON when pathological short evidence refs would regress wire bytes', () => {
    const canonical = shortEvidenceRegressionResponse()
    const canonicalJson = JSON.stringify(canonical)
    const compactJson = JSON.stringify(compactProjector()(canonical))

    expect(utf8Bytes(compactJson)).toBeGreaterThan(utf8Bytes(canonicalJson))
    expect(modelSerializer()(canonical)).toBe(canonicalJson)
  })

  it('fails loud when a successful canonical response references evidence absent from data.evidence', () => {
    const canonical = successResponse([])

    expect(() => compactProjector()(canonical)).toThrow(/evidence|provenance|reference/i)
  })

  it('fails loud when canonical data.evidence contains duplicate evidence ids', () => {
    const item = evidence(longEvidenceId, 'duplicate.d.ts')
    const canonical = successResponse([item, { ...item }])

    expect(() => compactProjector()(canonical)).toThrow(/duplicate|evidence/i)
  })

  it.each(nonSuccessResponses)('leaves non-success Protocol responses semantically unchanged: $status', (canonical) => {
    const projected = compactProjector()(canonical)

    expect(projected).toEqual(canonical)
    expect(projected).not.toHaveProperty('representation')
    expect(modelSerializer()(canonical)).toBe(JSON.stringify(canonical))
  })
})
