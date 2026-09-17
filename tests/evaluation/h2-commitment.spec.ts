import { describe, expect, it } from 'vitest'

import {
  buildCommitmentRecord,
  buildDatasetCommitment,
  buildTaskDigest,
  verifyDatasetCommitment,
} from '../../scripts/eval/h2/h2-commitment.mjs'

/** Deterministic valid 64-char hex fixture hash. */
const hex = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64)

const TASKS = Array.from({ length: 18 }, (_, index) => ({
  taskId: `h2-task-${String(index + 1).padStart(2, '0')}`,
  stratum: `stratum-${String((index % 6) + 1).padStart(2, '0')}`,
  promptSha256: hex(index * 4 + 1),
  workspaceSha256: hex(index * 4 + 2),
  referenceFixSha256: hex(index * 4 + 3),
  graderSha256: hex(index * 4 + 4),
}))

describe('H2 dataset commitment', () => {
  it('derives one immutable task digest from the task identity and content hashes', () => {
    const digest = buildTaskDigest(TASKS[0]!)
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true)
    expect(buildTaskDigest(TASKS[0]!)).toBe(digest)
    expect(buildTaskDigest({ ...TASKS[0]!, stratum: 'other' })).not.toBe(digest)
    expect(buildTaskDigest({ ...TASKS[0]!, promptSha256: TASKS[1]!.promptSha256 })).not.toBe(digest)
  })

  it('builds a deterministic dataset commitment over ordered task digests only', () => {
    const first = buildDatasetCommitment(TASKS)
    const second = buildDatasetCommitment(TASKS)
    expect(second.sha256).toBe(first.sha256)
    expect(first.projection).toHaveLength(18)
    expect(first.projection[0]).toEqual({ taskId: TASKS[0]!.taskId, stratum: TASKS[0]!.stratum, taskDigest: buildTaskDigest(TASKS[0]!) })
    expect(buildDatasetCommitment([...TASKS].reverse()).sha256).not.toBe(first.sha256)
  })

  it('verifies a matching commitment and fails closed on any mismatch', () => {
    const { sha256 } = buildDatasetCommitment(TASKS)
    expect(() => verifyDatasetCommitment({ tasks: TASKS, expectedSha256: sha256 })).not.toThrow()
    expect(() => verifyDatasetCommitment({ tasks: TASKS, expectedSha256: '0'.repeat(64) })).toThrow(/commitment/i)
    const tampered = TASKS.map((task, index) => index === 0 ? { ...task, workspaceSha256: 'f'.repeat(64) } : task)
    expect(() => verifyDatasetCommitment({ tasks: tampered, expectedSha256: sha256 })).toThrow(/commitment/i)
  })

  it('builds the public commitment record without any hidden content', () => {
    const record = buildCommitmentRecord({ tasks: TASKS, calibrationSha256: 'c'.repeat(64) })
    expect(record.schema).toBe('dsh-toolchain-h2-commitment-v1')
    expect(record.taskCount).toBe(18)
    expect(record.datasetSha256).toBe(buildDatasetCommitment(TASKS).sha256)
    // The public record contains hashes and identities only; never prompt
    // text, reference-fix content, or grader source.
    const serialized = JSON.stringify(record)
    for (const forbidden of ['prompt text', 'reference fix', 'module.exports']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(record.tasks.every(task => Array.isArray(task) && task.length === 3)).toBe(true)
  })

  it('rejects non-hex content hashes when building task digests', () => {
    expect(() => buildTaskDigest({ ...TASKS[0]!, graderSha256: 'not-hex' })).toThrow(/sha256/i)
  })
})