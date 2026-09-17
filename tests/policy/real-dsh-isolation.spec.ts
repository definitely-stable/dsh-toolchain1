import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Repository-wide isolation policy for every script that drives a real DSH.
 *
 * The H2 incident on 16 September lost the operator's DSH home, and the audit
 * afterwards found that the harness deleted a directory computed from paths and
 * handed the operator's `HOME`, `USERPROFILE`, and temp directory to every child
 * process. These checks keep both regressions from coming back: a spawned DSH
 * gets disposable coordinates, and a recursive removal only ever touches a
 * directory the script itself created.
 *
 * The checks are deliberately textual. They are a policy guard against ordinary
 * regressions, not a proof about arbitrary code.
 */

const SCRIPTS_ROOT = resolve('scripts')

/**
 * Scripts whose recursive removal is legitimate without a local `mkdtemp`
 * binding. Every entry states why; an unexplained entry is a bug in this list.
 */
const RECURSIVE_REMOVAL_ALLOWLIST = new Map([
  // The build cleaner owns the repository's own build output, not a benchmark tree.
  ['clean.mjs', 'removes the repository build output it exists to clean'],
  // The guard itself must call rm; it is the module that enforces ownership.
  ['eval/safety/owned-tree.mjs', 'the ownership guard is the only legitimate recursive remover'],
  // A dependency-injected service: the caller passes a disposable mkdtemp root.
  ['eval/m2-development-executor.mjs', 'injected runtime remover; callers pass their own disposable root'],
  // Frozen historical evidence: these runners are never re-executed, and their
  // runtime root comes from a helper rather than a local mkdtemp binding.
  ['finalize-m2-h1.mjs', 'frozen H1 terminal adjudication; its runtime root is created by a helper'],
  ['run-m2-h1-opencode-go.mjs', 'frozen H1 execution runner; must not be rewritten'],
  ['run-m2-p0-opencode-go.mjs', 'frozen P0 calibration runner; must not be rewritten'],
])

async function listScripts(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listScripts(full))
    else if (entry.name.endsWith('.mjs')) files.push(full)
  }
  return files
}

function spawnsDsh(source: string): boolean {
  if (!source.includes("from 'node:child_process'")) return false
  return /['"`]dsh['"`]/.test(source) || /['"`]plugin['"`]/.test(source) && /['"`]--profile['"`]/.test(source)
}

function usesDisposableEnvironment(source: string): boolean {
  return source.includes('disposable-environment.mjs')
}

/** Identifiers bound to a fresh temporary directory in this file. */
function mkdtempBindings(source: string): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*(?:await\s+)?mkdtemp(?:Sync)?\s*\(/g)) names.add(match[1]!)
  return names
}

/** Recursive removals, as `line -> target expression`. */
function recursiveRemovals(source: string): Array<{ line: number, target: string }> {
  const lines = source.split(/\r?\n/)
  const found: Array<{ line: number, target: string }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const match = /(?:^|[^\w.])(rm|rmSync)\(([^,)]*)/.exec(line)
    if (match === null) continue
    const window = lines.slice(index, Math.min(lines.length, index + 3)).join(' ')
    if (!/recursive:\s*true/.test(window)) continue
    found.push({ line: index + 1, target: match[2]!.trim() })
  }
  return found
}

/** Fixed numeric ports in a boot argument list; only port 0 is allowed. */
function fixedPorts(source: string): number[] {
  const ports: number[] = []
  for (const match of source.matchAll(/['"]--port['"]\s*,\s*['"](\d+)['"]/g)) {
    const port = Number(match[1])
    if (port !== 0) ports.push(port)
  }
  return ports
}

async function scriptSources(): Promise<Array<{ name: string, source: string }>> {
  const files = await listScripts(SCRIPTS_ROOT)
  return Promise.all(files.map(async file => ({
    name: relative(SCRIPTS_ROOT, file).split(sep).join('/'),
    source: await readFile(file, 'utf8'),
  })))
}

describe('real-DSH isolation policy', () => {
  it('gives every script that spawns DSH a disposable environment', async () => {
    const offenders: string[] = []
    for (const script of await scriptSources()) {
      if (!spawnsDsh(script.source)) continue
      if (usesDisposableEnvironment(script.source)) continue
      offenders.push(script.name)
    }
    expect(offenders).toEqual([])
  })

  it('removes only directories the script created itself', async () => {
    const offenders: string[] = []
    for (const script of await scriptSources()) {
      if (RECURSIVE_REMOVAL_ALLOWLIST.has(script.name)) continue
      const bindings = mkdtempBindings(script.source)
      for (const removal of recursiveRemovals(script.source)) {
        const target = removal.target.replace(/\.root$/, '')
        if (bindings.has(target)) continue
        offenders.push(`${script.name}:${removal.line} removes ${removal.target}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never boots a profile on a fixed port', async () => {
    const offenders: string[] = []
    for (const script of await scriptSources()) {
      for (const port of fixedPorts(script.source)) offenders.push(`${script.name} uses port ${port}`)
    }
    expect(offenders).toEqual([])
  })

  it('routes every H2 deletion through the ownership guard', async () => {
    for (const name of ['eval/h2/h2-workspace.mjs', 'eval/h2/h2-runner.mjs', 'eval/h2/h2-dsh-env.mjs', 'eval/h2/h2-cli.mjs']) {
      const source = await readFile(join(SCRIPTS_ROOT, name), 'utf8')
      expect(source, `${name} must use the ownership guard`).toContain('owned-tree.mjs')
    }
  })
})

describe('policy detector self-checks', () => {
  it('flags a DSH spawn without the disposable environment', () => {
    const source = "import { spawnSync } from 'node:child_process'\nspawnSync('dsh', ['--version'])\n"
    expect(spawnsDsh(source)).toBe(true)
    expect(usesDisposableEnvironment(source)).toBe(false)
  })

  it('flags a recursive removal of a directory that was not created by mkdtemp', () => {
    const source = "const dshHome = join(homedir(), '.dsh')\nawait rm(dshHome, { recursive: true, force: true })\n"
    const removals = recursiveRemovals(source)
    expect(removals).toHaveLength(1)
    expect(mkdtempBindings(source).has(removals[0]!.target)).toBe(false)
  })

  it('accepts a removal of the script own temporary root', () => {
    const source = "const root = await mkdtemp(join(tmpdir(), 'x-'))\nawait rm(root, { recursive: true, force: true })\n"
    const removals = recursiveRemovals(source)
    expect(mkdtempBindings(source).has(removals[0]!.target)).toBe(true)
  })

  it('flags a fixed port and accepts an ephemeral one', () => {
    expect(fixedPorts("['--port', '3080']")).toEqual([3080])
    expect(fixedPorts("['--no-open', '--port', '0']")).toEqual([])
  })
})
