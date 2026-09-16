import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { H2_COMMITMENT_SCHEMA, assertCommitmentRecord } from '../../scripts/eval/h2/h2-commitment.mjs'
import { H2_POLICY, H2_STRATA } from '../../scripts/eval/h2/h2-config.mjs'

const H2_DOCS = resolve('docs/evaluation/h2')
const COMMITMENT = join(H2_DOCS, 'h2-commitment-v1.json')

describe('H2 repository safety', () => {
  it('keeps the private dataset path out of Git', async () => {
    const gitignore = await readFile(resolve('.gitignore'), 'utf8')
    expect(gitignore.split(/\r?\n/)).toContain('.artifacts/')
  })

  it('publishes a commitment record that carries hashes only, never hidden content', async () => {
    expect(existsSync(COMMITMENT)).toBe(true)
    const record = JSON.parse(await readFile(COMMITMENT, 'utf8'))
    expect(record.schema).toBe(H2_COMMITMENT_SCHEMA)
    assertCommitmentRecord(record)
    expect(record.taskCount).toBe(H2_POLICY.taskCount)
    for (const task of record.tasks) {
      expect(task).toHaveLength(3)
      expect(H2_STRATA).toContain(task[1])
      expect(String(task[2])).toMatch(/^[0-9a-f]{64}$/)
    }
    const serialized = JSON.stringify(record)
    // The public record must not embed prompts, reference patches, or grader
    // bodies; it is identities and SHA-256 commitments only.
    expect(serialized).not.toMatch(/mustContain|expectRows|export const grader|# Fix the/)
  })

  it('ships only public H2 artifacts under docs/evaluation/h2', async () => {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(H2_DOCS)
    expect(entries).toContain('h2-design-preregistration.md')
    expect(entries).toContain('calibration')
    expect(entries).not.toContain('prompts')
    expect(entries).not.toContain('graders')
    expect(entries).not.toContain('reference-fixes')
    expect(entries).not.toContain('workspaces')
  })

  it('keeps graders declarative and free of an oracle shortcut', async () => {
    const { assertGraderIndependence } = await import('../../scripts/eval/h2/h2-grader.mjs')
    const grader = await readFile(join(H2_DOCS, 'calibration', 'grader.mjs'), 'utf8')
    expect(() => assertGraderIndependence(grader)).not.toThrow()
    for (const forbidden of ['dsh-toolchain', 'toolchain_', 'fetch(', 'import ']) {
      expect(grader).not.toContain(forbidden)
    }
  })

  it('never schedules paid H2 work in CI', async () => {
    const { readdir } = await import('node:fs/promises')
    const workflows = await readdir(resolve('.github/workflows'))
    for (const name of workflows) {
      const text = await readFile(join('.github/workflows', name), 'utf8')
      expect(text).not.toMatch(/h2:run|h2:dry-run|h2-cli\.mjs (run|dry-run)/)
    }
    const ci = await readFile(join('.github/workflows', 'ci.yml'), 'utf8')
    expect(ci).toContain('h2-cli.mjs validate --public-only')
  })
})