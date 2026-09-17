import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildDisposableEnvironment, createDisposableCoordinates, ensureDisposableCoordinates, ephemeralBootArgs } from '../safety/disposable-environment.mjs'
import { createOwnedTree, removeOwnedTree } from '../safety/owned-tree.mjs'
import { assertDumpParity, bootArgs, dumpConfigArgs, extractCompositionFacts, pluginAddArgs } from './h2-composition.mjs'
import { H2_POLICY } from './h2-config.mjs'
import { routePatchEntries, sessionAffinityValue } from './h2-route.mjs'
import { canonicalJson, directoryDigest, sha256Canonical } from './h2-util.mjs'

export const H2_GRADER_COMPOSE_PROFILE = 'h2-grader'
export const H2_GRADER_RUNTIME_PROFILE = 'web'
export const H2_GRADER_PROBE_MARKER = 'H2_GRADER_PROBE '
export const H2_GRADER_PROBE_PACKAGE = 'h2-grader-probe'
export const H2_SESSION_PERSISTENCE_ROW = 'session-persistence-jsonl'

/**
 * The session-persistence overlay entry for one observation home.
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
 * @param {{homeDir: string}} input
 */
export function telemetryOverlayEntry({ homeDir }) {
  // A patch entry REPLACES the targeted config object, it does not merge into
  // it, and this row's `root` is required with no default: the overlay must
  // therefore re-supply `root` or session persistence would write nowhere.
  // `dshHomePath('sessions')` resolves to exactly this path.
  return {
    id: H2_SESSION_PERSISTENCE_ROW,
    config: {
      root: join(homeDir, 'sessions'),
      compression: 'none',
    },
  }
}

/**
 * Writes the observation home's profile patch layer — the environment every
 * observation runs in, identical in both arms.
 *
 * The patch is written before the profile's first boot, so the launcher
 * initializes the profile around it instead of overwriting it; an existing
 * patch is refused rather than replaced, because silently replacing it would
 * run the observation in a composition nobody recorded.
 *
 * @param {{homeDir: string, profile: string, entries: readonly any[]}} input
 */
