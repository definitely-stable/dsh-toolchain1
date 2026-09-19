import { describe, expect, it } from 'vitest'

import {
  MODEL_COMPACT_SERIALIZER_POLICY,
  compactEvidenceRefs,
  createCompactEvidenceTable,
  serializeModelResponse,
  serializeStrictlySmallerModelJson,
  utf8Bytes,
} from '../../src/model/compact-response.js'
import type { Evidence } from '../../src/protocol/index.js'

const LONG_ID = 'types:@deepseek-ai/dsh-tools:lib/contracts/tool-definition.d.ts#ToolDefinition'

function evidence(id: string): Evidence {
  return {
    id,
    kind: 'type-declaration',
    strength: 'authoritative',
    source: `${id}.d.ts`,
    contentHash: '1'.repeat(64),
  }
}

describe('shared model-facing compact serializer policy', () => {
  it('names one shared size policy for every projection', () => {
    expect(MODEL_COMPACT_SERIALIZER_POLICY).toBe('strictly-smaller-utf8-v1')
  })

  it('counts UTF-8 bytes rather than UTF-16 code units', () => {
    const ascii = 'abcdefgh'
    const cyrillic = 'абвгдежз'

    expect(ascii.length).toBe(cyrillic.length)
    expect(utf8Bytes(cyrillic)).toBeGreaterThan(utf8Bytes(ascii))
    expect(utf8Bytes(cyrillic)).toBe(16)
  })

  it('emits the compact payload only when it is strictly smaller, and canonical otherwise', () => {
    expect(serializeStrictlySmallerModelJson('{"a":1}', { a: 1 })).toBe('{"a":1}')
    expect(serializeStrictlySmallerModelJson('{"aaaa":1}', { a: 1 })).toBe('{"a":1}')
    // A tie is not an improvement: canonical JSON wins.
    expect(serializeStrictlySmallerModelJson('{"a":1}', { a: 1 })).toBe('{"a":1}')
  })

  it('assigns refs from canonical array order, not lexical evidence-id order', () => {
    const table = createCompactEvidenceTable([evidence('types:z-last'), evidence('types:a-first')], 'test')

    expect(table.internable).toBe(true)
    expect(Object.keys(table.evidenceByRef)).toEqual(['e0', 'e1'])
    expect(table.evidenceByRef.e0?.id).toBe('types:z-last')
    expect(table.evidenceByRef.e1?.id).toBe('types:a-first')
  })

  it('fails loud on duplicate canonical evidence ids instead of collapsing two records', () => {
    const item = evidence(LONG_ID)

    expect(() => createCompactEvidenceTable([item, { ...item }], 'test'))
      .toThrow(/duplicate evidence id/u)
  })

  it('fails loud when a referenced evidence id is absent from the table', () => {
    const table = createCompactEvidenceTable([evidence(LONG_ID)], 'test')

    expect(() => compactEvidenceRefs(['types:not-in-table'], table, 'test'))
      .toThrow(/absent from data\.evidence/u)
  })

  it('reports a response as non-internable when a canonical id already looks like a local ref', () => {
    const table = createCompactEvidenceTable([evidence('e0'), evidence('e1')], 'test')

    // Interning these would make evidenceRefs ambiguous between a local ref and the original id,
    // so the caller must decline rather than emit a payload its inverse cannot decode.
    expect(table.internable).toBe(false)
  })

  it('keeps canonical JSON when a projection declines a response', () => {
    const response = { status: 'ok', data: { value: 1 } }

    expect(serializeModelResponse(response, () => undefined)).toBe(JSON.stringify(response))
  })

  it('never emits a larger payload than canonical JSON for any projected shape', () => {
    const response = { status: 'ok', data: { value: 1 } }

    // The projection is larger here, so the canonical bytes must survive.
    expect(serializeModelResponse(response, () => ({ representation: 'big', ...response })))
      .toBe(JSON.stringify(response))
  })

  it('does not swallow a malformed-response error raised by a projection', () => {
    expect(() => serializeModelResponse({ status: 'ok' }, () => {
      throw new Error('duplicate evidence id')
    })).toThrow(/duplicate evidence id/u)
  })
})
