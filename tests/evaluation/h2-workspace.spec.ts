import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { directoryDigest } from '../../scripts/eval/h2/h2-util.mjs'
import {
  assertArtifactRootInsideRepo,
  assertIsolatedDshHome,
  assertObservationRunRemoved,
  cleanupObservation,
  materializeWorkspace,
  observationLayout,
  observationRunRoot,
  prepareObservationDir,
} from '../../scripts/eval/h2/h2-workspace.mjs'

const SEED_WORKSPACE = resolve('tests/evaluation/fixtures/h2/corpus-seed/workspaces/h2-exact-target-api-90')
/**
 * Owned trees may not live in the system temp directory — that is a protected
 * subtree the deletion guard refuses — so the tests build their artifact root
 * inside the repository, exactly as a real run does.
 */
const TEST_ROOT = resolve('.artifacts/h2-workspace-tests')

function artifactRoot(name: string) {
  return join(TEST_ROOT, name)
}

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true })
})

describe('H2 observation layout', () => {
  it('gives every observation a fresh, fully separate environment', () => {
    const root = artifactRoot('layout')
    const layout = observationLayout({ artifactRoot: root, runId: 'run-1', taskId: 'h2-x-01', arm: 'B' })
    expect(layout.dshHome).toBe(join(layout.root, 'dsh-home'))
    expect(layout.workspaceDir).toBe(join(layout.root, 'workspace'))
    expect(layout.receiptsDir).toBe(join(layout.root, 'receipts'))
    expect(layout.root.startsWith(resolve(root))).toBe(true)
    const other = observationLayout({ artifactRoot: root, runId: 'run-1', taskId: 'h2-x-01', arm: 'C' })
    expect(other.root).not.toBe(layout.root)
  })

  it('rejects unsafe identifiers and unknown arms', () => {
    const root = artifactRoot('identifiers')
    expect(() => observationLayout({ artifactRoot: root, runId: '../escape', taskId: 't', arm: 'B' })).toThrow(/safe path segment/)
    expect(() => observationLayout({ artifactRoot: root, runId: 'r', taskId: 'a/b', arm: 'B' })).toThrow(/safe path segment/)
    expect(() => observationLayout({ artifactRoot: root, runId: 'r', taskId: 't', arm: 'A' })).toThrow(/arm/)
  })

  it('keeps the artifact root inside the repository', () => {
    expect(() => assertArtifactRootInsideRepo({ artifactRoot: '.artifacts/h2', repoRoot: process.cwd() })).not.toThrow()
    expect(() => assertArtifactRootInsideRepo({ artifactRoot: '../outside', repoRoot: process.cwd() })).toThrow(/inside the repository/)
  })

  it('refuses to touch real user DSH state', () => {
    expect(() => assertIsolatedDshHome(join(homedir(), '.dsh'))).toThrow(/aliases real user state/)
    expect(() => assertIsolatedDshHome(join(homedir(), '.dsh', 'profiles'))).toThrow(/aliases real user state/)
    const safe = join(TEST_ROOT, 'dsh-home')
    expect(assertIsolatedDshHome(safe, { artifactRoot: TEST_ROOT })).toBe(resolve(safe))
    expect(() => assertIsolatedDshHome(safe, { artifactRoot: join(TEST_ROOT, 'other') })).toThrow(/artifact root/)
  })

  it('creates and then removes a complete observation tree', async () => {
    const root = artifactRoot('cleanup')
    const layout = observationLayout({ artifactRoot: root, runId: 'run-2', taskId: 'h2-x-02', arm: 'C' })
    const { observation } = prepareObservationDir({ artifactRoot: root, runId: 'run-2', layout })
    expect(await directoryDigest(layout.receiptsDir)).toMatch(/^[0-9a-f]{64}$/)
    await writeFile(join(layout.receiptsDir, 'receipt.json'), '{}', 'utf8')

    cleanupObservation({ owned: observation })

    await expect(readFile(join(layout.receiptsDir, 'receipt.json'), 'utf8')).rejects.toThrow()
    expect(existsSync(layout.root)).toBe(false)
  })

  it('proves a run directory is gone and refuses to certify a survivor', async () => {
    const root = artifactRoot('survivor')
    const runRoot = observationRunRoot({ artifactRoot: root, runId: 'run-3' })
    expect(runRoot).toBe(resolve(root, 'run-3'))
    await expect(assertObservationRunRemoved({ artifactRoot: root, runId: 'run-3' })).resolves.toBe(true)
    // A retained sibling — workspace or receipt — is readable by the next agent
    // under test, so a survivor must stop the run rather than pass unnoticed.
    const layout = observationLayout({ artifactRoot: root, runId: 'run-3', taskId: 'h2-x-03', arm: 'B' })
    prepareObservationDir({ artifactRoot: root, runId: 'run-3', layout })
    await expect(assertObservationRunRemoved({ artifactRoot: root, runId: 'run-3' })).rejects.toThrow(/isolation violated/)
    await rm(runRoot, { recursive: true, force: true })
    await expect(assertObservationRunRemoved({ artifactRoot: root, runId: 'run-3' })).resolves.toBe(true)
  })
})

describe('H2 workspace materialization', () => {
  it('copies the hidden initial workspace and proves the committed digest', async () => {
    const root = artifactRoot('materialize')
    const layout = observationLayout({ artifactRoot: root, runId: 'run-4', taskId: 'h2-x-04', arm: 'B' })
    const { observation } = prepareObservationDir({ artifactRoot: root, runId: 'run-4', layout })
    const expected = await directoryDigest(SEED_WORKSPACE)

    const digest = await materializeWorkspace({
      owned: observation,
      targetRelativePath: 'workspace',
      sourceDir: SEED_WORKSPACE,
      expectedSha256: expected,
    })

    expect(digest).toBe(expected)
    expect(await readFile(join(layout.workspaceDir, 'index.mjs'), 'utf8')).toContain('broken = true')
  })

  it('fails closed when the materialized workspace does not match its committed digest', async () => {
    const root = artifactRoot('digest-mismatch')
    const layout = observationLayout({ artifactRoot: root, runId: 'run-5', taskId: 'h2-x-05', arm: 'B' })
    const { observation } = prepareObservationDir({ artifactRoot: root, runId: 'run-5', layout })

    await expect(materializeWorkspace({
      owned: observation,
      targetRelativePath: 'workspace',
      sourceDir: SEED_WORKSPACE,
      expectedSha256: '0'.repeat(64),
    })).rejects.toThrow(/digest mismatch/)
  })

  it('replaces any previous contents so observations cannot share state', async () => {
    const root = artifactRoot('replace')
    const layout = observationLayout({ artifactRoot: root, runId: 'run-6', taskId: 'h2-x-06', arm: 'B' })
    const { observation } = prepareObservationDir({ artifactRoot: root, runId: 'run-6', layout })
    await mkdir(layout.workspaceDir, { recursive: true })
    await writeFile(join(layout.workspaceDir, 'leftover.txt'), 'previous run', 'utf8')

    await materializeWorkspace({ owned: observation, targetRelativePath: 'workspace', sourceDir: SEED_WORKSPACE })

    await expect(readFile(join(layout.workspaceDir, 'leftover.txt'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(layout.workspaceDir, 'index.mjs'), 'utf8')).toContain('broken = true')
  })
})
