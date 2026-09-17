import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const H2_GRADER_SCHEMA = 'dsh-toolchain-h2-grader-v1'

/**
 * Environment IO injected into the grader engine. Every field is optional so
 * partial test doubles stay possible; a declared check without its
 * implementation fails loudly instead of silently passing.
 *
 * @typedef {object} H2GraderIo
 * @property {(input: {workspaceDir: string, file: string}) => {ok: boolean, detail?: string}} [nodeCheck]
 * @property {(input: {workspaceDir: string}) => Promise<{ok: boolean, detail?: string}>} [tscCheck]
 * @property {(input: {workspaceDir: string, expectRows: readonly {id: string, name: string}[]}) => Promise<{ok: boolean, detail?: string}>} [composeCheck]
 * @property {(input: {workspaceDir: string, services: readonly string[], tools: readonly string[]}) => Promise<{ok: boolean, detail?: string}>} [runtimeCheck]
 */

/**
 * Independence guard: a hidden grader is a declarative descriptor, never a
 * program. It must not import or require modules, spawn processes, reach the
 * network, call a model, or consult DSH Toolchain. Otherwise the grader could
 * stop being an independent oracle. Patterns are syntax-shaped so that a
 * check id such as `no-host-runtime-import` is not a false positive.
 */
const FORBIDDEN_GRADER_SOURCE = [
  /(^|\n)\s*import\s/,
  /\brequire\s*\(/,
  /\bfetch\s*\(/,
  /child_process/,
  /dsh-toolchain/,
  /toolchain_[a-z_]+/,
  /\bLLM\b/,
]

export function assertGraderIndependence(sourceText) {
  if (typeof sourceText !== 'string') throw new Error('grader source must be text')
  for (const pattern of FORBIDDEN_GRADER_SOURCE) {
    if (pattern.test(sourceText)) throw new Error(`grader independence violated: source matches ${pattern}`)
  }
  return true
}

/** Structural validation of a grader descriptor. */
export function validateGrader(grader) {
  if (grader === null || typeof grader !== 'object') throw new Error('grader descriptor must be an object')
  const checks = []
  for (const [index, entry] of (grader.static ?? []).entries()) {
    if (typeof entry?.id !== 'string' || typeof entry?.file !== 'string') throw new Error(`static check ${index} needs id and file`)
    if (!Array.isArray(entry.mustContain ?? []) || !Array.isArray(entry.mustNotContain ?? [])) {
      throw new Error(`static check ${entry.id} containment lists must be arrays`)
    }
    checks.push('static')
  }
  if (grader.build !== undefined) {
    if (!Array.isArray(grader.build.nodeCheck ?? [])) throw new Error('build.nodeCheck must be an array')
    if (grader.build.tsc !== undefined && typeof grader.build.tsc !== 'boolean') throw new Error('build.tsc must be a boolean')
    checks.push('build')
  }
  if (grader.compose !== undefined) {
    if (!Array.isArray(grader.compose.expectRows ?? [])) throw new Error('compose.expectRows must be an array')
    checks.push('compose')
  }
  if (grader.runtime !== undefined) {
    if (!Array.isArray(grader.runtime.services ?? []) || !Array.isArray(grader.runtime.tools ?? [])) {
      throw new Error('runtime.services and runtime.tools must be arrays')
    }
    checks.push('runtime')
  }
  if (checks.length === 0) throw new Error('grader declares no checks')
  return true
}

/** Real syntax check: `node --check` on each declared file. */
export function nodeSyntaxCheck({ workspaceDir, file }) {
  const target = join(workspaceDir, file)
  statSync(target)
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe', windowsHide: true })
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: `node --check failed for ${file}: ${String(error.stderr ?? error.message).slice(0, 400)}` }
  }
}

