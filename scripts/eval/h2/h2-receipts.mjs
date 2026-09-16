import { H2_POLICY, assertH2PolicyIntegrity } from './h2-config.mjs'
import { assertCommitmentRecord } from './h2-commitment.mjs'
import { canonicalJson, requireNonNegativeSafeInteger, sha256Canonical } from './h2-util.mjs'

export const H2_PREREGISTRATION_SCHEMA = 'dsh-toolchain-h2-preregistration-v1'
export const H2_DRY_RUN_SCHEMA = 'dsh-toolchain-h2-technical-dry-run-v1'

/**
 * Immutable preregistration receipt created by `h2 freeze`. It binds the
 * product candidate, the exact DSH target, the hidden dataset commitment,
 * the model identity, the resource policy, and the schedule identity before
 * any scoring observation exists.
 */
export function buildPreregistrationReceipt({
  candidate, target, dataset, schedule, source, generatedAt,
  policy = H2_POLICY,
}) {
  assertH2PolicyIntegrity()
  assertCommitmentRecord(dataset)
  requireHex64(candidate.gitCommitSha, 'candidate.gitCommitSha')
  requireHex64(candidate.packedArtifactSha256, 'candidate.packedArtifactSha256')
  if (typeof candidate.packageName !== 'string' || candidate.packageName.length === 0) throw new Error('candidate.packageName is required')
  if (typeof target.dshTrain !== 'string' || target.dshTrain.length === 0) throw new Error('target.dshTrain is required')
  requireHex64(target.targetFingerprint, 'target.targetFingerprint')
  requireHex64(schedule.hash, 'schedule.hash')
  if (schedule.seed !== policy.schedule.seed) throw new Error('preregistration schedule seed does not match the frozen policy')

  const envelope = {
    schema: H2_PREREGISTRATION_SCHEMA,
    generatedAt,
    candidate: Object.freeze({
      gitCommitSha: candidate.gitCommitSha,
      packedArtifactSha256: candidate.packedArtifactSha256,
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion ?? null,
      protocolVersion: candidate.protocolVersion ?? null,
    }),
    target: Object.freeze({
      dshTrain: target.dshTrain,
      dshRootVersion: target.dshRootVersion ?? null,
      targetFingerprint: target.targetFingerprint,
      profile: target.profile ?? 'acp',
    }),
    dataset: Object.freeze({
      commitmentSha256: dataset.datasetSha256,
      taskCount: dataset.taskCount,
      strata: Object.freeze([...dataset.strata]),
      calibrationSha256: dataset.calibrationSha256,
      tasks: Object.freeze(dataset.tasks.map(task => Object.freeze([...task]))),
    }),
    schedule: Object.freeze({ seed: schedule.seed, hash: schedule.hash }),
    model: Object.freeze({ ...policy.model }),
    resource: Object.freeze({ ...policy.resource }),
    statistics: Object.freeze({ ...policy.statistics }),
    policyHash: sha256Canonical(policy),
    source: Object.freeze({
      repository: source.repository,
      commit: source.commit,
      nodeVersion: source.nodeVersion,
      controllerEntry: source.controllerEntry,
    }),
  }
  return sealReceipt(envelope)
}

/** Adds the self-verifying `receiptSha256` over the canonical envelope. */
export function sealReceipt(envelope) {
  const { receiptSha256: _ignored, ...rest } = envelope
  void _ignored
  return Object.freeze({ ...rest, receiptSha256: sha256Canonical(rest) })
}

/**
 * Verifies the receipt's own seal and every frozen field against live inputs.
 *
 * @param {{receipt: any, expected?: any, policy?: any}} input
 */
export function assertPreregistrationReceipt({ receipt, expected, policy = H2_POLICY }) {
  if (!receipt || receipt.schema !== H2_PREREGISTRATION_SCHEMA) throw new Error('H2 preregistration receipt schema mismatch')
  const { receiptSha256, ...rest } = receipt
  requireHex64(receiptSha256, 'receipt.receiptSha256')
  if (sha256Canonical(rest) !== receiptSha256) throw new Error('H2 preregistration receipt seal is invalid (tampered receipt)')
  const recomputedPolicy = sha256Canonical(policy)
  if (receipt.policyHash !== recomputedPolicy) throw new Error('H2 preregistration policy hash does not match the frozen policy')
  if (canonicalJson(receipt.model) !== canonicalJson(policy.model)) throw new Error('H2 preregistration model identity does not match the frozen policy')
  if (canonicalJson(receipt.resource) !== canonicalJson(policy.resource)) throw new Error('H2 preregistration resource policy does not match the frozen policy')
  if (canonicalJson(receipt.statistics) !== canonicalJson(policy.statistics)) throw new Error('H2 preregistration statistical policy does not match the frozen policy')
  if (expected === undefined) return true
  for (const key of ['gitCommitSha', 'packedArtifactSha256']) {
    if (expected.candidate?.[key] !== receipt.candidate[key]) throw new Error(`H2 candidate ${key} does not match the frozen preregistration`)
  }
  if (expected.datasetSha256 !== receipt.dataset.commitmentSha256) throw new Error('H2 dataset commitment does not match the frozen preregistration')
  if (expected.scheduleHash !== receipt.schedule.hash) throw new Error('H2 schedule hash does not match the frozen preregistration')
  if (expected.targetFingerprint !== receipt.target.targetFingerprint) throw new Error('H2 target fingerprint does not match the frozen preregistration')
  return true
}

