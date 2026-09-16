import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import { directoryDigest } from './h2-util.mjs'

export const H2_ARTIFACT_ROOT = '.artifacts/h2'

/**
 * Per-observation layout. Every observation gets a completely fresh
 * environment: its own DSH home, workspace, scratch area, and receipts.
 *
 * @typedef {object} H2ObservationLayout
 * @property {string} root
 * @property {string} dshHome
 * @property {string} workspaceDir
 * @property {string} scratchDir
 * @property {string} receiptsDir
 */

/** @returns {H2ObservationLayout} */
export function observationLayout({ artifactRoot = H2_ARTIFACT_ROOT, runId, taskId, arm }) {
  assertIdentifier(taskId, 'taskId')
  if (arm !== 'B' && arm !== 'C') throw new Error('H2 observation arm must be B or C')
  const root = join(observationRunRoot({ artifactRoot, runId }), taskId, arm)
  return Object.freeze({
    root,
    dshHome: join(root, 'dsh-home'),
    workspaceDir: join(root, 'workspace'),
    scratchDir: join(root, 'scratch'),
    receiptsDir: join(root, 'receipts'),
  })
}

/**
 * The run directory that holds every observation of one run.
 *
 * @param {{artifactRoot?: string, runId: string}} input
 */
export function observationRunRoot({ artifactRoot = H2_ARTIFACT_ROOT, runId }) {
  assertIdentifier(runId, 'runId')
  return resolve(artifactRoot, runId)
}

/**
 * The artifact root must live inside the repository so H2 can never write
 * outside the checkout, and never into a user DSH home.
 */
export function assertArtifactRootInsideRepo({ artifactRoot, repoRoot }) {
  const root = resolve(repoRoot, artifactRoot)
  const base = resolve(repoRoot)
  if (root !== base && !root.startsWith(`${base}${sep}`)) {
    throw new Error('H2 artifacts must stay inside the repository workspace')
  }
  return root
}

/**
 * Refuses any observation DSH home that could alias real user state. H2 must
 * never read or mutate the operator's `~/.dsh`.
 *
 * @param {string} dshHome
 * @param {{forbiddenHomes?: string[], artifactRoot?: string}} [options]
 */
export function assertIsolatedDshHome(dshHome, { forbiddenHomes = [], artifactRoot } = {}) {
  const resolved = resolve(dshHome)
  const forbidden = [
    resolve(homedir(), '.dsh'),
    ...(process.env.DSH_HOME ? [resolve(process.env.DSH_HOME)] : []),
    ...forbiddenHomes.map(home => resolve(home)),
  ]
  for (const blocked of forbidden) {
    if (resolved === blocked || resolved.startsWith(`${blocked}${sep}`) || blocked.startsWith(`${resolved}${sep}`)) {
      throw new Error(`H2 observation DSH home aliases real user state: ${resolved}`)
    }
  }
  if (artifactRoot !== undefined && !resolved.startsWith(`${resolve(artifactRoot)}${sep}`)) {
    throw new Error('H2 observation DSH home must live under the observation artifact root')
  }
  return resolved
}

/** Creates (or resets) the observation directory tree. */
export async function prepareObservationDir(layout) {
  await rm(layout.root, { recursive: true, force: true })
  for (const dir of [layout.dshHome, layout.workspaceDir, layout.scratchDir, layout.receiptsDir]) {
    await mkdir(dir, { recursive: true })
  }
  assertIsolatedDshHome(layout.dshHome, { artifactRoot: resolve(layout.root, '..', '..', '..') })
  return layout
}

/**
 * Copies one hidden initial workspace into the observation and proves the
 * copy matches the committed corpus digest before any model token is spent.
 * A mismatch is a fail-closed dataset/workspace integrity failure.
 *
 * `expectedSha256` is optional so callers without a commitment to hand (the
 * authoring tools) can materialize a workspace for inspection.
 *
 * @param {{sourceDir: string, targetDir: string, expectedSha256?: string | null}} input
 */
export async function materializeWorkspace({ sourceDir, targetDir, expectedSha256 }) {
  const source = resolve(sourceDir)
  const target = resolve(targetDir)
  const info = await stat(source)
  if (!info.isDirectory()) throw new Error(`H2 initial workspace is not a directory: ${source}`)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(source, target, { recursive: true, errorOnExist: false })
  const digest = await directoryDigest(target)
  if (expectedSha256 !== undefined && digest !== expectedSha256) {
    throw new Error(`H2 workspace digest mismatch: expected ${expectedSha256}, materialized ${digest}`)
  }
  return digest
}

/** Removes an observation directory (cleanup is attempted on every path). */
export async function cleanupObservation(layout) {
  await rm(layout.root, { recursive: true, force: true })
}

/**
 * Removes only the heavy, disposable parts of an observation (the DSH home
 * with its profile package graph and the scratch area) while retaining the
 * workspace and receipts for auditability.
 */
export async function cleanupObservationScratch(layout) {
  await rm(layout.dshHome, { recursive: true, force: true })
  await rm(layout.scratchDir, { recursive: true, force: true })
}

/** Applies the frozen cleanup policy: `scratch` (default), `full`, or `none`. */
export async function applyCleanupPolicy(layout, mode = 'scratch') {
  if (mode === 'full') {
    await cleanupObservation(layout)
    return mode
  }
  if (mode === 'scratch') {
    await cleanupObservationScratch(layout)
    return mode
  }
  if (mode === 'none') return mode
  throw new Error(`unknown H2 cleanup mode: ${mode}`)
}

/**
 * Proves that nothing of a run's observations is left on disk.
 *
 * Deferred retention rests on the absence of reachable bytes, not on a
 * boundary: the target train fences writes but not reads, so a workspace that
 * outlives its observation — and it contains a working solution to the very
 * task — or a receipt that outlives it (outcome label, schedule position) is
 * readable by the next agent under test and would couple the paired arms the
 * McNemar test consumes. Empty run directories are removed too, because their
 * task/arm names still disclose which observations have already run. The
 * deletion is verified rather than assumed, and a surviving tree stops the run
 * instead of quietly poisoning it.
 *
 * @param {{artifactRoot?: string, runId: string}} input
 */
export async function assertObservationRunRemoved({ artifactRoot, runId }) {
  const root = observationRunRoot({ artifactRoot, runId })
  if (existsSync(root)) {
    throw new Error(
      `H2 isolation violated: the run directory survived an observation at ${root}. `
      + 'A retained sibling workspace or receipt is readable by the next agent under test, so the paired arms would not be independent.',
    )
  }
  return true
}

/** Re-exported content digest so callers do not import two H2 modules for one job. */
export async function directoryDigestFrom(dir) {
  return directoryDigest(dir)
}

/** Relative, POSIX-style path of an observation file (for receipts). */
export function relativeObservationPath(layout, absolute) {
  return relative(layout.root, absolute).split(sep).join('/')
}

/** Reads a directory listing sorted deterministically (test/introspection helper). */
export async function listObservationEntries(dir) {
  return (await readdir(dir)).sort()
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`H2 ${label} must be a safe path segment`)
  }
}