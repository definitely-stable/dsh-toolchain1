import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Audited deletion for every benchmark/evaluation tree.
 *
 * An evaluation that deletes a tree computes its target from paths, and a path
 * is exactly what a bug corrupts: a missing `runId`, a root resolved against an
 * unexpected cwd, or a coordinate that silently became the operator's DSH home.
 * A previous H2 run lost that home and no code path could be proven guilty
 * afterwards, which is the failure this module exists to make impossible rather
 * than unlikely.
 *
 * The rule is ownership, not arithmetic:
 *
 * - a tree becomes deletable only when this module created it and wrote an
 *   ownership marker inside it;
 * - a deletion requires that marker, a matching token for in-process removals,
 *   an unchanged real path, strict containment in the declared workspace root,
 *   and a target that neither is nor contains a protected root;
 * - child deletions are expressed *relative* to an owned tree, so an absolute
 *   path cannot become a deletion target by accident.
 *
 * Protected subtrees are refused outright: nothing inside the operator's DSH
 * home, the system temp directory, or a package-manager coordinate is ever
 * deleted, whatever the workspace root happens to be. The general home directory
 * is deliberately not a protected subtree, because a checkout legitimately lives
 * under it (on the operator machine and on a GitHub runner alike) — the
 * containment rule is what keeps a deletion inside the owned artifact tree.
 *
 * The guard is fail-closed: an unowned directory is never deleted, not even to
 * "clean up" a previous crash. A leftover tree without a marker is a loud error
 * for the operator, not something the benchmark removes.
 */

export const OWNED_TREE_MARKER = '.eval-owner.json'
export const OWNED_TREE_SCHEMA = 'dsh-toolchain-owned-tree-v1'

/** Minimum number of path segments a deletion target must have. */
const MINIMUM_TARGET_DEPTH = 3

/**
 * Roots that must never be a deletion target themselves, and never contain one.
 * A deletion beneath them is refused separately, through `subtrees`.
 *
 * @param {{env?: Record<string, string | undefined>, extra?: readonly string[]}} [input]
 */
export function resolveProtectedRoots({ env = process.env, extra = [] } = {}) {
  const roots = new Set()
  const add = value => {
    if (typeof value === 'string' && value.trim().length > 0) roots.add(resolve(value))
  }
  add(homedir())
  add(tmpdir())
  for (const key of ['USERPROFILE', 'HOME', 'DSH_HOME', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'PNPM_HOME']) {
    add(env[key])
  }
  add(join(homedir(), '.dsh'))
  for (const root of extra) add(root)
  return Object.freeze([...roots])
}

/**
 * Subtrees that must never be deleted into, whatever the caller's workspace root
 * is. `~/.dsh` and the temp directory are the two places a losing incident
 * actually damages; the package-manager coordinates are where a runaway cache
 * cleanup does its harm.
 *
 * @param {{env?: Record<string, string | undefined>}} [input]
 */
export function resolveProtectedSubtrees({ env = process.env } = {}) {
  const subtrees = new Set([join(homedir(), '.dsh')])
  for (const key of ['DSH_HOME', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'PNPM_HOME']) {
    const value = env[key]
    if (typeof value === 'string' && value.trim().length > 0) subtrees.add(resolve(value))
  }
  return Object.freeze([...subtrees])
}

/**
 * @param {string} candidate
 * @param {string} root
 */
function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * @param {string} value
 */
function segmentCount(value) {
  return resolve(value).split(sep).filter(segment => segment.length > 0).length
}

/**
 * Rejects every deletion target that is not provably a tree this module created
 * inside the declared workspace root.
 *
 * @param {{target: string, workspaceRoot: string, protectedRoots?: readonly string[],
 *   protectedSubtrees?: readonly string[], minimumDepth?: number}} input
 */
