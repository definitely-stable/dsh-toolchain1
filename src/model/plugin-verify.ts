import type { AcquiredPluginSubject } from './plugin.js'
import type {
  Diagnostic,
  PluginCheckResult,
  TargetSnapshot,
  VerificationReport,
} from '../protocol/index.js'

type VerificationCheck = VerificationReport['checks'][number]
type VerificationCheckId = VerificationCheck['id']

const CHECK_IDS = Object.freeze([
  'structure',
  'manifest',
  'dependency',
  'contract',
  'build',
  'package',
  'install',
  'compose',
  'boot',
  'visibility',
  'behavior',
] as const satisfies readonly VerificationCheckId[])

const REQUIRED_CHECK_IDS = Object.freeze(new Set<VerificationCheckId>([
  'structure',
  'manifest',
  'dependency',
  'contract',
  'package',
  'install',
  'compose',
  'boot',
]))

export interface PluginVerificationExecutionObservation {
  readonly artifactFingerprint?: string
  readonly targetFingerprint: string
  readonly executionPolicy: 'safe'
  readonly checks: readonly VerificationCheck[]
  readonly diagnostics: readonly Diagnostic[]
  readonly cleanup: VerificationReport['cleanup']
  readonly terminal: 'completed' | 'failed' | 'cancelled'
}

export interface PluginVerificationExecutionInput {
  readonly artifactPath: string
  readonly expectedContentHash: string
  readonly target: TargetSnapshot
  readonly executionPolicy: 'safe'
}

export interface PluginVerificationExecutionPort {
  verify(
    input: PluginVerificationExecutionInput,
    signal?: AbortSignal,
  ): Promise<PluginVerificationExecutionObservation>
}

export interface BoundPackedVerificationArtifact {
  readonly path: string
  readonly contentHash: string
  readonly fingerprint: string
}

export type PluginVerificationOperationErrorCode = 'VERIFY_ARTIFACT_UNPROVEN'

export class PluginVerificationOperationError extends Error {
  readonly code: PluginVerificationOperationErrorCode

  constructor(code: PluginVerificationOperationErrorCode, message: string) {
    super(message)
    this.name = 'PluginVerificationOperationError'
    this.code = code
  }
}

export function bindPackedVerificationArtifact(
  subject: AcquiredPluginSubject,
): BoundPackedVerificationArtifact {
  if (subject.completeness !== 'complete') {
    throw new PluginVerificationOperationError(
      'VERIFY_ARTIFACT_UNPROVEN',
      'Runtime verification requires one complete packed subject with authoritative exact artifact evidence.',
    )
  }

  const matches = subject.evidence.filter(item => item.id === 'plugin:packed-artifact')
  const artifact = matches.length === 1 ? matches[0] : undefined
  const contentHash = artifact?.contentHash
  if (
    artifact === undefined
    || artifact.kind !== 'package'
    || artifact.strength !== 'authoritative'
    || typeof artifact.location !== 'string'
    || artifact.location.length === 0
    || typeof contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(contentHash)
  ) {
    throw new PluginVerificationOperationError(
      'VERIFY_ARTIFACT_UNPROVEN',
      'Runtime verification could not bind one authoritative exact packed artifact observation.',
    )
  }

  return Object.freeze({
    path: artifact.location,
    contentHash,
    fingerprint: `dsh-plugin-artifact-v1:${contentHash}`,
  })
}

export interface PluginVerificationReductionInput {
  readonly artifactFingerprint: string
  readonly initialTargetFingerprint: string
  readonly finalTargetFingerprint: string
  readonly staticResult: PluginCheckResult
  readonly staticDiagnostics: readonly Diagnostic[]
  readonly execution: PluginVerificationExecutionObservation
}

function diagnostic(
  code: string,
  severity: Diagnostic['severity'],
  summary: string,
): Diagnostic {
  return Object.freeze({
    code,
    severity,
    domain: 'verification',
    summary,
  })
}

function freezeCheck(check: VerificationCheck): VerificationCheck {
  return Object.freeze({ ...check })
}

function normalizedChecks(execution: PluginVerificationExecutionObservation): VerificationCheck[] {
  const byId = new Map(execution.checks.map(check => [check.id, check] as const))
  return CHECK_IDS.map(id => freezeCheck(byId.get(id) ?? {
    id,
    status: 'skipped',
    reason: 'worker-check-missing',
  }))
}

function replaceCheck(
  checks: VerificationCheck[],
  replacement: VerificationCheck,
): VerificationCheck[] {
  return checks.map(check => check.id === replacement.id ? freezeCheck(replacement) : check)
}

