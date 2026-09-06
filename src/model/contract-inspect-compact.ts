import type {
  ContractAvailability,
  ContractInspectResponse,
  ContractInspectSuccessResponse,
  ContractKind,
  Diagnostic,
  Evidence,
} from '../protocol/index.js'

export const CONTRACT_INSPECT_COMPACT_REPRESENTATION = 'dsh-contract-inspect-compact-v1' as const

export type CompactEvidenceRef = `e${number}`

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
  readonly protocolVersion: '1'
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly status: 'ok'
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly contract: CompactContractDefinition
    readonly evidenceByRef: Readonly<Record<string, Evidence>>
  }
  readonly diagnostics: readonly Diagnostic[]
}

export type ContractInspectModelResponse =
  | CompactContractInspectSuccessResponse
  | Exclude<ContractInspectResponse, ContractInspectSuccessResponse>

interface CompactEvidenceTable {
  readonly refsById: ReadonlyMap<string, CompactEvidenceRef>
  readonly evidenceByRef: Readonly<Record<string, Evidence>>
}

function compactEvidenceTable(evidence: readonly Evidence[]): CompactEvidenceTable {
  const refsById = new Map<string, CompactEvidenceRef>()
  const evidenceByRef: Record<string, Evidence> = {}

  for (const [index, item] of evidence.entries()) {
    if (refsById.has(item.id)) {
      throw new Error(`Contract Inspect success response contains duplicate evidence id ${item.id}`)
    }

    const ref = `e${index}` as CompactEvidenceRef
    refsById.set(item.id, ref)
    evidenceByRef[ref] = Object.freeze({ ...item })
  }

  return Object.freeze({
    refsById,
    evidenceByRef: Object.freeze(evidenceByRef),
  })
}

function compactEvidenceRefs(
  evidenceIds: readonly string[],
  refsById: ReadonlyMap<string, CompactEvidenceRef>,
): readonly CompactEvidenceRef[] {
  return Object.freeze(evidenceIds.map(evidenceId => {
    const ref = refsById.get(evidenceId)
    if (ref === undefined) {
      throw new Error(
        `Contract Inspect success response references evidence id ${evidenceId} absent from data.evidence`,
      )
    }
    return ref
  }))
}

function compactSuccessResponse(
  response: ContractInspectSuccessResponse,
): CompactContractInspectSuccessResponse {
  const table = compactEvidenceTable(response.data.evidence)
  const contract = response.data.contract
  const facts = Object.freeze(contract.facts.map(fact => Object.freeze({
    key: fact.key,
    value: fact.value,
    evidenceRefs: compactEvidenceRefs(fact.evidenceIds, table.refsById),
  })))

  const compactContract: CompactContractDefinition = Object.freeze({
    id: contract.id,
    kind: contract.kind,
    name: contract.name,
    qualifiedName: contract.qualifiedName,
    availability: contract.availability,
    ...(contract.summary === undefined ? {} : { summary: contract.summary }),
    facts,
    evidenceRefs: compactEvidenceRefs(contract.evidenceIds, table.refsById),
  })

  return Object.freeze({
    representation: CONTRACT_INSPECT_COMPACT_REPRESENTATION,
    protocolVersion: response.protocolVersion,
    requestId: response.requestId,
    snapshotFingerprint: response.snapshotFingerprint,
    status: 'ok' as const,
    data: Object.freeze({
      contractIndexFingerprint: response.data.contractIndexFingerprint,
      contract: compactContract,
      evidenceByRef: table.evidenceByRef,
    }),
    diagnostics: Object.freeze([...response.diagnostics]),
  })
}

/**
 * Lossless model-facing projection for Contract Inspect.
 *
 * The canonical Protocol v1 response remains the source of truth. Only successful
 * responses are normalized into local evidence references; failed/stale responses
 * pass through unchanged so existing fail-closed semantics remain intact.
 */
export function compactContractInspectModelResponse(
  response: ContractInspectResponse,
): ContractInspectModelResponse {
  if (response.status !== 'ok') return response
  return compactSuccessResponse(response)
}