export function assertDeletableTarget({
  target,
  workspaceRoot,
  protectedRoots = resolveProtectedRoots(),
  protectedSubtrees = resolveProtectedSubtrees(),
  minimumDepth = MINIMUM_TARGET_DEPTH,
}) {
  if (typeof target !== 'string' || target.trim().length === 0) throw new Error('deletion target must be a non-empty path')
  if (!isAbsolute(target)) throw new Error(`deletion target must be absolute: ${target}`)
  if (/[*?]/.test(target)) throw new Error(`deletion target must not contain wildcard characters: ${target}`)
  if (target.split(/[/\\]/).includes('..')) throw new Error(`deletion target must not contain parent segments: ${target}`)

  const resolvedTarget = resolve(target)
  const resolvedRoot = resolve(workspaceRoot)
  if (resolvedTarget === resolvedRoot) throw new Error('deletion target must not be the workspace root itself')
  if (!isInside(resolvedTarget, resolvedRoot)) {
    throw new Error(`deletion target must live inside the owned workspace root (${resolvedTarget} is not inside ${resolvedRoot})`)
  }
  if (segmentCount(resolvedTarget) < minimumDepth) {
    throw new Error(`deletion target is too shallow to be an owned tree: ${resolvedTarget}`)
  }

  const realRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot
  const realTarget = existsSync(resolvedTarget) ? realpathSync(resolvedTarget) : resolvedTarget
  if (realTarget !== resolvedTarget) {
    throw new Error(`deletion target resolves through a link and cannot be trusted: ${resolvedTarget} -> ${realTarget}`)
  }
  if (!isInside(realTarget, realRoot)) {
    throw new Error(`deletion target escapes the real workspace root (${realTarget} is not inside ${realRoot})`)
  }

  for (const subtree of protectedSubtrees) {
    const root = resolve(subtree)
    if (realTarget === root || isInside(realTarget, root)) {
      throw new Error(`refusing to delete ${realTarget}: it is inside the protected subtree ${root}`)
    }
  }
  for (const root of protectedRoots) {
    const resolved = resolve(root)
    if (realTarget === resolved) throw new Error(`refusing to delete the protected root ${resolved}`)
    if (isInside(resolved, realTarget)) {
      throw new Error(`refusing to delete ${realTarget}: it contains the protected root ${resolved}`)
    }
  }
  return resolvedTarget
}

/**
 * Creates (or re-creates) an owned tree and returns the only handle that can
 * delete it.
 *
 * `reset` exists for callers that reuse a deterministic directory name, such as
 * the authoring checks. It still refuses to touch a directory that carries no
 * ownership marker: a tree this benchmark did not create is never deleted.
 *
 * @param {{workspaceRoot: string, dir: string, kind: string, runId: string,
 *   protectedRoots?: readonly string[], protectedSubtrees?: readonly string[], reset?: boolean}} input
 */
