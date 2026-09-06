import { describe, expect, it } from 'vitest'

import { inspectContractResponse } from '../../src/kernel/index.js'
import * as compactModel from '../../src/model/contract-inspect-compact.js'
import type {
  ContractAvailability,
  ContractInspectResponse,
  ContractKind,
  Diagnostic,
  Evidence,
} from '../../src/protocol/index.js'
import {
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  createFrozenM2RetrievalIndex,
} from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

const INSPECT_REQUEST_ID = '00000000-0000-4000-8000-000000000186'
const EXHAUSTIVE_TIMEOUT_MS = 15_000

type CompactEvidenceRef = `e${number}`

interface CompactFactForTest {
  readonly key: string
  readonly value: string
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

interface CompactContractForTest {
  readonly id: string
  readonly kind: ContractKind
  readonly name: string
  readonly qualifiedName: string
  readonly availability: ContractAvailability
  readonly summary?: string
  readonly facts: readonly CompactFactForTest[]
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

interface CompactSuccessForTest {
  readonly representation: 'dsh-contract-inspect-compact-v1'
  readonly protocolVersion: '1'
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly status: 'ok'
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly contract: CompactContractForTest
    readonly evidenceByRef: Readonly<Record<CompactEvidenceRef, Evidence>>
  }
  readonly diagnostics: readonly Diagnostic[]
}

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

function parseRef(ref: string): number {
  const match = /^e(\d+)$/u.exec(ref)
  if (match === null) throw new Error(`Invalid compact evidence ref ${ref}`)
  return Number(match[1])
}

function canonicalEvidenceId(
  evidenceByRef: Readonly<Record<string, Evidence>>,
  ref: string,
): string {
  const item = evidenceByRef[ref]
  if (item === undefined) throw new Error(`Unresolved compact evidence ref ${ref}`)
  return item.id
}

/** Test-only independent inverse. Production intentionally owns only the forward projection. */
function expandForTest(compact: CompactSuccessForTest): Extract<ContractInspectResponse, { readonly status: 'ok' }> {
  const evidenceEntries = Object.entries(compact.data.evidenceByRef)
    .toSorted(([left], [right]) => parseRef(left) - parseRef(right))
  const expectedRefs = evidenceEntries.map((_, index) => `e${index}`)
  expect(evidenceEntries.map(([ref]) => ref)).toEqual(expectedRefs)

  const contract = compact.data.contract
  return {
    protocolVersion: compact.protocolVersion,
    requestId: compact.requestId,
    snapshotFingerprint: compact.snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint: compact.data.contractIndexFingerprint,
      contract: {
        id: contract.id,
        kind: contract.kind,
        name: contract.name,
        qualifiedName: contract.qualifiedName,
        availability: contract.availability,
        ...(contract.summary === undefined ? {} : { summary: contract.summary }),
        facts: contract.facts.map(fact => {
          const ids = fact.evidenceRefs.map(ref => canonicalEvidenceId(compact.data.evidenceByRef, ref))
          const first = ids[0]
          if (first === undefined) throw new Error(`Compact fact ${fact.key} has no evidence refs`)
          return { key: fact.key, value: fact.value, evidenceIds: [first, ...ids.slice(1)] }
        }),
        evidenceIds: contract.evidenceRefs.map(ref => canonicalEvidenceId(compact.data.evidenceByRef, ref)),
      },
      evidence: evidenceEntries.map(([, item]) => item),
    },
    diagnostics: [...compact.diagnostics],
  }
}

function referencedCompactRefs(compact: CompactSuccessForTest): Set<string> {
  return new Set([
    ...compact.data.contract.evidenceRefs,
    ...compact.data.contract.facts.flatMap(fact => fact.evidenceRefs),
  ])
}

function canonicalEvidenceReferences(
  response: Extract<ContractInspectResponse, { readonly status: 'ok' }>,
): readonly string[] {
  return [
    ...response.data.contract.evidenceIds,
    ...response.data.contract.facts.flatMap(fact => fact.evidenceIds),
  ]
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

describe('M2 exhaustive Contract Inspect compact parity', () => {
  it('round-trips every frozen rc2 Web Inspect response without losing provenance or semantics', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const harness = await createFrozenM2KernelHarness()
    const compact = compactProjector()
    const serialize = modelSerializer()

    expect(index.contracts).toHaveLength(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount)
    expect(index.contracts).toHaveLength(184)

    let successes = 0
    let repeatedEvidenceReferenceCases = 0
    for (const contract of index.contracts) {
      const canonical = await inspectContractResponse(
        harness.kernel,
        {
          target: { profile: 'web' },
          contractIndexFingerprint: index.fingerprint,
          contractId: contract.id,
        },
        INSPECT_REQUEST_ID,
      )
      expect(canonical.status, contract.id).toBe('ok')
      if (canonical.status !== 'ok') continue
      successes += 1

      const projected = compact(canonical) as CompactSuccessForTest
      expect(projected.representation, contract.id).toBe('dsh-contract-inspect-compact-v1')
      expect(projected.data.contract.id, contract.id).toBe(contract.id)
      expect(projected.data.contractIndexFingerprint, contract.id).toBe(index.fingerprint)

      const evidenceRefs = Object.keys(projected.data.evidenceByRef)
      expect(new Set(evidenceRefs).size, `${contract.id}: unique compact refs`).toBe(evidenceRefs.length)
      expect(new Set(Object.values(projected.data.evidenceByRef).map(item => item.id)).size,
        `${contract.id}: unique canonical evidence ids`).toBe(evidenceRefs.length)

      const referenced = referencedCompactRefs(projected)
      for (const ref of referenced) {
        expect(projected.data.evidenceByRef[ref as CompactEvidenceRef], `${contract.id}: ${ref}`).toBeDefined()
      }
      expect(referenced, `${contract.id}: every returned evidence record remains reachable`)
        .toEqual(new Set(evidenceRefs))

      expect(expandForTest(projected), contract.id).toEqual(canonical)

      const canonicalJson = JSON.stringify(canonical)
      const modelJson = serialize(canonical)
      const canonicalRefs = canonicalEvidenceReferences(canonical)
      const hasRepeatedEvidenceReference = new Set(canonicalRefs).size < canonicalRefs.length
      if (hasRepeatedEvidenceReference) {
        repeatedEvidenceReferenceCases += 1
        expect(utf8Bytes(modelJson), `${contract.id}: repeated evidence refs must strictly compact`)
          .toBeLessThan(utf8Bytes(canonicalJson))
      } else {
        expect(utf8Bytes(modelJson), `${contract.id}: no-benefit cases must never regress`)
          .toBeLessThanOrEqual(utf8Bytes(canonicalJson))
      }
    }

    expect(successes).toBe(184)
    expect(repeatedEvidenceReferenceCases).toBeGreaterThan(0)
  }, EXHAUSTIVE_TIMEOUT_MS)
})
