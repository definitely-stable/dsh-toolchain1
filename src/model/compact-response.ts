import type { Evidence } from '../protocol/index.js'

/**
 * Model-facing serialization policy shared by every compact Toolchain projection.
 *
 * A projection is a presentation choice, never a second contract: the canonical Protocol v1
 * value stays the source of truth and a projection is emitted only when its exact UTF-8
 * payload is strictly smaller. Ties and regressions fall back to canonical JSON, so a
 * projection can never make a model-facing payload larger.
 */
export const MODEL_COMPACT_SERIALIZER_POLICY = 'strictly-smaller-utf8-v1' as const

/** Local evidence reference assigned by canonical `data.evidence` array position. */
export type CompactEvidenceRef = `e${number}`

/**
 * A canonical evidence id that already looks like a local reference. Interning such a response
 * would make `evidenceRefs` ambiguous between "local ref" and "original id", so the caller must
 * decline the projection rather than emit a payload its inverse cannot decode.
 */
const LOCAL_REF_PATTERN = /^e\d+$/u

export interface CompactEvidenceTable {
  readonly refsById: ReadonlyMap<string, CompactEvidenceRef>
  readonly evidenceByRef: Readonly<Record<string, Evidence>>
  /** False when interning would be ambiguous; callers MUST decline the projection. */
  readonly internable: boolean
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Intern canonical evidence records once and address them by deterministic local ref.
 *
 * Refs follow canonical array order rather than lexical id order, so the projection stays a
 * pure function of the response. Duplicate canonical ids are a malformed response, not an
 * ambiguous-but-usable one, and are reported loudly instead of collapsing two records into one.
 */
export function createCompactEvidenceTable(
  evidence: readonly Evidence[],
  label: string,
): CompactEvidenceTable {
  const refsById = new Map<string, CompactEvidenceRef>()
  const evidenceByRef: Record<string, Evidence> = {}
  let internable = true

  for (const [index, item] of evidence.entries()) {
    if (refsById.has(item.id)) {
      throw new Error(`${label} contains duplicate evidence id ${item.id}`)
    }
    if (LOCAL_REF_PATTERN.test(item.id)) internable = false

    const ref = `e${index}` as CompactEvidenceRef
    refsById.set(item.id, ref)
    evidenceByRef[ref] = Object.freeze({ ...item })
  }

  return Object.freeze({
    refsById,
    evidenceByRef: Object.freeze(evidenceByRef),
    internable,
  })
}

/**
 * Resolve canonical evidence ids to local refs.
 *
 * A referenced id absent from `data.evidence` is a malformed canonical response and throws, so a
 * broken provenance graph is never silently rendered as a projection that looks complete.
 */
export function compactEvidenceRefs(
  evidenceIds: readonly string[],
  table: CompactEvidenceTable,
  label: string,
): readonly CompactEvidenceRef[] {
  return Object.freeze(evidenceIds.map(evidenceId => {
    const ref = table.refsById.get(evidenceId)
    if (ref === undefined) {
      throw new Error(`${label} references evidence id ${evidenceId} absent from data.evidence`)
    }
    return ref
  }))
}

/** Emit the compact payload only when it is strictly smaller than the canonical JSON. */
export function serializeStrictlySmallerModelJson(
  canonicalJson: string,
  compact: unknown,
): string {
  const compactJson = JSON.stringify(compact)
  return utf8Bytes(compactJson) < utf8Bytes(canonicalJson) ? compactJson : canonicalJson
}

/**
 * Serialize a model-facing response through a projection under the shared size policy.
 *
 * A projection returns `undefined` to decline, which means "this response cannot be represented
 * unambiguously" (for example a canonical evidence id that already looks like a local ref) rather
 * than "this response is broken". Declining emits canonical JSON, which carries exactly the same
 * information, so no information is hidden by the fallback: the fallback *is* the complete
 * canonical value. Malformed responses still fail loudly from the projection itself.
 */
export function serializeModelResponse<T>(
  response: T,
  project: (response: T) => unknown,
): string {
  const canonicalJson = JSON.stringify(response)
  const projected = project(response)
  if (projected === undefined) return canonicalJson
  return serializeStrictlySmallerModelJson(canonicalJson, projected)
}
