import type {
  ContractAvailability,
  ContractInspectResponse,
  ContractInspectSuccessResponse,
  ContractKind,
  Diagnostic,
  Evidence,
} from '../protocol/index.js'
import {
  compactEvidenceRefs,
  createCompactEvidenceTable,
  serializeModelResponse,
  type CompactEvidenceRef,
} from './compact-response.js'

export const CONTRACT_INSPECT_COMPACT_REPRESENTATION = 'dsh-contract-inspect-compact-v1' as const

export interface CompactContractFact {
  readonly key: string
  readonly value: string
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

export interface CompactContractDefinition {
  readonly id: string
  readonly kind: ContractKind
  readonly name: string
  readonly qualifiedName: string
  readonly availability: ContractAvailability
  readonly summary?: string
  readonly facts: readonly CompactContractFact[]
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

export interface CompactContractInspectSuccessResponse {
  readonly representation: typeof CONTRACT_INSPECT_COMPACT_REPRESENTATION
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly contract: CompactContractDefinition
    readonly evidenceByRef: Readonly<Record<string, Evidence>>
  }
  readonly diagnostics?: readonly Diagnostic[]
}

export type ContractInspectModelResponse =
  | CompactContractInspectSuccessResponse
  | Exclude<ContractInspectResponse, ContractInspectSuccessResponse>

const LABEL = 'Contract Inspect success response'

/**
 * Lossless model-facing projection for Contract Inspect.
 *
 * The canonical Protocol v1 response remains the source of truth. Only successful
 * responses are normalized into local evidence references; failed/stale responses
 * pass through unchanged so existing fail-closed semantics remain intact.
 *
 * The compact-v1 identity itself implies canonical `protocolVersion: '1'` and
 * `status: 'ok'`; empty diagnostics are likewise reconstructed as `[]` by the
 * independent verification inverse. Non-empty diagnostics remain explicit.
 */
export function compactContractInspectModelResponse(
  response: ContractInspectResponse,
): ContractInspectModelResponse {
  if (response.status !== 'ok') return response
  return compactSuccessResponse(response)
}

function compactSuccessResponse(
  response: ContractInspectSuccessResponse,
): CompactContractInspectSuccessResponse {
  const table = createCompactEvidenceTable(response.data.evidence, LABEL)
  const contract = response.data.contract
  const facts = Object.freeze(contract.facts.map(fact => Object.freeze({
    key: fact.key,
    value: fact.value,
    evidenceRefs: compactEvidenceRefs(fact.evidenceIds, table, LABEL),
  })))

  const compactContract: CompactContractDefinition = Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: contract.name,
    qualifiedName: contract.qualifiedName,
    availability: contract.availability,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    facts,
    evidenceRefs: compactEvidenceRefs(contract.evidenceIds, table, LABEL),
  })

  return Object.freeze({
    representation: CONTRACT_INSPECT_COMPACT_REPRESENTATION,
    requestId: response.requestId,
    snapshotFingerprint: response.snapshotFingerprint,
    data: Object.freeze({
      contractIndexFingerprint: response.data.contractIndexFingerprint,
      contract: compactContract,
      evidenceByRef: table.evidenceByRef,
    }),
    ...(response.diagnostics.length === 0
      ? {}
      : { diagnostics: Object.freeze([...response.diagnostics]) }),
  })
}

/**
 * Serialize Contract Inspect for model-facing text without ever increasing the
 * exact UTF-8 payload relative to canonical Protocol v1 JSON.
 *
 * Successful responses use the lossless compact projection only when it is
 * strictly smaller. Ties and regressions fall back to canonical JSON. Failed
 * and stale responses remain canonical so fail-closed semantics stay explicit.
 */
export function serializeContractInspectModelResponse(
  response: ContractInspectResponse,
): string {
  return serializeModelResponse(response, candidate =>
    candidate.status === 'ok' ? compactSuccessResponse(candidate) : undefined)
}
