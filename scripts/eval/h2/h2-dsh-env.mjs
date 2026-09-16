import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assertDumpParity, bootArgs, dumpConfigArgs, extractCompositionFacts, pluginAddArgs } from './h2-composition.mjs'
import { canonicalJson, directoryDigest, sha256Canonical } from './h2-util.mjs'

export const H2_GRADER_COMPOSE_PROFILE = 'h2-grader'
export const H2_GRADER_RUNTIME_PROFILE = 'web'
export const H2_GRADER_PROBE_MARKER = 'H2_GRADER_PROBE '
export const H2_GRADER_PROBE_PACKAGE = 'h2-grader-probe'
export const H2_SESSION_PERSISTENCE_ROW = 'session-persistence-jsonl'

/**
 * Writes the H2 telemetry overlay into a fresh observation home.
 *
 * The frozen completion budget and every token metric are read from the
 * append-only session log, but the target train compresses that log
 * (`session.v3.jsonl.zstd`, one zstd frame per append) and Node cannot decode
 * DSH's multi-frame layout — a single decode yields only the session header.
 * Unreadable telemetry would mean an unenforceable budget, so the harness
 * disables compression through the profile's own patch layer.
 *
 * This is a profile-layer setting, not an arm composition change: it adds,
 * removes, and renames no plugin, bundle, or row, and it is written identically
 * into both arms' homes, so Arm C stays exactly Arm B plus the Toolchain.
 *
 * @param {{homeDir: string, profile: string}} input
 */
export function writeTelemetryOverlay({ homeDir, profile }) {
  const dir = join(homeDir, 'profiles', profile)
  const file = join(dir, 'cordis.patch.yml')
  if (existsSync(file)) throw new Error(`H2 telemetry overlay would overwrite an existing profile patch: ${file}`)
  mkdirSync(dir, { recursive: true })
  // A patch entry REPLACES the targeted config object, it does not merge into
  // it, and this row's `root` is required with no default: the overlay must
  // therefore re-supply `root` or session persistence would write nowhere.
  // `dshHomePath('sessions')` resolves to exactly this path.
  const patch = [{
    id: H2_SESSION_PERSISTENCE_ROW,
    config: {
      root: join(homeDir, 'sessions'),
      compression: 'none',
    },
  }]
  writeFileSync(file, `${JSON.stringify(patch, null, 2)}\n`, 'utf8')
  return file
}

/**
 * Minimal spawn contract of the runtime handle. `spawnSync` satisfies it, and
 * so can a deterministic test double: only these four result fields are read.
 *
 * @typedef {(command: string, args: string[], options: any) =>
 *   {status?: number | null, stdout?: string | null, stderr?: string | null, error?: any}} H2SpawnLike
 */

/**
 * A DSH runtime handle. `checkout` mode matches this machine's product
 * launcher (`pnpm --dir <checkout> dsh ...`, see ~/.dsh/bin/dsh.cmd);
 * `package` mode drives an installed `dsh` binary from a disposable runner
 * (the pattern the Toolchain CI uses for published trains).
 *
 * `mode` is typed as a plain string because unknown modes are a runtime
 * concern: construction must reject them loudly rather than narrow the type.
 *
 * @param {{mode?: string, dshRoot?: string, train?: string | null,
 *   timeoutMs?: number, spawnImpl?: H2SpawnLike}} input
 */