export function writeObservationProfilePatch({ homeDir, profile, entries }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('H2 observation profile patch must carry at least one entry')
  }
  const dir = join(homeDir, 'profiles', profile)
  const file = join(dir, 'cordis.patch.yml')
  if (existsSync(file)) throw new Error(`H2 observation profile patch would overwrite an existing profile patch: ${file}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
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
   * @param {{env: Record<string, string|undefined>, cwd?: string, timeout?: number, allowFailure?: boolean}} options
   */
  function run(args, { env, cwd, timeout = timeoutMs, allowFailure = false } = /** @type {any} */ ({})) {
    // The child environment is passed in whole: it is built from the disposable
    // coordinates, so nothing of the operator's environment is inherited here.
    // That is what keeps a DSH subprocess from ever naming the real home.
    if (env === undefined || env === null) throw new Error('a DSH subprocess requires an explicit disposable environment')
    // `package` mode runs `pnpm exec dsh`, which resolves the launcher from the
    // working directory's package graph — so a call that does not name a cwd must
    // still run in the runtime root. A runner installs the train into its own
    // directory, and probing the version from the repository root there fails
    // with a bare "dsh --version exited 1".
    const result = spawnImpl(command, [...prefix, ...args], {
      cwd: cwd ?? dshRoot ?? process.cwd(),
      env,
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
 * The probe's own tree is owned like every other benchmark tree: its removal
 * goes through the handle this function created, never through a recomputed
 * path.
 *
 * @param {{runtime: any, workspaceRoot: string, baseDir: string, runId: string, profile: string,
 *   toolchainTarball: string, env?: Record<string, string | undefined>}} input
 */
export function runCompositionParityProbe({ runtime, workspaceRoot, baseDir, runId, profile, toolchainTarball, env = {} }) {
  const cwd = runtime.dshRoot ?? process.cwd()
  const probe = createOwnedTree({ workspaceRoot, dir: baseDir, kind: 'composition-parity', runId, reset: true })
  // Each arm home carries the same observation profile patch the real
  // observation homes carry, so the parity dump describes the composition that
  // actually runs rather than a profile nobody boots.
  const armCoordinates = arm => {
    const coordinates = ensureDisposableCoordinates(createDisposableCoordinates({ root: join(probe.root, arm) }))
    writeObservationProfilePatch({
      homeDir: coordinates.dshHome,
      profile,
      entries: [
        telemetryOverlayEntry({ homeDir: coordinates.dshHome }),
        ...routePatchEntries({ model: H2_POLICY.model, sessionAffinity: sessionAffinityValue({ runId: 'composition-parity', taskId: 'dump', arm }) }),
      ],
    })
    return coordinates
  }
  const dumpB = dumpComposition({ runtime, coordinates: armCoordinates('arm-b'), cwd, profile, dirs: [], env })
  const dumpC = dumpComposition({ runtime, coordinates: armCoordinates('arm-c'), cwd, profile, dirs: [toolchainTarball], env })
  const { addedRows } = assertDumpParity({ dumpB, dumpC })
  const factsB = extractCompositionFacts(dumpB)
  const factsC = extractCompositionFacts(dumpC)
  // The homes are heavy and their content is already reduced to the summary
  // above; a failure leaves them in place so the mismatch can be inspected.
  removeOwnedTree({ handle: probe })
  return Object.freeze({
    verified: true,
    profile,
    armBRows: factsB.rows.length,
    armCRows: factsC.rows.length,
    addedRow: Object.freeze({ id: addedRows[0].id, name: addedRows[0].name }),
  })
}

/**
 * Installs local plugin directories into a fresh profile of one disposable home.
 *
 * @param {{runtime: any, coordinates: any, cwd: string, profile: string,
 *   dirs: readonly string[], env?: Record<string, string | undefined>}} input
 */
export function installPluginDirs({ runtime, coordinates, cwd, profile, dirs, env = {} }) {
  const childEnv = buildDisposableEnvironment({ coordinates, extra: env })
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
export function packWorkspaceDir({ workspaceDir, outFile, env, spawnImpl = spawnSync }) {
  if (env === undefined || env === null) throw new Error('packing a subject requires an explicit disposable environment')
  const result = spawnImpl('pnpm', ['pack', '--out', outFile], {
    cwd: workspaceDir,
    env,
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
 * @param {{runtime: any, coordinates: any, cwd: string, profile: string,
 *   dirs: readonly string[], env?: Record<string, string | undefined>}} input
 * @returns {string}
 */
export function dumpComposition({ runtime, coordinates, cwd, profile, dirs, env = {} }) {
  installPluginDirs({ runtime, coordinates, cwd, profile, dirs, env })
  const { stdout } = runtime.run(dumpConfigArgs({ profile }), {
    env: buildDisposableEnvironment({ coordinates, extra: env }),
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
 * @param {{runtime: any, coordinates: any, cwd: string, profile: string, probeDir: string,
 *   services?: readonly string[], tools?: readonly string[], env?: Record<string, string | undefined>,
 *   timeout?: number}} input
 */
export function runBootProbe({ runtime, coordinates, cwd, profile, probeDir, services = [], tools = [], env = {}, timeout = 180_000 }) {
  const appArgs = ephemeralBootArgs(profile)
  const { status, stdout, stderr } = runtime.run(bootArgs({ profile, appArgs }), {
    env: buildDisposableEnvironment({
      coordinates,
      extra: {
        ...env,
        H2_PROBE_SERVICES: services.join(','),
        H2_PROBE_TOOLS: tools.join(','),
      },
    }),
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
 * Each attempt gets its own disposable coordinates under the observation's
 * scratch area, so the oracle's own DSH processes are isolated exactly like the
 * agent under test: their home, temp, and package-manager caches are inside the
 * observation and nowhere else.
 *
 * @param {{runtime: any, layout: any, coordinates: any, environment?: Record<string, string|undefined>, workdir?: string,
 *   attempts?: number, packImpl?: typeof packWorkspaceDir}} input
 */
export function createDshGraderIo({ runtime, layout, coordinates, environment = {}, workdir, attempts = 2, packImpl = packWorkspaceDir }) {
  if (coordinates === undefined || coordinates === null) throw new Error('grader IO requires the observation disposable coordinates')
  const cwd = workdir ?? runtime.dshRoot ?? process.cwd()
  const childEnv = { ...environment }
  const gradeCoordinates = (label, key, attempt) => ensureDisposableCoordinates(
    createDisposableCoordinates({ root: join(layout.scratchDir, `${label}-${key}-${attempt}`) }),
  )
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
    packImpl({ workspaceDir, outFile: tarball, env: buildDisposableEnvironment({ coordinates }) })
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
          coordinates: gradeCoordinates('compose-home', key, attempt),
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
        const runtimeCoordinates = gradeCoordinates('runtime-home', key, attempt)
        installPluginDirs({
          runtime,
          coordinates: runtimeCoordinates,
          cwd,
          profile: H2_GRADER_RUNTIME_PROFILE,
          dirs: [tarball, probeDir],
          env: childEnv,
        })
        return runBootProbe({
          runtime,
          coordinates: runtimeCoordinates,
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
 * The version call is still a DSH process, so it needs a disposable environment
 * like every other one; the caller supplies coordinates for it.
 *
 * @param {{runtime: any, profile: string, dshTrain: string, coordinates: any, dshRootVersion?: string | null}} input
 */
export function describeTargetFacts({ runtime, profile, dshTrain, coordinates, dshRootVersion }) {
  if (coordinates === undefined || coordinates === null) throw new Error('target facts require disposable coordinates for the version probe')
  const runtimeVersion = runtime.version(buildDisposableEnvironment({ coordinates }))
  return Object.freeze({
    dshTrain,
    dshRootVersion: dshRootVersion ?? null,
    runtimeVersion,
    profile,
    targetFingerprint: buildTargetFingerprint({ dshTrain, dshRootVersion, profile, runtimeVersion }),
    canonical: canonicalJson({ dshTrain, dshRootVersion, runtimeVersion, profile }),
  })
}