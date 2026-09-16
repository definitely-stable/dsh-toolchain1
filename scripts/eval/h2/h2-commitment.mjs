import { sha256Canonical } from './h2-util.mjs'

export const H2_COMMITMENT_SCHEMA = 'dsh-toolchain-h2-commitment-v1'

const HEX64 = /^[0-9a-f]{64}$/

/**
 * The commitment input for one hidden task: its identity, stratum, and the
 * four content hashes. This flat shape is the only projection of a task that
 * ever leaves the corpus loader.
 *
 * @typedef {object} H2CommitmentTask
 * @property {string} taskId
 * @property {string} stratum
 * @property {string} promptSha256
 * @property {string} workspaceSha256
 * @property {string} referenceFixSha256
 * @property {string} graderSha256
 */

function requireHex64(value, label) {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new Error(`${label} must be a 64-char lowercase sha256 hex string`)
  return value
}

/**
 * One immutable per-task digest, binding the task identity, stratum, and the
 * content hashes of all four artifacts (prompt, workspace, reference fix,
 * grader). Changing anything about the hidden task changes the digest.
 *
 * @param {H2CommitmentTask} task
 */
export function buildTaskDigest(task) {
  const normalized = {
    taskId: task.taskId,
    stratum: task.stratum,
    promptSha256: requireHex64(task.promptSha256, 'promptSha256'),
    workspaceSha256: requireHex64(task.workspaceSha256, 'workspaceSha256'),
    referenceFixSha256: requireHex64(task.referenceFixSha256, 'referenceFixSha256'),
    graderSha256: requireHex64(task.graderSha256, 'graderSha256'),
  }
  return sha256Canonical(normalized)
}

/**
 * The dataset commitment is the SHA-256 over the ordered list of per-task
 * digests. It reveals task identity, stratum, and content hashes (all
 * preimage-resistant) without revealing any hidden prompt, reference patch,
 * or grader source.
 *
 * @param {readonly H2CommitmentTask[]} tasks
 */
export function buildDatasetCommitment(tasks) {
  const projection = tasks.map(task => ({
    taskId: task.taskId,
    stratum: task.stratum,
    taskDigest: buildTaskDigest(task),
  }))
  return Object.freeze({
    projection: Object.freeze(projection),
    sha256: sha256Canonical(projection),
  })
}

/**
 * Fail closed when the recomputed commitment does not match the frozen one.
 *
 * @param {{tasks: readonly H2CommitmentTask[], expectedSha256: string}} input
 */
export function verifyDatasetCommitment({ tasks, expectedSha256 }) {
  const { sha256 } = buildDatasetCommitment(tasks)
  if (expectedSha256 !== sha256) {
    throw new Error(`dataset commitment mismatch: expected ${expectedSha256}, computed ${sha256}`)
  }
  return sha256
}

/**
 * Public commitment record. Contains only schema, count, strata, and the
 * per-task `[taskId, stratum, taskDigest]` triples plus the dataset and
 * calibration hashes. No hidden content.
 *
 * @param {{tasks: readonly H2CommitmentTask[], calibrationSha256: string}} input
 */
export function buildCommitmentRecord({ tasks, calibrationSha256 }) {
  const { projection, sha256: datasetSha256 } = buildDatasetCommitment(tasks)
  const record = {
    schema: H2_COMMITMENT_SCHEMA,
    taskCount: tasks.length,
    strata: [...new Set(tasks.map(task => task.stratum))].sort(),
    tasks: projection.map(item => [item.taskId, item.stratum, item.taskDigest]),
    datasetSha256,
    calibrationSha256: requireHex64(calibrationSha256, 'calibrationSha256'),
  }
  return Object.freeze(record)
}

export function assertCommitmentRecord(record) {
  if (!record || record.schema !== H2_COMMITMENT_SCHEMA) throw new Error('H2 commitment schema mismatch')
  requireNonNegativeSafeInteger(record.taskCount, 'commitment taskCount')
  if (record.taskCount !== record.tasks.length) throw new Error('H2 commitment task count does not match its task list')
  requireHex64(record.datasetSha256, 'compliance datasetSha256')
  requireHex64(record.calibrationSha256, 'compliance calibrationSha256')
}

function requireNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return value
}