export function createDshRuntime({ mode = 'checkout', dshRoot, train = null, timeoutMs = 300_000, spawnImpl = spawnSync }) {
  if (mode !== 'checkout' && mode !== 'package') throw new Error(`unknown DSH runtime mode: ${mode}`)
  if (mode === 'checkout' && (typeof dshRoot !== 'string' || dshRoot.length === 0)) {
    throw new Error('checkout DSH runtime requires the harness checkout root')
  }
  const command = 'pnpm'
  const prefix = mode === 'checkout' ? ['--dir', dshRoot, 'dsh'] : ['exec', 'dsh']

  /**
   * @param {string[]} args
   * @param {{env?: Record<string, string|undefined>, cwd?: string, timeout?: number, allowFailure?: boolean}} [options]
   */
  function run(args, { env, cwd, timeout = timeoutMs, allowFailure = false } = {}) {
    // H2's own configuration is stripped from every DSH subprocess for the same
    // reason the agent does not inherit it: the controller's variables describe
    // where the private corpus lives.
    const inherited = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('H2_')) continue
      inherited[key] = value
    }
    const result = spawnImpl(command, [...prefix, ...args], {
      cwd,
      env: { ...inherited, ...env },
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      // pnpm is a .cmd shim on Windows; Node cannot exec it without a shell.
      shell: process.platform === 'win32',
      maxBuffer: 32 * 1024 * 1024,
    })
    if (result.error !== undefined && result.error !== null) throw result.error
    const stdout = typeof result.stdout === 'string' ? result.stdout : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr : ''
    if (result.status !== 0 && !allowFailure) {
      throw new Error(`dsh ${args.join(' ')} exited ${String(result.status)}\n${stderr.slice(-4000)}`)
    }
    return { status: result.status, stdout, stderr }
  }

  return Object.freeze({
    mode,
    dshRoot: dshRoot ?? null,
    train,
    command,
    prefix: Object.freeze([...prefix]),
    run,
    version(env) {
      return run(['--version'], { env, timeout: 60_000 }).stdout.trim()
    },
  })
}

/**
 * Deterministic target fingerprint over the frozen composition inputs. The
 * resolved versions are optional inputs: a caller may fingerprint the frozen
 * train and profile before any runtime probe has run.
 *
 * @param {{dshTrain: string, dshRootVersion?: string | null, profile: string, runtimeVersion?: string | null}} input
 */
export function buildTargetFingerprint({ dshTrain, dshRootVersion, profile, runtimeVersion }) {
  if (typeof dshTrain !== 'string' || dshTrain.length === 0) throw new Error('target fingerprint requires the exact DSH train')
  return sha256Canonical({
    schema: 'dsh-toolchain-h2-target-v1',
    dshTrain,
    dshRootVersion: dshRootVersion ?? null,
    runtimeVersion: runtimeVersion ?? null,
    profile,
  })
}

/**
 * Generates the H2-owned grader probe package. The probe is benchmark
 * machinery, not product code: it only reports whether declared services are
 * mounted and declared tools are visible, then exits. It never consults DSH
 * Toolchain.
 */
export function writeProbePackage(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: H2_GRADER_PROBE_PACKAGE,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './probe.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${H2_GRADER_PROBE_PACKAGE}\n      name: ${H2_GRADER_PROBE_PACKAGE}\n`, 'utf8')
  writeFileSync(join(dir, 'probe.mjs'), PROBE_SOURCE, 'utf8')
  return dir
}

const PROBE_SOURCE = `export const name = ${JSON.stringify(H2_GRADER_PROBE_PACKAGE)}
export const inject = ['tools', 'agentLoop', 'agents', 'appExit']

const SETTLE_TIMEOUT_MS = 30_000
const POLL_MS = 50

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function apply(ctx) {
  const services = (process.env.H2_PROBE_SERVICES ?? '').split(',').filter(Boolean)
  const tools = (process.env.H2_PROBE_TOOLS ?? '').split(',').filter(Boolean)
  // Wait for the probe's own injected capabilities first: the composition is
  // only settled once those exist, so observing earlier would race the
  // plugin under test and report a false negative.
  ctx.inject(['tools', 'agentLoop', 'agents'], scope => {
    Promise.resolve().then(async () => {
      const observed = { services: {}, tools: {}, toolNames: [] }
      const deadline = Date.now() + SETTLE_TIMEOUT_MS
      for (const service of services) {
        while (scope.get(service) === undefined && Date.now() < deadline) await delay(POLL_MS)
        observed.services[service] = scope.get(service) !== undefined
      }
      if (tools.length > 0) {
        // The Agent handle is owned by the agent-loop fiber and is only
        // creatable once that fiber is live, so creation is retried until it
        // settles instead of racing the composition.
        let agent
        let createError = null
        while (agent === undefined && Date.now() < deadline) {
          try {
            agent = scope.agentLoop.create('h2-grader-probe-' + String(process.pid))
          } catch (error) {
            createError = error
            await delay(POLL_MS)
          }
        }
        if (agent === undefined) {
          observed.createError = String((createError && createError.message) || createError || 'agent creation did not settle')
        } else {
          for (const tool of tools) {
            let visible = false
            while (!visible && Date.now() < deadline) {
              visible = scope.tools.schemas(agent).some(schema => schema.name === tool)
              if (!visible) await delay(POLL_MS)
            }
            observed.tools[tool] = visible
          }
          observed.toolNames = scope.tools.schemas(agent).map(schema => schema.name).slice(0, 50)
        }
      }
      process.stdout.write(${JSON.stringify(H2_GRADER_PROBE_MARKER)} + JSON.stringify(observed) + '\\n')
      const appExit = ctx.get('appExit')
      if (typeof appExit === 'function') appExit(0)
    }).catch(error => {
      process.stderr.write('H2_GRADER_PROBE_ERROR ' + String((error && error.stack) || error) + '\\n')
      const appExit = ctx.get('appExit')
      if (typeof appExit === 'function') appExit(1)
    })
  })
}
`