/**
 * Runs one task's hidden grader against a workspace. All environment IO is
 * injected so the engine stays deterministic and can be unit tested without
 * DSH; a declared check with no available implementation fails loudly rather
 * than silently passing.
 *
 * @param {{workspaceDir: string, grader: any, io?: H2GraderIo}} input
 */
export async function runGrader({ workspaceDir, grader, io = {} }) {
  validateGrader(grader)
  const results = []

  for (const check of grader.static ?? []) {
    const target = join(workspaceDir, check.file)
    let text
    try {
      text = readFileSync(target, 'utf8')
    } catch {
      results.push({ name: `static:${check.id}`, status: 'fail', detail: `missing file ${check.file}` })
      continue
    }
    const missing = (check.mustContain ?? []).filter(fragment => !text.includes(fragment))
    const present = (check.mustNotContain ?? []).filter(fragment => text.includes(fragment))
    const regexFailures = []
    for (const { pattern, expected } of check.regex ?? []) {
      const matched = new RegExp(pattern).test(text)
      if (matched !== expected) regexFailures.push(pattern)
    }
    if (missing.length > 0 || present.length > 0 || regexFailures.length > 0) {
      results.push({
        name: `static:${check.id}`,
        status: 'fail',
        detail: `missing=[${missing.join('|')}] forbiddenPresent=[${present.join('|')}] regexMismatch=[${regexFailures.join('|')}]`,
      })
    } else {
      results.push({ name: `static:${check.id}`, status: 'pass' })
    }
  }

  if (grader.build?.nodeCheck !== undefined) {
    for (const file of grader.build.nodeCheck) {
      const outcome = (io.nodeCheck ?? nodeSyntaxCheck)({ workspaceDir, file })
      results.push({ name: `build:node-check:${file}`, status: outcome.ok ? 'pass' : 'fail', detail: outcome.detail })
    }
  }

  if (grader.build?.tsc === true) {
    const tsc = io.tscCheck
    if (typeof tsc !== 'function') throw new Error('grader declares a tsc build check but no tsc implementation is available')
    const outcome = await tsc({ workspaceDir })
    results.push({ name: 'build:tsc', status: outcome.ok ? 'pass' : 'fail', detail: outcome.detail })
  }

  if (grader.compose !== undefined) {
    const compose = io.composeCheck
    if (typeof compose !== 'function') throw new Error('grader declares a composition check but no DSH compose implementation is available')
    const outcome = await compose({ workspaceDir, expectRows: grader.compose.expectRows })
    results.push({ name: 'compose:dsh', status: outcome.ok ? 'pass' : 'fail', detail: outcome.detail })
  }

  if (grader.runtime !== undefined) {
    const runtime = io.runtimeCheck
    if (typeof runtime !== 'function') throw new Error('grader declares runtime assertions but no DSH boot implementation is available')
    const outcome = await runtime({ workspaceDir, services: grader.runtime.services, tools: grader.runtime.tools })
    results.push({ name: 'runtime:probe', status: outcome.ok ? 'pass' : 'fail', detail: outcome.detail })
  }

  const status = results.every(result => result.status === 'pass') ? 'pass' : 'fail'
  return Object.freeze({ schema: H2_GRADER_SCHEMA, status, checks: Object.freeze(results) })
}

/**
 * Dataset admission check: the initial workspace must FAIL and the reference
 * solution must PASS. A task that does not satisfy both is not admissible
 * into the H2 corpus.
 */
export async function runAuthorCheck({ initialWorkspaceDir, referenceWorkspaceDir, grader, io = {} }) {
  const initial = await runGrader({ workspaceDir: initialWorkspaceDir, grader, io })
  const reference = await runGrader({ workspaceDir: referenceWorkspaceDir, grader, io })
  const admissible = initial.status === 'fail' && reference.status === 'pass'
  return Object.freeze({
    admissible,
    initial,
    reference,
    reason: admissible ? 'INITIAL_FAIL_REFERENCE_PASS' : `initial=${initial.status} reference=${reference.status}`,
  })
}