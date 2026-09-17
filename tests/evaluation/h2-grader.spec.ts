import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  assertGraderIndependence,
  runAuthorCheck,
  runGrader,
  validateGrader,
} from '../../scripts/eval/h2/h2-grader.mjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GRADER = {
  static: [
    { id: 'fix-applied', file: 'index.mjs', mustContain: ['broken = false'], mustNotContain: ['leakedSecret'] },
    { id: 'no-legacy-api', file: 'index.mjs', regex: [{ pattern: 'legacyApi', expected: false }] },
  ],
  build: { nodeCheck: ['index.mjs'] },
  compose: { expectRows: [{ id: 'fixture-plugin', name: 'fixture-plugin' }] },
  runtime: { services: ['fixtureService'], tools: ['fixture_tool'] },
}

let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-grader-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-grader-test-'))
})

async function writeWorkspace(name: string, source: string): Promise<string> {
  const dir = join(tmpRoot, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'index.mjs'), source, 'utf8')
  return dir
}

const failingCompose = async () => ({ ok: false, detail: 'row missing' })
const passingCompose = async () => ({ ok: true })

describe('H2 grader engine', () => {
  it('passes only when every declared check passes', async () => {
    const workspace = await writeWorkspace('good', 'export const broken = false\n')
    const result = await runGrader({
      workspaceDir: workspace,
      grader: GRADER,
      io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) },
    })
    expect(result.status).toBe('pass')
    expect(result.checks.map(check => check.name)).toEqual([
      'static:fix-applied',
      'static:no-legacy-api',
      'build:node-check:index.mjs',
      'compose:dsh',
      'runtime:probe',
    ])
    expect(result.checks.every(check => check.status === 'pass')).toBe(true)
  })

  it('fails the static check when the fix is absent or the forbidden marker remains', async () => {
    const unfixed = await writeWorkspace('unfixed', 'export const broken = true\n')
    const unfixedResult = await runGrader({ workspaceDir: unfixed, grader: GRADER, io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) } })
    expect(unfixedResult.status).toBe('fail')
    expect(unfixedResult.checks[0]!.status).toBe('fail')

    const leaked = await writeWorkspace('leaked', 'export const broken = false\nconst leakedSecret = 1\n')
    const leakedResult = await runGrader({ workspaceDir: leaked, grader: GRADER, io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) } })
    expect(leakedResult.status).toBe('fail')
    expect(leakedResult.checks[0]!.detail).toContain('forbiddenPresent')

    const legacy = await writeWorkspace('legacy', 'export const broken = false\nlegacyApi()\n')
    const legacyResult = await runGrader({ workspaceDir: legacy, grader: GRADER, io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) } })
    expect(legacyResult.status).toBe('fail')
    expect(legacyResult.checks[1]!.status).toBe('fail')
  })

  it('fails closed when a real syntax error is present', async () => {
    const broken = await writeWorkspace('syntax', 'export const = broken(\n')
    const result = await runGrader({ workspaceDir: broken, grader: GRADER, io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) } })
    expect(result.status).toBe('fail')
    expect(result.checks.find(check => check.name.startsWith('build:'))?.status).toBe('fail')
  })

  it('reports composition and runtime failures instead of hiding them', async () => {
    const workspace = await writeWorkspace('compose-fail', 'export const broken = false\n')
    const composeFailure = await runGrader({ workspaceDir: workspace, grader: GRADER, io: { composeCheck: failingCompose, runtimeCheck: async () => ({ ok: true }) } })
    expect(composeFailure.status).toBe('fail')
    expect(composeFailure.checks.find(check => check.name === 'compose:dsh')?.detail).toContain('row missing')

    const runtimeFailure = await runGrader({
      workspaceDir: workspace,
      grader: GRADER,
      io: { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: false, detail: 'service missing' }) },
    })
    expect(runtimeFailure.status).toBe('fail')
    expect(runtimeFailure.checks.find(check => check.name === 'runtime:probe')?.detail).toContain('service missing')
  })

  it('throws when a declared check has no implementation available', async () => {
    const workspace = await writeWorkspace('no-io', 'export const broken = false\n')
    await expect(runGrader({ workspaceDir: workspace, grader: GRADER, io: {} })).rejects.toThrow(/composition check/)
    await expect(runGrader({
      workspaceDir: workspace,
      grader: { static: [{ id: 'x', file: 'index.mjs' }], runtime: { services: ['s'], tools: [] } },
      io: {},
    })).rejects.toThrow(/runtime assertions/)
  })

  it('is deterministic: identical inputs give identical verdicts and details', async () => {
    const workspace = await writeWorkspace('det', 'export const broken = false\n')
    const io = { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) }
    const first = await runGrader({ workspaceDir: workspace, grader: GRADER, io })
    const second = await runGrader({ workspaceDir: workspace, grader: GRADER, io })
    expect(second).toEqual(first)
  })
})