/**
 * Empirical half of the causal-boundary proof. `assertBcParity` proves the two
 * arm compositions as data; this composes both arms for real in disposable
 * homes and requires the two `dsh --dump-config` outputs to differ by exactly
 * the Toolchain's single bundle row. Structural parity alone is a tautology over
 * the constants both arms are built from, so without this a no-op `plugin add`
 * for Arm C would leave the benchmark comparing B with B and every gate green.
 *
 * @param {{runtime: any, baseDir: string, profile: string, toolchainTarball: string,
 *   env?: Record<string, string | undefined>}} input
 */
export function runCompositionParityProbe({ runtime, baseDir, profile, toolchainTarball, env = {} }) {
  const cwd = runtime.dshRoot ?? process.cwd()
  const armHome = arm => join(baseDir, arm)
  const dumpB = dumpComposition({ runtime, homeDir: armHome('arm-b'), cwd, profile, dirs: [], env })
  const dumpC = dumpComposition({ runtime, homeDir: armHome('arm-c'), cwd, profile, dirs: [toolchainTarball], env })
  const { addedRows } = assertDumpParity({ dumpB, dumpC })
  const factsB = extractCompositionFacts(dumpB)
  const factsC = extractCompositionFacts(dumpC)
  // The homes are heavy and their content is already reduced to the summary
  // above; a failure leaves them in place so the mismatch can be inspected.
  rmSync(baseDir, { recursive: true, force: true })
  return Object.freeze({
    verified: true,
    profile,
    armBRows: factsB.rows.length,
    armCRows: factsC.rows.length,
    addedRow: Object.freeze({ id: addedRows[0].id, name: addedRows[0].name }),
  })
}

/**
 * Installs local plugin directories into a fresh profile of one DSH home.
 *
 * @param {{runtime: any, homeDir: string, cwd: string, profile: string,
 *   dirs: readonly string[], env?: Record<string, string | undefined>}} input
 */
export function installPluginDirs({ runtime, homeDir, cwd, profile, dirs, env = {} }) {
  const childEnv = { ...env, DSH_HOME: homeDir, CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }
  for (const dir of dirs) {
    runtime.run(pluginAddArgs({ profile, tarball: dir }), { env: childEnv, cwd, timeout: 300_000 })
  }
  return true
}

/**
 * Packs a workspace into an exact `.tgz` so it is installed into the profile
 * package graph like a real product artifact: a linked directory would
 * resolve its imports from the benchmark checkout instead of the target
 * composition, which would make grading depend on the wrong module graph.
 */