export function createOwnedTree({
  workspaceRoot,
  dir,
  kind,
  runId,
  protectedRoots = resolveProtectedRoots(),
  protectedSubtrees = resolveProtectedSubtrees(),
  reset = false,
}) {
  if (typeof kind !== 'string' || kind.length === 0) throw new Error('owned tree kind is required')
  if (typeof runId !== 'string' || runId.length === 0) throw new Error('owned tree runId is required')

  const resolvedRoot = resolve(workspaceRoot)
  assertWorkspaceRootAcceptable({ workspaceRoot: resolvedRoot, protectedRoots, protectedSubtrees })
  mkdirSync(resolvedRoot, { recursive: true })
  const resolvedDir = resolve(dir)
  assertDeletableTarget({ target: resolvedDir, workspaceRoot: resolvedRoot, protectedRoots, protectedSubtrees })

  if (existsSync(resolvedDir)) {
    if (!reset) throw new Error(`owned tree already exists: ${resolvedDir}`)
    assertOwnedByBenchmark({ dir: resolvedDir, workspaceRoot: resolvedRoot })
    rmSync(resolvedDir, { recursive: true, force: false })
  }
  mkdirSync(resolvedDir, { recursive: true })

  const markerPath = join(resolvedDir, OWNED_TREE_MARKER)
  const realDir = realpathSync(resolvedDir)
  const token = randomUUID()
  writeFileSync(markerPath, `${JSON.stringify({
    schema: OWNED_TREE_SCHEMA,
    token,
    kind,
    runId,
    workspaceRoot: resolvedRoot,
    realPath: realDir,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

  return Object.freeze({ schema: OWNED_TREE_SCHEMA, root: resolvedDir, realRoot: realDir, markerPath, token, kind, runId, workspaceRoot: resolvedRoot })
}

/**
 * The workspace root is where every deletion is confined, so it must not itself
 * be a protected root or live inside a protected subtree. That is the check
 * which stops a misconfigured artifact root (`~/.dsh`, `%TEMP%`) from turning
 * the ownership rule into a licence to delete real state.
 *
 * @param {{workspaceRoot: string, protectedRoots?: readonly string[], protectedSubtrees?: readonly string[]}} input
 */
export function assertWorkspaceRootAcceptable({
  workspaceRoot,
  protectedRoots = resolveProtectedRoots(),
  protectedSubtrees = resolveProtectedSubtrees(),
}) {
  const resolved = resolve(workspaceRoot)
  for (const subtree of protectedSubtrees) {
    const root = resolve(subtree)
    if (resolved === root || isInside(resolved, root)) {
      throw new Error(`refusing to use ${resolved} as an artifact workspace root: it is inside the protected subtree ${root}`)
    }
  }
  for (const root of protectedRoots) {
    const resolvedRoot = resolve(root)
    if (resolved === resolvedRoot) throw new Error(`refusing to use the protected root ${resolvedRoot} as an artifact workspace root`)
    if (isInside(resolvedRoot, resolved)) {
      throw new Error(`refusing to use ${resolved} as an artifact workspace root: it contains the protected root ${resolvedRoot}`)
    }
  }
  return resolved
}

/**
 * Proves that an existing directory was created by this benchmark, using only
 * durable evidence. In-process removals additionally require the token; this is
 * the weaker check a `reset` of a deterministic name must rely on.
 *
 * @param {{dir: string, workspaceRoot: string}} input
 */
export function assertOwnedByBenchmark({ dir, workspaceRoot }) {
  const markerPath = join(resolve(dir), OWNED_TREE_MARKER)
  if (!existsSync(markerPath)) {
    throw new Error(`refusing to delete an unowned directory (${resolve(dir)} has no ${OWNED_TREE_MARKER}): remove it manually after checking why it is there`)
  }
  let marker
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  } catch (error) {
    throw new Error(`owned tree marker is unreadable at ${markerPath}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (marker?.schema !== OWNED_TREE_SCHEMA) throw new Error(`owned tree marker schema mismatch at ${markerPath}`)
  if (resolve(marker.workspaceRoot) !== resolve(workspaceRoot)) {
    throw new Error(`owned tree marker belongs to a different workspace root (${marker.workspaceRoot})`)
  }
  const realDir = realpathSync(resolve(dir))
  if (marker.realPath !== realDir) throw new Error(`owned tree marker does not describe this directory: ${markerPath}`)
  return marker
}

/**
 * Appends a deletion record. The journal is the audit trail an operator reads
 * after a run; nothing else in the benchmark is allowed to delete trees.
 *
 * @param {{runId?: string | null}} [input]
 */
export function createDeletionJournal({ runId = null } = {}) {
  const records = []
  return Object.freeze({
    runId,
    record(entry) {
      records.push(Object.freeze({ at: new Date().toISOString(), runId, ...entry }))
    },
    entries() {
      return records.map(entry => ({ ...entry }))
    },
  })
}

/**
 * Deletes an owned tree. This is the only recursive deletion in the benchmark.
 *
 * @param {{handle: any, protectedRoots?: readonly string[], protectedSubtrees?: readonly string[],
 *   journal?: {record: (entry: any) => void} | null}} input
 */
export function removeOwnedTree({ handle, protectedRoots, protectedSubtrees, journal = null }) {
  const checked = assertHandle({ handle })
  assertDeletableTarget({ target: checked.root, workspaceRoot: checked.workspaceRoot, protectedRoots, protectedSubtrees })
  const marker = assertOwnedByBenchmark({ dir: checked.root, workspaceRoot: checked.workspaceRoot })
  if (marker.token !== checked.token) {
    throw new Error(`owned tree token mismatch at ${checked.root}: the tree was re-created by another process`)
  }
  if (marker.kind !== checked.kind || marker.runId !== checked.runId) {
    throw new Error(`owned tree identity mismatch at ${checked.root}: marker says ${marker.kind}/${marker.runId}`)
  }
  rmSync(checked.root, { recursive: true, force: false })
  if (existsSync(checked.root)) throw new Error(`owned tree survived its deletion: ${checked.root}`)
  journal?.record({ action: 'remove-tree', root: checked.root, kind: checked.kind, runId: checked.runId })
  return { removed: true, root: checked.root }
}

/**
 * Deletes a child of an owned tree. The target is relative, so a caller can
 * never express an absolute path here, and the owned parent supplies the
 * containment and ownership authority.
 *
 * @param {{handle: any, relativePath: string, protectedRoots?: readonly string[],
 *   protectedSubtrees?: readonly string[], journal?: {record: (entry: any) => void} | null}} input
 */
export function removeOwnedChild({ handle, relativePath, protectedRoots, protectedSubtrees, journal = null }) {
  const target = resolveOwnedChild({ handle, relativePath, protectedRoots, protectedSubtrees })
  if (!existsSync(target)) return { removed: false, root: target }
  rmSync(target, { recursive: true, force: false })
  if (existsSync(target)) throw new Error(`owned child survived its deletion: ${target}`)
  journal?.record({ action: 'remove-child', root: target, parent: resolve(handle.root) })
  return { removed: true, root: target }
}

/**
 * Removes and re-creates a child of an owned tree, for callers that need an
 * empty directory at a stable path (workspace materialization).
 *
 * @param {{handle: any, relativePath: string, protectedRoots?: readonly string[],
 *   protectedSubtrees?: readonly string[]}} input
 */
export function resetOwnedChild({ handle, relativePath, protectedRoots, protectedSubtrees }) {
  const target = resolveOwnedChild({ handle, relativePath, protectedRoots, protectedSubtrees })
  if (existsSync(target)) rmSync(target, { recursive: true, force: false })
  mkdirSync(target, { recursive: true })
  return target
}

/**
 * @param {{handle: any, relativePath: string, protectedRoots?: readonly string[],
 *   protectedSubtrees?: readonly string[]}} input
 */
function resolveOwnedChild({ handle, relativePath, protectedRoots, protectedSubtrees }) {
  const checked = assertHandle({ handle })
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) throw new Error('owned child path must be a non-empty relative path')
  if (isAbsolute(relativePath)) throw new Error(`owned child path must be relative: ${relativePath}`)
  if (relativePath.split(/[/\\]/).includes('..')) throw new Error(`owned child path must not contain parent segments: ${relativePath}`)
  const target = resolve(checked.root, relativePath)
  assertDeletableTarget({ target, workspaceRoot: checked.workspaceRoot, protectedRoots, protectedSubtrees })
  return target
}

/**
 * @param {{handle: any}} input
 */
function assertHandle({ handle }) {
  if (handle === null || typeof handle !== 'object') throw new Error('an owned tree handle is required')
  if (handle.schema !== OWNED_TREE_SCHEMA) throw new Error('owned tree handle schema mismatch')
  for (const key of ['root', 'workspaceRoot', 'token', 'kind', 'runId']) {
    if (typeof handle[key] !== 'string' || handle[key].length === 0) throw new Error(`owned tree handle is missing ${key}`)
  }
  return handle
}

/** Ensures a directory exists without deleting anything. */
export function ensureDirectory(dir) {
  mkdirSync(dir, { recursive: true })
  return resolve(dir)
}
