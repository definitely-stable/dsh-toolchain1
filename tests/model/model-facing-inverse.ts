import type {
  ContractSearchResponse,
  Diagnostic,
  Evidence,
  PluginCheckResponse,
  PluginPackageRelationship,
  PluginRequirementAnalysis,
  PluginRequirementStatus,
} from '../../src/protocol/index.js'

/**
 * Independent inverse of the model-facing compact projections.
 *
 * This module is deliberately written from the published representation contracts rather than
 * from the projection implementations, so a round-trip test that uses it proves the projections
 * are lossless instead of proving they are self-consistent. It performs no size decisions and no
 * fallbacks: given a compact payload it must recover the exact canonical Protocol v1 value, and
 * given a canonical payload it must pass it through untouched.
 */

export const CONTRACT_SEARCH_COMPACT = 'dsh-contract-search-compact-v1'
export const CONTRACT_INSPECT_COMPACT = 'dsh-contract-inspect-compact-v1'
export const PLUGIN_CHECK_COMPACT = 'dsh-plugin-check-compact-v1'

type Json = Record<string, unknown>

function asObject(value: unknown, label: string): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Compact ${label} must be an object`)
  }
  return value as Json
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Compact ${label} must be an array`)
  return value
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Compact ${label} must be a string`)
  return value
}

/**
 * Narrow a parsed literal against the published protocol vocabulary. The inverse reconstructs a
 * canonical value from untrusted JSON, so an unrecognized enum member must fail loudly here rather
 * than be asserted into the canonical type and compared afterwards.
 */
function asLiteral<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`Compact ${label} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function asFalse(value: unknown, label: string): false {
  if (value !== false) throw new Error(`Compact ${label} must be false`)
  return false
}

const RELATIONSHIPS = [
  'host-peer-required',
  'host-peer-optional',
  'artifact-dependency',
] as const satisfies readonly PluginPackageRelationship[]

const REQUIREMENT_STATUSES = [
  'satisfied',
  'not-required-from-host',
  'missing',
  'version-mismatch',
  'unproven',
] as const satisfies readonly PluginRequirementStatus[]

const SUBJECT_COMPLETENESS = ['complete', 'partial', 'invalid'] as const
const VERDICTS = ['compatible-in-scope', 'incompatible', 'unproven'] as const
const RULESETS = ['plugin-static-alpha-v1'] as const

/**
 * Recover canonical evidence ids from local refs. A ref that does not resolve is a hard error:
 * the inverse must never invent an id, because a silently wrong evidence id would turn a
 * provenance check into a false pass.
 */
function expandEvidenceIds(refs: unknown, evidenceByRef: unknown, label: string): string[] {
  const table = asObject(evidenceByRef, `${label} evidenceByRef`)
  return asArray(refs, `${label} evidenceRefs`).map(ref => {
    if (typeof ref !== 'string') throw new Error(`Compact ${label} evidence ref must be a string`)
    const item = asObject(table[ref], `evidence record for ref ${ref}`)
    if (typeof item.id !== 'string') {
      throw new Error(`Compact ${label} evidence ref ${ref} does not resolve to a canonical id`)
    }
    return item.id
  })
}

function expandContractSearch(compact: Json): ContractSearchResponse {
  const data = asObject(compact.data, 'Contract Search data')
  const matches = asArray(data.matches, 'Contract Search matches').map(match => {
    const row = asObject(match, 'Contract Search match')
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      qualifiedName: row.qualifiedName,
      availability: row.availability,
      score: row.score,
      ...(row.summary === undefined ? {} : { summary: row.summary }),
      evidenceIds: expandEvidenceIds(row.evidenceRefs, data.evidenceByRef, 'Contract Search match'),
    }
  }) as ContractSearchResponse extends { data: { matches: infer M } } ? M : never

  const table = asObject(data.evidenceByRef, 'Contract Search evidenceByRef')
  const evidence = Object.keys(table)
    .map(ref => table[ref] as Evidence)

  return {
    protocolVersion: '1',
    requestId: compact.requestId,
    snapshotFingerprint: compact.snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint: data.contractIndexFingerprint,
      matches,
      evidence,
    },
    diagnostics: (compact.diagnostics ?? []) as never,
  } as ContractSearchResponse
}

function expandPluginCheck(compact: Json): PluginCheckResponse {
  const data = asObject(compact.data, 'Plugin Check data')
  const requirements: PluginRequirementAnalysis[] = asArray(
    data.requirements,
    'Plugin Check requirements',
  ).map(requirement => {
    const row = asObject(requirement, 'Plugin Check requirement')
    const targetVersion = row.targetVersion === undefined
      ? undefined
      : asString(row.targetVersion, 'Plugin Check targetVersion')
    return {
      packageName: asString(row.packageName, 'Plugin Check packageName'),
      range: asString(row.range, 'Plugin Check range'),
      relationship: asLiteral(row.relationship, RELATIONSHIPS, 'Plugin Check relationship'),
      status: asLiteral(row.status, REQUIREMENT_STATUSES, 'Plugin Check status'),
      ...(targetVersion === undefined ? {} : { targetVersion }),
      evidenceIds: expandEvidenceIds(row.evidenceRefs, data.evidenceByRef, 'Plugin Check requirement'),
    }
  })

  const table = asObject(data.evidenceByRef, 'Plugin Check evidenceByRef')
  const evidence = Object.keys(table).map(ref => table[ref] as Evidence)

  return {
    protocolVersion: '1',
    requestId: asString(compact.requestId, 'Plugin Check requestId'),
    snapshotFingerprint: asString(compact.snapshotFingerprint, 'Plugin Check snapshotFingerprint'),
    status: 'ok',
    data: {
      contractIndexFingerprint: asString(
        data.contractIndexFingerprint,
        'Plugin Check contractIndexFingerprint',
      ),
      ...(data.subjectFingerprint === undefined
        ? {}
        : { subjectFingerprint: asString(data.subjectFingerprint, 'Plugin Check subjectFingerprint') }),
      subjectCompleteness: asLiteral(
        data.subjectCompleteness,
        SUBJECT_COMPLETENESS,
        'Plugin Check subjectCompleteness',
      ),
      ruleset: asLiteral(data.ruleset, RULESETS, 'Plugin Check ruleset'),
      scopeComplete: asFalse(data.scopeComplete, 'Plugin Check scopeComplete'),
      verdict: asLiteral(data.verdict, VERDICTS, 'Plugin Check verdict'),
      requirements,
      evidence,
      candidateCodeExecuted: asFalse(data.candidateCodeExecuted, 'Plugin Check candidateCodeExecuted'),
    },
    diagnostics: (compact.diagnostics ?? []) as Diagnostic[],
  }
}

/**
 * Expand any model-facing Toolchain text back to the canonical Protocol v1 value.
 *
 * Returns the parsed input unchanged when it carries no known compact representation, so the
 * caller can apply one inverse to every response regardless of which branch the serializer chose.
 */
export function expandModelFacingText(text: string): unknown {
  const parsed = JSON.parse(text) as unknown
  const value = asObject(parsed, 'model-facing response')
  const representation = value.representation

  if (representation === CONTRACT_SEARCH_COMPACT) return expandContractSearch(value)
  if (representation === PLUGIN_CHECK_COMPACT) return expandPluginCheck(value)
  if (representation === CONTRACT_INSPECT_COMPACT) {
    throw new Error('Contract Inspect expansion is provided by the frozen evaluation inverse')
  }
  return parsed
}