function staticChecks(
  workerChecks: VerificationCheck[],
  result: PluginCheckResult,
): VerificationCheck[] {
  let checks = workerChecks

  checks = replaceCheck(checks, result.subjectCompleteness === 'complete'
    ? { id: 'structure', status: 'passed' }
    : result.subjectCompleteness === 'invalid'
      ? { id: 'structure', status: 'failed', reason: 'static-subject-invalid' }
      : { id: 'structure', status: 'skipped', reason: 'static-subject-partial' })

  checks = replaceCheck(checks, result.subjectCompleteness === 'complete'
    ? { id: 'manifest', status: 'passed' }
    : result.subjectCompleteness === 'invalid'
      ? { id: 'manifest', status: 'failed', reason: 'static-manifest-invalid' }
      : { id: 'manifest', status: 'skipped', reason: 'static-manifest-unproven' })

  const hasMissingRequirement = result.requirements.some(requirement => requirement.status === 'missing')
  const hasUnprovenRequirement = result.requirements.some(requirement => requirement.status === 'unproven')
  checks = replaceCheck(checks, hasMissingRequirement
    ? { id: 'dependency', status: 'failed', reason: 'static-host-requirement-missing' }
    : hasUnprovenRequirement
      ? { id: 'dependency', status: 'skipped', reason: 'static-host-requirement-unproven' }
      : { id: 'dependency', status: 'passed' })

  checks = replaceCheck(checks, result.verdict === 'incompatible'
    ? { id: 'contract', status: 'failed', reason: 'static-incompatible' }
    : result.verdict === 'unproven'
      ? { id: 'contract', status: 'skipped', reason: 'static-unproven' }
      : { id: 'contract', status: 'passed' })

  return checks
}

function diagnosticKey(item: Diagnostic): string {
  return [
    item.code,
    item.severity,
    item.domain,
    item.summary,
    ...(item.evidenceIds ?? []),
    ...(item.locations ?? []),
  ].join('\u0000')
}

function uniqueDiagnostics(items: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  const unique: Diagnostic[] = []
  for (const item of items) {
    const key = diagnosticKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(Object.freeze({
      ...item,
      ...(item.evidenceIds === undefined ? {} : { evidenceIds: [...item.evidenceIds] }),
      ...(item.locations === undefined ? {} : { locations: [...item.locations] }),
      ...(item.repair === undefined ? {} : { repair: item.repair === null ? null : { ...item.repair } }),
    }))
  }
  return unique
}

function requiredCheckFailed(checks: readonly VerificationCheck[]): boolean {
  return checks.some(check => REQUIRED_CHECK_IDS.has(check.id) && check.status === 'failed')
}

function requiredCheckIncomplete(checks: readonly VerificationCheck[]): boolean {
  return checks.some(check => REQUIRED_CHECK_IDS.has(check.id) && check.status !== 'passed')
}

export function reducePluginVerification(
  input: PluginVerificationReductionInput,
): VerificationReport {
  const checks = staticChecks(normalizedChecks(input.execution), input.staticResult)
  const reducerDiagnostics: Diagnostic[] = []

  const artifactIdentityMismatch = input.execution.artifactFingerprint !== undefined
    && input.execution.artifactFingerprint !== input.artifactFingerprint
  if (artifactIdentityMismatch) {
    reducerDiagnostics.push(diagnostic(
      'VERIFY_ARTIFACT_IDENTITY_MISMATCH',
      'error',
      'Verification worker artifact identity does not match the exact artifact bound before execution.',
    ))
  }

  const workerTargetMismatch = input.execution.targetFingerprint !== input.initialTargetFingerprint
  if (workerTargetMismatch) {
    reducerDiagnostics.push(diagnostic(
      'VERIFY_TARGET_BINDING_MISMATCH',
      'error',
      'Verification worker observation is not bound to the initial exact target fingerprint.',
    ))
  }

  const targetStale = input.finalTargetFingerprint !== input.initialTargetFingerprint
  if (targetStale) {
    reducerDiagnostics.push(diagnostic(
      'VERIFY_TARGET_STALE',
      'error',
      'The exact target changed after verification execution and the result cannot be claimed for the current target epoch.',
    ))
  }

  const staticUnproven = input.staticResult.verdict === 'unproven'
    || input.staticResult.subjectCompleteness === 'partial'
    || input.staticResult.requirements.some(requirement => requirement.status === 'unproven')
  if (staticUnproven) {
    reducerDiagnostics.push(diagnostic(
      'VERIFY_STATIC_UNPROVEN',
      'warning',
      'Static evidence is insufficient to prove every material requirement covered by the M4.2 verification claim.',
    ))
  }

  const status: VerificationReport['status'] = input.execution.terminal === 'cancelled'
    ? 'cancelled'
    : targetStale
      ? 'stale'
      : artifactIdentityMismatch
        || workerTargetMismatch
        || input.execution.terminal === 'failed'
        || input.staticResult.verdict === 'incompatible'
        || requiredCheckFailed(checks)
        ? 'failed'
        : input.execution.cleanup !== 'succeeded'
          || staticUnproven
          || requiredCheckIncomplete(checks)
          ? 'partial'
          : 'verified'

  return Object.freeze({
    status,
    artifactFingerprint: input.artifactFingerprint,
    targetFingerprint: input.initialTargetFingerprint,
    executionPolicy: 'safe',
    checks,
    diagnostics: uniqueDiagnostics([
      ...input.staticDiagnostics,
      ...input.execution.diagnostics,
      ...reducerDiagnostics,
    ]),
    cleanup: input.execution.cleanup,
  })
}
