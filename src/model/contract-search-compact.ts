import type {
  ContractAvailability,
  ContractKind,
  ContractReference,
  ContractSearchResponse,
  ContractSearchSuccessResponse,
  Diagnostic,
  Evidence,
} from '../protocol/index.js'
import {
  compactEvidenceRefs,
  createCompactEvidenceTable,
  serializeModelResponse,
  type CompactEvidenceRef,
} from './compact-response.js'

export const CONTRACT_SEARCH_COMPACT_REPRESENTATION = 'dsh-contract-search-compact-v1' as const

export interface CompactContractReference {
  readonly id: string
  readonly kind: ContractKind
  readonly name: string
  readonly qualifiedName: string
  readonly availability: ContractAvailability
  readonly score: number
  readonly summary?: string
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

export interface CompactContractSearchSuccessResponse {
  readonly representation: typeof CONTRACT_SEARCH_COMPACT_REPRESENTATION
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly matches: readonly CompactContractReference[]
    readonly evidenceByRef: Readonly<Record<string, Evidence>>
  }
  readonly diagnostics?: readonly Diagnostic[]
}

export type ContractSearchModelResponse =
  | CompactContractSearchSuccessResponse
  | Exclude<ContractSearchResponse, ContractSearchSuccessResponse>

const LABEL = 'Contract Search success response'

function compactMatch(
  match: ContractReference,
  table: ReturnType<typeof createCompactEvidenceTable>,
): CompactContractReference {
  return Object.freeze({
    id: match.id,
    kind: match.kind,
    name: match.name,
    qualifiedName: match.qualifiedName,
    availability: match.availability,
    score: match.score,
    ...(match.summary === undefined ? {} : { summary: match.summary }),
    evidenceRefs: compactEvidenceRefs(match.evidenceIds, table, LABEL),
  })
}

/**
 * Lossless model-facing projection for Contract Search.
 *
 * Search repeats the same long evidence ids across every match and again in `data.evidence`,
 * which is where its model-facing bytes are spent. The projection interns each canonical
 * evidence record once and addresses it by a deterministic local ref, exactly as Contract
 * Inspect already does. Failed and stale responses pass through unchanged so the existing
 * fail-closed semantics stay explicit.
 */
export function compactContractSearchModelResponse(
  response: ContractSearchResponse,
): ContractSearchModelResponse | undefined {
  if (response.status !== 'ok') return response

  const table = createCompactEvidenceTable(response.data.evidence, LABEL)
  if (!table.internable) return undefined

  return Object.freeze({
    representation: CONTRACT_SEARCH_COMPACT_REPRESENTATION,
    requestId: response.requestId,
    snapshotFingerprint: response.snapshotFingerprint,
    data: Object.freeze({
      contractIndexFingerprint: response.data.contractIndexFingerprint,
      matches: Object.freeze(response.data.matches.map(match => compactMatch(match, table))),
      evidenceByRef: table.evidenceByRef,
    }),
    ...(response.diagnostics.length === 0
      ? {}
      : { diagnostics: Object.freeze([...response.diagnostics]) }),
  })
}

/**
 * Serialize Contract Search for model-facing text without ever increasing the exact UTF-8
 * payload relative to canonical Protocol v1 JSON. Ties, regressions and responses that cannot
 * be represented unambiguously fall back to canonical JSON.
 */
export function serializeContractSearchModelResponse(
  response: ContractSearchResponse,
): string {
  return serializeModelResponse(response, candidate =>
    compactContractSearchModelResponse(candidate))
}