describe('H2 grader independence and admission', () => {
  it('rejects grader sources that import, spawn, call a model, or consult Toolchain', () => {
    expect(() => assertGraderIndependence("export const grader = { static: [] }\n")).not.toThrow()
    expect(() => assertGraderIndependence("import { x } from 'y'\n")).toThrow(/independence/)
    expect(() => assertGraderIndependence('const x = require("fs")\n')).toThrow(/independence/)
    expect(() => assertGraderIndependence('fetch("https://api.deepseek.com")\n')).toThrow(/independence/)
    expect(() => assertGraderIndependence("import { spawn } from 'child_process'\n")).toThrow(/independence/)
    expect(() => assertGraderIndependence('// uses dsh-toolchain plugin.verify\n')).toThrow(/independence/)
    expect(() => assertGraderIndependence('// calls toolchain_contract_search\n')).toThrow(/independence/)
    expect(() => assertGraderIndependence('const model = LLM\n')).toThrow(/independence/)
    // A declarative check id may legitimately contain the word "import"; the
    // guard must not reject the descriptor that describes an independence rule.
    expect(() => assertGraderIndependence('{ "id": "no-host-runtime-import", "mustNotContain": ["@deepseek-ai/dsh-tools"] }\n'))
      .not.toThrow()
  })

  it('keeps the grader engine itself free of Toolchain, process-spawning checks outside the engine seam, and model calls', () => {
    const sources = [
      resolve('scripts/eval/h2/h2-grader.mjs'),
    ].map(file => ({ file, text: readFileSync(file, 'utf8') }))
    for (const { text } of sources) {
      expect(text).not.toMatch(/dsh-toolchain\/dsh|toolchain_plugin_verify|toolchain_contract_search/)
      expect(text).not.toMatch(/\bfetch\s*\(/)
      expect(text).not.toMatch(/\bllm\b/i)
    }
  })

  it('admits a task only when the initial workspace fails and the reference passes', async () => {
    const initial = await writeWorkspace('admit-initial', 'export const broken = true\n')
    const reference = await writeWorkspace('admit-reference', 'export const broken = false\n')
    const io = { composeCheck: passingCompose, runtimeCheck: async () => ({ ok: true }) }
    const admitted = await runAuthorCheck({ initialWorkspaceDir: initial, referenceWorkspaceDir: reference, grader: GRADER, io })
    expect(admitted.admissible).toBe(true)
    expect(admitted.reason).toBe('INITIAL_FAIL_REFERENCE_PASS')

    const notAdmitted = await runAuthorCheck({ initialWorkspaceDir: reference, referenceWorkspaceDir: reference, grader: GRADER, io })
    expect(notAdmitted.admissible).toBe(false)
    expect(notAdmitted.reason).toContain('initial=pass')
  })

  it('rejects malformed grader descriptors loudly', () => {
    expect(() => validateGrader({})).toThrow(/no checks/)
    expect(() => validateGrader({ static: [{ id: 'a' }] })).toThrow(/needs id and file/)
    expect(() => validateGrader({ compose: { expectRows: 'nope' } })).toThrow(/expectRows/)
  })
})