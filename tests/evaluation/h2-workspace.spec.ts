import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { directoryDigest } from '../../scripts/eval/h2/h2-util.mjs'
import {
  assertArtifactRootInsideRepo,
  assertIsolatedDshHome,
  cleanupObservation,
  materializeWorkspace,
  observationLayout,
  prepareObservationDir,
} from '../../scripts/eval/h2/h2-workspace.mjs'

const SEED_WORKSPACE = resolve('tests/evaluation/fixtures/h2/corpus-seed/workspaces/h2-exact-target-api-90')
let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-workspace-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-workspace-test-'))
})

describe('H2 observation layout', () => {
  it('gives every observation a fresh, fully separate environment', () => {
    const layout = observationLayout({ artifactRoot: tmpRoot, runId: 'run-1', taskId: 'h2-x-01', arm: 'B' })
    expect(layout.dshHome).toBe(join(layout.root, 'dsh-home'))
    expect(layout.workspaceDir).toBe(join(layout.root, 'workspace'))
    expect(layout.receiptsDir).toBe(join(layout.root, 'receipts'))
    expect(layout.root.startsWith(resolve(tmpRoot))).toBe(true)
    const other = observationLayout({ artifactRoot: tmpRoot, runId: 'run-1', taskId: 'h2-x-01', arm: 'C' })
    expect(other.root).not.toBe(layout.root)
  })

  it('rejects unsafe identifiers and unknown arms', () => {
    expect(() => observationLayout({ artifactRoot: tmpRoot, runId: '../escape', taskId: 't', arm: 'B' })).toThrow(/safe path segment/)
    expect(() => observationLayout({ artifactRoot: tmpRoot, runId: 'r', taskId: 'a/b', arm: 'B' })).toThrow(/safe path segment/)
    expect(() => observationLayout({ artifactRoot: tmpRoot, runId: 'r', taskId: 't', arm: 'A' })).toThrow(/arm/)
  })

  it('keeps the artifact root inside the repository', () => {
    expect(() => assertArtifactRootInsideRepo({ artifactRoot: '.artifacts/h2', repoRoot: process.cwd() })).not.toThrow()
    expect(() => assertArtifactRootInsideRepo({ artifactRoot: '../outside', repoRoot: process.cwd() })).toThrow(/inside the repository/)
  })

  it('refuses to touch real user DSH state', () => {
    expect(() => assertIsolatedDshHome(join(homedir(), '.dsh'))).toThrow(/aliases real user state/)
    expect(() => assertIsolatedDshHome(join(homedir(), '.dsh', 'profiles'))).toThrow(/aliases real user state/)
    const safe = join(tmpRoot, 'dsh-home')
    expect(assertIsolatedDshHome(safe, { artifactRoot: tmpRoot })).toBe(resolve(safe))
    expect(() => assertIsolatedDshHome(safe, { artifactRoot: join(tmpRoot, 'other') })).toThrow(/artifact root/)
  })

  it('creates and then removes a complete observation tree', async () => {
    const layout = observationLayout({ artifactRoot: tmpRoot, runId: 'run-2', taskId: 'h2-x-02', arm: 'C' })
    await prepareObservationDir(layout)
    expect(await directoryDigest(layout.receiptsDir)).toMatch(/^[0-9a-f]{64}$/)
    await writeFile(join(layout.receiptsDir, 'receipt.json'), '{}', 'utf8')
    await cleanupObservation(layout)
    await expect(readFile(join(layout.receiptsDir, 'receipt.json'), 'utf8')).rejects.toThrow()
  })
})

describe('H2 workspace materialization', () => {
  it('copies the hidden initial workspace and proves the committed digest', async () => {
    const expected = await directoryDigest(SEED_WORKSPACE)
    const target = join(tmpRoot, 'materialized')
    const digest = await materializeWorkspace({ sourceDir: SEED_WORKSPACE, targetDir: target, expectedSha256: expected })
    expect(digest).toBe(expected)
    expect(await readFile(join(target, 'index.mjs'), 'utf8')).toContain('broken = true')
  })

  it('fails closed when the materialized workspace does not match its committed digest', async () => {
    const target = join(tmpRoot, 'bad-copy')
    await expect(materializeWorkspace({ sourceDir: SEED_WORKSPACE, targetDir: target, expectedSha256: '0'.repeat(64) }))
      .rejects.toThrow(/digest mismatch/)
  })

  it('replaces any previous contents so observations cannot share state', async () => {
    const target = join(tmpRoot, 'reused')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'leftover.txt'), 'previous run', 'utf8')
    await materializeWorkspace({ sourceDir: SEED_WORKSPACE, targetDir: target })
    await expect(readFile(join(target, 'leftover.txt'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(target, 'index.mjs'), 'utf8')).toContain('broken = true')
  })
})