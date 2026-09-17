import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  OWNED_TREE_MARKER,
  assertDeletableTarget,
  assertOwnedByBenchmark,
  assertWorkspaceRootAcceptable,
  createDeletionJournal,
  createOwnedTree,
  removeOwnedChild,
  removeOwnedTree,
  resetOwnedChild,
  resolveProtectedRoots,
} from '../../scripts/eval/safety/owned-tree.mjs'

/**
 * The artifact root must live inside the repository, exactly as the H2 harness
 * requires, so the tests exercise the containment situation a real run has.
 */
const TEST_ROOT = resolve('.artifacts/owned-tree-tests')
const WORKSPACE_ROOT = join(TEST_ROOT, 'workspace')

function freshTree(name: string, kind = 'observation') {
  return createOwnedTree({ workspaceRoot: WORKSPACE_ROOT, dir: join(WORKSPACE_ROOT, name), kind, runId: 'run-1' })
}

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('owned tree lifecycle', () => {
  it('creates a tree with an ownership marker and deletes only that tree', () => {
    const handle = freshTree('create-1')
    expect(existsSync(join(handle.root, OWNED_TREE_MARKER))).toBe(true)
    writeFileSync(join(handle.root, 'payload.txt'), 'data')
    const journal = createDeletionJournal({ runId: 'run-1' })

    const result = removeOwnedTree({ handle, journal })

    expect(result.removed).toBe(true)
    expect(existsSync(handle.root)).toBe(false)
    expect(journal.entries()).toHaveLength(1)
    expect(journal.entries()[0]).toMatchObject({ action: 'remove-tree', kind: 'observation', runId: 'run-1' })
  })

  it('refuses to delete a directory it did not create, even when asked to reset it', () => {
    const unowned = join(WORKSPACE_ROOT, 'unowned-1')
    mkdirSync(unowned, { recursive: true })
    writeFileSync(join(unowned, 'precious.txt'), 'operator data')

    expect(() => createOwnedTree({ workspaceRoot: WORKSPACE_ROOT, dir: unowned, kind: 'observation', runId: 'run-1', reset: true }))
      .toThrow(/unowned directory/)
    expect(existsSync(join(unowned, 'precious.txt'))).toBe(true)
    rmSync(unowned, { recursive: true, force: true })
  })

  it('refuses a handle whose tree was re-created by another process', () => {
    const first = freshTree('token-1')
    const second = createOwnedTree({ workspaceRoot: WORKSPACE_ROOT, dir: first.root, kind: 'observation', runId: 'run-1', reset: true })

    expect(() => removeOwnedTree({ handle: first })).toThrow(/token mismatch/)
    removeOwnedTree({ handle: second })
  })

  it('refuses when the marker no longer describes the directory', () => {
    const handle = freshTree('marker-1')
    const markerPath = join(handle.root, OWNED_TREE_MARKER)
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    writeFileSync(markerPath, JSON.stringify({ ...marker, realPath: '/somewhere/else' }))

    expect(() => assertOwnedByBenchmark({ dir: handle.root, workspaceRoot: WORKSPACE_ROOT })).toThrow(/does not describe this directory/)
    rmSync(handle.root, { recursive: true, force: true })
  })
})

describe('deletion target guards', () => {
  const protectedRoots = resolveProtectedRoots()
  const input = { workspaceRoot: WORKSPACE_ROOT, protectedRoots, protectedSubtrees: [] as string[] }

  it('refuses relative, empty, wildcard, and parent-escaping targets', () => {
    for (const target of ['', 'relative/path', join(WORKSPACE_ROOT, 'a', '*'), join(WORKSPACE_ROOT, '..', 'escape', 'deep')]) {
      expect(() => assertDeletableTarget({ ...input, target })).toThrow(/deletion target/)
    }
  })

  it('refuses the workspace root itself and paths outside it', () => {
    expect(() => assertDeletableTarget({ ...input, target: WORKSPACE_ROOT })).toThrow(/workspace root itself/)
    expect(() => assertDeletableTarget({ ...input, target: join(TEST_ROOT, 'sibling', 'deep') })).toThrow(/inside the owned workspace root/)
  })

  it('refuses a target inside a protected subtree', () => {
    const subtree = join(WORKSPACE_ROOT, 'protected-child')
    expect(() => assertDeletableTarget({
      workspaceRoot: WORKSPACE_ROOT,
      target: join(subtree, 'inner', 'deep'),
      protectedRoots,
      protectedSubtrees: [subtree],
    })).toThrow(/protected subtree/)
  })

  it('refuses a target that is a protected root', () => {
    const precious = join(WORKSPACE_ROOT, 'precious-root')
    expect(() => assertDeletableTarget({ workspaceRoot: WORKSPACE_ROOT, target: precious, protectedRoots: [precious], protectedSubtrees: [] }))
      .toThrow(/protected root/)
  })

  it('refuses a target that contains a protected root', () => {
    const inner = join(WORKSPACE_ROOT, 'level-a', 'level-b')
    expect(() => assertDeletableTarget({
      workspaceRoot: WORKSPACE_ROOT,
      target: join(WORKSPACE_ROOT, 'level-a'),
      protectedRoots: [inner],
      protectedSubtrees: [],
    })).toThrow(/contains the protected root/)
  })
})

describe('workspace root guards', () => {
  it('refuses the operator DSH home and the temp directory as artifact roots', () => {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
    const candidates = [join(home, '.dsh'), join(home, '.dsh', 'profiles'), process.env.TEMP ?? '', home]
    let checked = 0
    for (const candidate of candidates) {
      if (candidate.length === 0 || candidate === '.dsh') continue
      checked += 1
      expect(() => assertWorkspaceRootAcceptable({ workspaceRoot: candidate })).toThrow(/refusing to use/)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('accepts a repository-local artifact root even when the checkout lives inside the home directory', () => {
    expect(assertWorkspaceRootAcceptable({ workspaceRoot: WORKSPACE_ROOT })).toBe(resolve(WORKSPACE_ROOT))
  })
})

describe('owned children', () => {
  it('deletes and re-creates children by relative path only', () => {
    const handle = freshTree('children-1')
    writeFileSync(join(handle.root, 'workspace.txt'), 'x')
    const journal = createDeletionJournal({ runId: 'run-1' })

    expect(() => removeOwnedChild({ handle, relativePath: resolve(handle.root, 'workspace.txt') })).toThrow(/must be relative/)
    expect(() => removeOwnedChild({ handle, relativePath: 'nested/../../escape' })).toThrow(/parent segments/)

    expect(removeOwnedChild({ handle, relativePath: 'workspace.txt', journal }).removed).toBe(true)
    expect(existsSync(join(handle.root, 'workspace.txt'))).toBe(false)

    const recreated = resetOwnedChild({ handle, relativePath: 'scratch' })
    expect(existsSync(recreated)).toBe(true)
    writeFileSync(join(recreated, 'leftover.txt'), 'x')
    resetOwnedChild({ handle, relativePath: 'scratch' })
    expect(existsSync(join(recreated, 'leftover.txt'))).toBe(false)

    removeOwnedTree({ handle })
  })
})
