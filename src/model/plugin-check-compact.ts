import type {
  Diagnostic,
  Evidence,
  PluginCheckResponse,
  PluginCheckSuccessResponse,
  PluginPackageRelationship,
  PluginRequirementAnalysis,
  PluginRequirementStatus,
} from '../protocol/index.js'
import {
  compactEvidenceRefs,
  createCompactEvidenceTable,
  serializeModelResponse,
  type CompactEvidenceRef,
} from './compact-response.js'

export const PLUGIN_CHECK_COMPACT_REPRESENTATION = 'dsh-plugin-check-compact-v1' as const

export interface CompactPluginRequirementAnalysis {
  readonly packageName: string
  readonly range: string
  readonly relationship: PluginPackageRelationship
  readonly status: PluginRequirementStatus
  readonly targetVersion?: string
  readonly evidenceRefs: readonly CompactEvidenceRef[]
}

export interface CompactPluginCheckSuccessResponse {
  readonly representation: typeof PLUGIN_CHECK_COMPACT_REPRESENTATION
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly subjectFingerprint?: string
    readonly subjectCompleteness: PluginCheckSuccessResponse['data']['subjectCompleteness']
    readonly ruleset: PluginCheckSuccessResponse['data']['ruleset']
    readonly scopeComplete: PluginCheckSuccessResponse['data']['scopeComplete']
    readonly verdict: PluginCheckSuccessResponse['data']['verdict']
    readonly requirements: readonly CompactPluginRequirementAnalysis[]
    readonly evidenceByRef: Readonly<Record<string, Evidence>>
    readonly candidateCodeExecuted: PluginCheckSuccessResponse['data']['candidateCodeExecuted']
  }
  readonly diagnostics?: readonly Diagnostic[]
}

export type PluginCheckModelResponse =
  | CompactPluginCheckSuccessResponse
  | Exclude<PluginCheckResponse, PluginCheckSuccessResponse>

const LABEL = 'Plugin Check success response'

function compactRequirement(
  requirement: PluginRequirementAnalysis,
  table: ReturnType<typeof createCompactEvidenceTable>,
): CompactPluginRequirementAnalysis {
  return Object.freeze({
    packageName: requirement.packageName,
    range: requirement.range,
    relationship: requirement.relationship,
    status: requirement.status,
    ...(requirement.targetVersion === undefined ? {} : { targetVersion: requirement.targetVersion }),
    evidenceRefs: compactEvidenceRefs(requirement.evidenceIds, table, LABEL),
  })
}

/**
 * Lossless model-facing projection for Exact Target Plugin Check.
 *
 * The verdict, subject completeness, ruleset, scope and `candidateCodeExecuted` stay explicit
 * because they are the decision-relevant fields: `unproven` must never look like a pass, and a
 * static result must never look like runtime verification. Only repeated evidence ids in the
 * requirement rows are interned.
 */
export function compactPluginCheckModelResponse(
  response: PluginCheckResponse,
): PluginCheckModelResponse | undefined {
  if (response.status !== 'ok') return response

  const table = createCompactEvidenceTable(response.data.evidence, LABEL)
  if (!table.internable) return undefined

  const data = response.data
  return Object.freeze({
    representation: PLUGIN_CHECK_COMPACT_REPRESENTATION,
    requestId: response.requestId,
    snapshotFingerprint: response.snapshotFingerprint,
    data: Object.freeze({
      contractIndexFingerprint: data.contractIndexFingerprint,
      ...(data.subjectFingerprint === undefined ? {} : { subjectFingerprint: data.subjectFingerprint }),
      subjectCompleteness: data.subjectCompleteness,
      ruleset: data.ruleset,
      scopeComplete: data.scopeComplete,
      verdict: data.verdict,
      requirements: Object.freeze(data.requirements.map(requirement =>
        compactRequirement(requirement, table))),
      evidenceByRef: table.evidenceByRef,
      candidateCodeExecuted: data.candidateCodeExecuted,
    }),
    ...(response.diagnostics.length === 0
      ? {}
      : { diagnostics: Object.freeze([...response.diagnostics]) }),
  })
}

/**
 * Serialize Plugin Check for model-facing text without ever increasing the exact UTF-8 payload
 * relative to canonical Protocol v1 JSON. Ties, regressions and responses that cannot be
 * represented unambiguously fall back to canonical JSON.
 */
export function serializePluginCheckModelResponse(
  response: PluginCheckResponse,
): string {
  return serializeModelResponse(response, candidate =>
    compactPluginCheckModelResponse(candidate))
}