export function packWorkspaceDir({ workspaceDir, outFile, spawnImpl = spawnSync }) {
  const result = spawnImpl('pnpm', ['pack', '--out', outFile], {
    cwd: workspaceDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    timeout: 180_000,
  })
  if (result.error !== undefined && result.error !== null) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnpm pack failed for ${workspaceDir}: ${String(result.stderr ?? '').slice(-600)}`)
  }
  return outFile
}

/**
 * Boot-free composition check: install the subject and dump the composed tree.
 *
 * @param {{runtime: any, homeDir: string, cwd: string, profile: string,
 *   dirs: readonly string[], env?: Record<string, string | undefined>}} input
 * @returns {string}
 */
export function dumpComposition({ runtime, homeDir, cwd, profile, dirs, env = {} }) {
  installPluginDirs({ runtime, homeDir, cwd, profile, dirs, env })
  const { stdout } = runtime.run(dumpConfigArgs({ profile }), {
    env: { ...env, DSH_HOME: homeDir, CI: 'true', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    cwd,
    timeout: 120_000,
  })
  return stdout
}

/**
 * Real boot probe: boots the disposable composition and requires the probe's
 * exact marker before the process exits 0. Used for runtime assertions such
 * as "this service is mounted" / "this tool is visible to an Agent".
 *
 * @param {{runtime: any, homeDir: string, cwd: string, profile: string, probeDir: string,
 *   services?: readonly string[], tools?: readonly string[], env?: Record<string, string | undefined>,
 *   timeout?: number}} input
 */
export function runBootProbe({ runtime, homeDir, cwd, profile, probeDir, services = [], tools = [], env = {}, timeout = 180_000 }) {
  // The Web profile owns a launcher app; it must boot without opening a
  // browser or racing for a fixed port during a headless probe.
  const appArgs = profile === H2_GRADER_RUNTIME_PROFILE ? ['--no-open', '--port', '0'] : []
  const { status, stdout, stderr } = runtime.run(bootArgs({ profile, appArgs }), {
    env: {
      ...env,
      DSH_HOME: homeDir,
      CI: 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      H2_PROBE_SERVICES: services.join(','),
      H2_PROBE_TOOLS: tools.join(','),
    },
    cwd,
    timeout,
    allowFailure: true,
  })
  const line = stdout.split(/\r?\n/).find(candidate => candidate.startsWith(H2_GRADER_PROBE_MARKER))
  if (line === undefined) {
    return { ok: false, observed: null, detail: `boot probe emitted no marker (exit ${String(status)}): ${stderr.slice(-600)}` }
  }
  let observed
  try {
    observed = JSON.parse(line.slice(H2_GRADER_PROBE_MARKER.length))
  } catch {
    return { ok: false, observed: null, detail: 'boot probe emitted an invalid marker payload' }
  }
  if (status !== 0) {
    const probeError = stderr.split(/\r?\n/).find(candidate => candidate.startsWith('H2_GRADER_PROBE_ERROR ')) ?? stderr.slice(-400)
    return { ok: false, observed, detail: `boot probe exited ${String(status)}: ${probeError.slice(0, 500)}` }
  }
  const missingServices = services.filter(name => observed.services?.[name] !== true)
  const missingTools = tools.filter(name => observed.tools?.[name] !== true)
  if (missingServices.length > 0 || missingTools.length > 0) {
    return {
      ok: false,
      observed,
      detail: `missing services=[${missingServices.join('|')}] missing tools=[${missingTools.join('|')}]`,
    }
  }
  void probeDir
  return { ok: true, observed, detail: 'probe observed every declared service and tool' }
}

/**
 * Real DSH-backed grader IO. Passed to `runGrader` so compose/runtime checks
 * execute against a disposable real DSH composition with no model calls.
 *
 * @param {{runtime: any, layout: any, environment?: Record<string, string|undefined>, workdir?: string,
 *   attempts?: number, packImpl?: typeof packWorkspaceDir}} input
 */
export function createDshGraderIo({ runtime, layout, environment = {}, workdir, attempts = 2, packImpl = packWorkspaceDir }) {
  const cwd = workdir ?? runtime.dshRoot ?? process.cwd()
  const childEnv = { ...environment }
  /**
   * A disposable home is disposable only once. Installing a second subject into
   * a home that already holds one leaves the first install in place: the
   * recorded `file:` dependency is still satisfied, so nothing is replaced and
   * the boot runs the previous subject's code. Grading two different workspaces
   * through one home therefore reports the *first* workspace's verdict for the
   * second. The subject is keyed by its content, and both the packed tarball and
   * every per-subject home are namespaced by that key, so a grade can only ever
   * boot the code it was asked to grade.
   */
  const subjectTarballs = new Map()
  async function subjectFor(workspaceDir) {
    const key = (await directoryDigest(workspaceDir)).slice(0, 16)
    const cached = subjectTarballs.get(key)
    if (cached !== undefined) return { key, tarball: cached }
    const tarball = join(layout.scratchDir, `graded-subject-${key}.tgz`)
    packImpl({ workspaceDir, outFile: tarball })
    subjectTarballs.set(key, tarball)
    return { key, tarball }
  }
  /**
   * A real-DSH check is deterministic for a deterministic workspace, so a
   * failing attempt is retried once against a fresh disposable home. This is
   * infrastructure stabilization of the oracle, not a retry of any agent
   * observation: the agent resource policy stays one attempt, zero retries.
   */
  const stabilize = async (label, run) => {
    let last
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        last = await run(attempt)
        if (last.ok) return last
      } catch (error) {
        last = { ok: false, detail: `attempt ${attempt} threw: ${String(error?.message ?? error).slice(0, 300)}` }
      }
    }
    return last
  }
  return Object.freeze({
    async composeCheck({ workspaceDir, expectRows }) {
      return stabilize('compose', async attempt => {
        const { key, tarball } = await subjectFor(workspaceDir)
        const dump = dumpComposition({
          runtime,
          homeDir: join(layout.scratchDir, `compose-home-${key}-${attempt}`),
          cwd,
          profile: H2_GRADER_COMPOSE_PROFILE,
          dirs: [tarball],
          env: childEnv,
        })
        // Rows are matched structurally, not by substring: `- id: subject-extra`
        // must not satisfy an expected row `subject`, and the expected name must
        // belong to that same row rather than appearing anywhere in the dump.
        const rows = extractCompositionFacts(dump).rows
        const missing = (expectRows ?? []).filter(expected => !rows.some(row => row.id === expected.id && row.name === expected.name))
        if (missing.length > 0) {
          return {
            ok: false,
            detail: `composition is missing rows=[${missing.map(row => `${row.id}:${row.name}`).join('|')}] observed=[${rows.map(row => `${row.id}:${row.name}`).join('|')}]`,
          }
        }
        return { ok: true }
      })
    },
    async runtimeCheck({ workspaceDir, services, tools }) {
      return stabilize('runtime', async attempt => {
        const { key, tarball } = await subjectFor(workspaceDir)
        const probeDir = writeProbePackage(join(layout.scratchDir, `grader-probe-${key}-${attempt}`))
        const homeDir = join(layout.scratchDir, `runtime-home-${key}-${attempt}`)
        installPluginDirs({
          runtime,
          homeDir,
          cwd,
          profile: H2_GRADER_RUNTIME_PROFILE,
          dirs: [tarball, probeDir],
          env: childEnv,
        })
        return runBootProbe({
          runtime,
          homeDir,
          cwd,
          profile: H2_GRADER_RUNTIME_PROFILE,
          probeDir,
          services,
          tools,
          env: childEnv,
        })
      })
    },
  })
}

/**
 * Stable identity of the frozen target for receipts and reports. Resolves the
 * runtime version through the handle, so it is the only target fact that
 * requires a live DSH.
 *
 * @param {{runtime: any, profile: string, dshTrain: string, dshRootVersion?: string | null,
 *   env?: Record<string, string | undefined>}} input
 */
export function describeTargetFacts({ runtime, profile, dshTrain, dshRootVersion, env = {} }) {
  const runtimeVersion = runtime.version(env)
  return Object.freeze({
    dshTrain,
    dshRootVersion: dshRootVersion ?? null,
    runtimeVersion,
    profile,
    targetFingerprint: buildTargetFingerprint({ dshTrain, dshRootVersion, profile, runtimeVersion }),
    canonical: canonicalJson({ dshTrain, dshRootVersion, runtimeVersion, profile }),
  })
}