function assertCompositionParity({ compositionParity, policy }) {
  if (compositionParity?.verified !== true) {
    throw new Error('H2 requires an empirically verified B/C composition parity before scoring')
  }
  const added = compositionParity.addedRow
  if (added?.id !== policy.toolchainPatch.rowId || added?.name !== policy.toolchainPatch.rowName) {
    throw new Error('H2 composition parity did not add exactly the frozen Toolchain row')
  }
  return true
}

/**
 * Exactly two technical, non-scoring dry-run observations (Arm B then Arm C).
 *
 * The receipt is the gate that authorizes scoring, so it also records the
 * empirical B/C composition parity and requires each technical observation to
 * have resolved the authoritative telemetry plane without model-identity
 * drift: a harness that cannot read its own session log, or that silently
 * compares an arm with itself, must fail here rather than after the first
 * scoring observation.
 */
export function buildDryRunReceipt({ commitmentSha256, candidate, target, compositionParity, observations, generatedAt }) {
  if (!Array.isArray(observations) || observations.length !== H2_POLICY.technicalObservations) {
    throw new Error(`H2 dry run requires exactly ${H2_POLICY.technicalObservations} technical observations`)
  }
  const arms = observations.map(observation => observation.arm).sort()
  if (arms.join(',') !== 'B,C') throw new Error('H2 dry run must contain exactly one Arm B and one Arm C technical observation')
  for (const observation of observations) {
    if (observation.scoring !== false) throw new Error('H2 dry-run observations must be explicitly non-scoring')
    if (observation.terminalReason === undefined) throw new Error('H2 dry-run observation is missing its terminal reason')
    // Telemetry first: an unreadable session log is why the identity could not
    // be checked, so reporting it as drift would misdiagnose the harness.
    if (observation.telemetryResolved !== true) throw new Error('H2 dry-run observation did not resolve the authoritative session log')
    if (observation.identityDrift !== false) throw new Error('H2 dry-run observation did not record a stable model identity')
  }
  assertCompositionParity({ compositionParity, policy: H2_POLICY })
  const envelope = {
    schema: H2_DRY_RUN_SCHEMA,
    generatedAt,
    scoring: false,
    commitmentSha256,
    candidate: Object.freeze({ ...candidate }),
    target: Object.freeze({ ...target }),
    compositionParity: Object.freeze({ ...compositionParity, addedRow: Object.freeze({ ...compositionParity.addedRow }) }),
    observations: Object.freeze(observations.map(observation => Object.freeze({ ...observation }))),
  }
  return sealReceipt(envelope)
}

/** A scoring run may start only from a successful, sealed dry-run receipt. */
export function assertDryRunReceipt({ receipt, expected }) {
  if (!receipt || receipt.schema !== H2_DRY_RUN_SCHEMA) throw new Error('H2 dry-run receipt schema mismatch')
  const { receiptSha256, ...rest } = receipt
  requireHex64(receiptSha256, 'dryRun.receiptSha256')
  if (sha256Canonical(rest) !== receiptSha256) throw new Error('H2 dry-run receipt seal is invalid (tampered receipt)')
  if (receipt.scoring !== false) throw new Error('H2 dry-run receipt must be non-scoring')
  if (receipt.commitmentSha256 !== expected.datasetSha256) throw new Error('H2 dry-run receipt dataset commitment mismatch')
  if (receipt.candidate?.gitCommitSha !== expected.gitCommitSha) throw new Error('H2 dry-run receipt candidate mismatch')
  if (receipt.target?.targetFingerprint !== expected.targetFingerprint) throw new Error('H2 dry-run receipt target mismatch')
  assertCompositionParity({ compositionParity: receipt.compositionParity, policy: H2_POLICY })
  for (const observation of receipt.observations) {
    if (observation.telemetryResolved !== true) throw new Error(`H2 dry-run receipt Arm ${observation.arm} did not resolve the authoritative session log`)
    if (observation.identityDrift !== false) throw new Error(`H2 dry-run receipt Arm ${observation.arm} did not record a stable model identity`)
  }
  const failed = receipt.observations.filter(observation => observation.status !== 'ok')
  if (failed.length > 0) throw new Error(`H2 dry run did not pass: ${failed.map(observation => `${observation.arm}:${observation.terminalReason}`).join(', ')}`)
  return true
}

function requireHex64(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a 64-char lowercase sha256 hex string`)
  return value
}

export { requireNonNegativeSafeInteger }