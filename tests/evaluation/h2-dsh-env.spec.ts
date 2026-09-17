import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  H2_GRADER_PROBE_MARKER,
  buildTargetFingerprint,
  createDshGraderIo,
  createDshRuntime,
  describeTargetFacts,
  dumpComposition,
  installPluginDirs,
  runBootProbe,
  telemetryOverlayEntry,
  writeObservationProfilePatch,
  writeProbePackage,
} from '../../scripts/eval/h2/h2-dsh-env.mjs'
import { findSessionLog } from '../../scripts/eval/h2/h2-runner.mjs'
import { createDisposableCoordinates, ensureDisposableCoordinates } from '../../scripts/eval/lib/disposable-environment.mjs'

const roots: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'h2-dsh-env-'))
  roots.push(dir)
  return dir
}

/** Disposable coordinates for a fake observation root. */
function fakeCoordinates(root = tempDir()) {
  return ensureDisposableCoordinates(createDisposableCoordinates({ root }))
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeSpawn(responses: Array<{ status?: number; stdout?: string; stderr?: string }>) {
  const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = []
  let index = 0
  const spawn = (command: string, args: string[], options: { env: Record<string, string> }) => {
    calls.push({ command, args, env: options.env })
    const response = responses[Math.min(index, responses.length - 1)] ?? {}
    index += 1
    return { status: response.status ?? 0, stdout: response.stdout ?? '', stderr: response.stderr ?? '', error: undefined }
  }
  return { spawn, calls }
}

describe('H2 DSH runtime handle', () => {
  it('drives the harness checkout exactly like the product launcher', () => {
    const { spawn, calls } = fakeSpawn([{ stdout: '0.1.5-rc.2\n' }])
    const runtime = createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: spawn })
    expect(runtime.version({ PATH: 'C:/tools' })).toBe('0.1.5-rc.2')
    expect(calls[0]!.command).toBe('pnpm')
    expect(calls[0]!.args).toEqual(['--dir', 'C:/harness', 'dsh', '--version'])
  })

  it('supports the disposable installed-runner mode used by published trains', () => {
    const { spawn, calls } = fakeSpawn([{ stdout: '0.1.5-rc.2\n' }])
    const runtime = createDshRuntime({ mode: 'package', spawnImpl: spawn })
    runtime.version({ PATH: 'C:/tools' })
    expect(calls[0]!.args).toEqual(['exec', 'dsh', '--version'])
  })

  it('requires a checkout root in checkout mode and rejects unknown modes', () => {
    expect(() => createDshRuntime({ mode: 'checkout' })).toThrow(/checkout root/)
    expect(() => createDshRuntime({ mode: 'nonsense' })).toThrow(/unknown DSH runtime mode/)
  })

  it('installs plugin directories into the disposable profile and dumps the composition', () => {
    const { spawn, calls } = fakeSpawn([{ stdout: '' }, { stdout: '- id: subject\n  name: subject\n' }])
    const runtime = createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: spawn })
    const coordinates = fakeCoordinates()
    const dump = dumpComposition({
      runtime,
      coordinates,
      cwd: 'C:/harness',
      profile: 'h2-grader',
      dirs: ['C:/obs/workspace'],
    })
    expect(dump).toContain('- id: subject')
    expect(calls[0]!.args).toEqual(['--dir', 'C:/harness', 'dsh', 'plugin', '--profile', 'h2-grader', 'add', '--ignore-scripts', 'C:/obs/workspace'])
    expect(calls[0]!.env.DSH_HOME).toBe(coordinates.dshHome)
    expect(calls[0]!.env.HOME).toBe(coordinates.userHome)
    expect(calls[1]!.args).toEqual(['--dir', 'C:/harness', 'dsh', '--profile', 'h2-grader', '--dump-config'])
  })

  it('fails loudly when a plugin install or composition dump fails', () => {
    const failing = fakeSpawn([{ status: 1, stderr: 'install exploded' }])
    const runtime = createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: failing.spawn })
    expect(() => installPluginDirs({ runtime, coordinates: fakeCoordinates(), cwd: 'c', profile: 'p', dirs: ['d'] }))
      .toThrow(/install exploded/)
  })
})

describe('H2 grader boot probe', () => {
  it('writes a probe package that is a real DSH bundle row', () => {
    const dir = tempDir()
    writeProbePackage(dir)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('name: h2-grader-probe')
    const probe = readFileSync(join(dir, 'probe.mjs'), 'utf8')
    expect(probe).toContain(H2_GRADER_PROBE_MARKER)
    expect(probe).toContain("inject = ['tools', 'agentLoop', 'agents', 'appExit']")
    expect(probe).toContain('SETTLE_TIMEOUT_MS')
    expect(probe).not.toMatch(/dsh-toolchain|toolchain_/)
  })

  it('accepts a boot that reports every declared service and tool', () => {
    const marker = `${H2_GRADER_PROBE_MARKER}{"services":{"fixtureService":true},"tools":{"fixture_tool":true}}\n`
    const { spawn, calls } = fakeSpawn([{ stdout: marker }])
    const runtime = createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: spawn })
    const result = runBootProbe({
      runtime,
      coordinates: fakeCoordinates(),
      cwd: 'C:/harness',
      profile: 'web',
      probeDir: 'C:/obs/probe',
      services: ['fixtureService'],
      tools: ['fixture_tool'],
    })
    expect(result.ok).toBe(true)
    // The Web profile owns a launcher app, so a headless probe must boot it
    // without opening a browser or racing for a fixed port.
    expect(calls[0]!.args).toEqual(['--dir', 'C:/harness', 'dsh', '--profile', 'web', '--no-open', '--port', '0'])
    expect(calls[0]!.env.H2_PROBE_SERVICES).toBe('fixtureService')
    expect(calls[0]!.env.H2_PROBE_TOOLS).toBe('fixture_tool')
  })

  it('fails closed when a declared service or tool is not visible, or no marker appears', () => {
    const partial = `${H2_GRADER_PROBE_MARKER}{"services":{"fixtureService":false},"tools":{"fixture_tool":true}}\n`
    const missing = fakeSpawn([{ stdout: partial }])
    const missingResult = runBootProbe({
      runtime: createDshRuntime({ mode: 'checkout', dshRoot: 'C:/h', spawnImpl: missing.spawn }),
      coordinates: fakeCoordinates(), cwd: 'c', profile: 'web', probeDir: 'p', services: ['fixtureService'], tools: [],
    })
    expect(missingResult.ok).toBe(false)
    expect(missingResult.detail).toContain('missing services=[fixtureService]')

    const silent = fakeSpawn([{ stdout: 'nothing here', stderr: 'boom' }])
    const silentResult = runBootProbe({
      runtime: createDshRuntime({ mode: 'checkout', dshRoot: 'C:/h', spawnImpl: silent.spawn }),
      coordinates: fakeCoordinates(), cwd: 'c', profile: 'web', probeDir: 'p',
    })
    expect(silentResult.ok).toBe(false)
    expect(silentResult.detail).toContain('no marker')

    const badExit = fakeSpawn([{ status: 1, stdout: `${H2_GRADER_PROBE_MARKER}{"services":{},"tools":{}}\n` }])
    const badExitResult = runBootProbe({
      runtime: createDshRuntime({ mode: 'checkout', dshRoot: 'C:/h', spawnImpl: badExit.spawn }),
      coordinates: fakeCoordinates(), cwd: 'c', profile: 'web', probeDir: 'p',
    })
    expect(badExitResult.ok).toBe(false)
  })
})

describe('H2 target identity', () => {
  it('fingerprints the exact target deterministically and sensitively', () => {
    const facts = { dshTrain: '@deepseek-ai/dsh@0.1.5-rc.2', dshRootVersion: '0.1.5-rc.2', profile: 'acp', runtimeVersion: '0.1.5-rc.2' }
    const fingerprint = buildTargetFingerprint(facts)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(buildTargetFingerprint(facts)).toBe(fingerprint)
    expect(buildTargetFingerprint({ ...facts, dshTrain: '@deepseek-ai/dsh@0.1.6-alpha.1' })).not.toBe(fingerprint)
    expect(buildTargetFingerprint({ ...facts, runtimeVersion: '0.1.6-alpha.1' })).not.toBe(fingerprint)
    expect(() => buildTargetFingerprint({ dshTrain: '', profile: 'acp' })).toThrow(/exact DSH train/)
  })

  it('describes the frozen target through the runtime version probe', () => {
    const { spawn } = fakeSpawn([{ stdout: '0.1.5-rc.2\n' }])
    const runtime = createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: spawn })
    const facts = describeTargetFacts({
      runtime,
      profile: 'acp',
      dshTrain: '@deepseek-ai/dsh@0.1.5-rc.2',
      dshRootVersion: '0.1.5-rc.2',
      coordinates: fakeCoordinates(),
    })
    expect(facts.runtimeVersion).toBe('0.1.5-rc.2')
    expect(facts.targetFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('H2 telemetry overlay and session-log discovery', () => {
  it('keeps the required root alongside the compression setting', () => {
    const home = tempDir()
    const entry = telemetryOverlayEntry({ homeDir: home })
    expect(entry.id).toBe('session-persistence-jsonl')
    // A patch entry replaces the whole config object, and `root` has no default:
    // dropping it would leave session persistence writing nowhere, so no log
    // would ever appear and the budget could not be enforced.
    expect(entry.config.root).toBe(join(home, 'sessions'))
    expect(entry.config.compression).toBe('none')
  })

  it('writes the whole observation patch layer before the profile first boots', () => {
    const home = tempDir()
    const file = writeObservationProfilePatch({
      homeDir: home,
      profile: 'acp',
      entries: [telemetryOverlayEntry({ homeDir: home }), { id: 'llm-pi-ai', config: { providers: {} } }],
    })
    expect(file).toBe(join(home, 'profiles', 'acp', 'cordis.patch.yml'))
    const patch = JSON.parse(readFileSync(file, 'utf8'))
    expect(Array.isArray(patch)).toBe(true)
    expect(patch.map((entry: { id: string }) => entry.id)).toEqual(['session-persistence-jsonl', 'llm-pi-ai'])
  })

  it('refuses to overwrite an existing profile patch layer', () => {
    const home = tempDir()
    const entries = [telemetryOverlayEntry({ homeDir: home })]
    writeObservationProfilePatch({ homeDir: home, profile: 'acp', entries })
    expect(() => writeObservationProfilePatch({ homeDir: home, profile: 'acp', entries })).toThrow(/overwrite/)
  })

  it('refuses to write an empty observation patch', () => {
    expect(() => writeObservationProfilePatch({ homeDir: tempDir(), profile: 'acp', entries: [] })).toThrow(/at least one entry/)
  })

  it('finds the raw log of this exact session and ignores a compressed sibling', async () => {
    const home = tempDir()
    const dir = join(home, 'sessions', 'project', 'session-abc')
    await mkdir(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v3.jsonl.zstd'), 'compressed', 'utf8')
    writeFileSync(join(dir, 'session.v3.jsonl'), `${JSON.stringify({ type: 'session', id: 'session-abc' })}\n`, 'utf8')
    const found = await findSessionLog({ dshHome: home, sessionId: 'session-abc', timeoutMs: 100, pollMs: 5 })
    expect(found.endsWith('session.v3.jsonl')).toBe(true)
  })

  it('never accepts a child session whose header merely mentions the parent id', async () => {
    const home = tempDir()
    const dir = join(home, 'sessions', 'project', 'child-session')
    await mkdir(dir, { recursive: true })
    // A subagent child's header carries the parent id, which is exactly how a
    // substring match would report the child's usage as the parent's.
    writeFileSync(
      join(dir, 'session.v3.jsonl'),
      `${JSON.stringify({ type: 'session', id: 'child-1', parentSession: 'session-abc' })}\n`,
      'utf8',
    )
    await expect(findSessionLog({ dshHome: home, sessionId: 'session-abc', timeoutMs: 80, pollMs: 5 }))
      .rejects.toThrow(/could not locate/)
  })

  it('diagnoses a compressed-only telemetry plane instead of reporting a generic miss', async () => {
    const home = tempDir()
    const dir = join(home, 'sessions', 'project', 'session-abc')
    await mkdir(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v3.jsonl.zstd'), 'compressed', 'utf8')
    await expect(findSessionLog({ dshHome: home, sessionId: 'session-abc', timeoutMs: 80, pollMs: 5 }))
      .rejects.toThrow(/compressed session logs/)
  })
})

describe('H2 grader subject isolation', () => {
  const BOOT_MARKER = `${H2_GRADER_PROBE_MARKER}{"services":{"widget":true},"tools":{}}\n`

  /**
   * A grader IO whose subject is packed by a recorder instead of pnpm. The
   * workspace path stays the same across grades, which is exactly how the
   * corpus admission check materializes the initial workspace and then the
   * reference fix into one observation directory.
   */
  function recorderIo(responses: Array<{ status?: number; stdout?: string; stderr?: string }>) {
    const { spawn, calls } = fakeSpawn(responses)
    const packs: Array<{ workspaceDir: string; outFile: string }> = []
    const io = createDshGraderIo({
      runtime: createDshRuntime({ mode: 'checkout', dshRoot: 'C:/harness', spawnImpl: spawn }),
      layout: { scratchDir: tempDir() },
      coordinates: fakeCoordinates(),
      environment: {},
      packImpl: ({ workspaceDir, outFile }: { workspaceDir: string; outFile: string }) => {
        packs.push({ workspaceDir, outFile })
        writeFileSync(outFile, workspaceDir)
        return outFile
      },
    })
    return { io, packs, calls }
  }

  function subjectWorkspace(source: string): string {
    const dir = tempDir()
    writeFileSync(join(dir, 'index.mjs'), source, 'utf8')
    return dir
  }

  it('grades the workspace it was handed, not an earlier one rewritten in place', async () => {
    const { io, packs, calls } = recorderIo([{ stdout: BOOT_MARKER }])
    const workspace = subjectWorkspace('export function apply() {}\n')

    const initial = await io.runtimeCheck({ workspaceDir: workspace, services: ['widget'], tools: [] })
    expect(initial.ok).toBe(true)

    // The reference fix replaces the initial workspace at the same path.
    writeFileSync(join(workspace, 'index.mjs'), 'export function apply(ctx) { ctx.plugin(WidgetService) }\n', 'utf8')
    const reference = await io.runtimeCheck({ workspaceDir: workspace, services: ['widget'], tools: [] })
    expect(reference.ok).toBe(true)

    // A second, different subject must get its own tarball and its own
    // disposable consumer: a home that already holds the first subject is not
    // replaced by a later install, so reusing it would boot the first subject's
    // code and report the first subject's verdict.
    expect(packs).toHaveLength(2)
    expect(packs[0]!.outFile).not.toBe(packs[1]!.outFile)

    const subjectInstalls = calls.filter(call => call.args.some(arg => arg.includes('graded-subject')))
    expect(subjectInstalls).toHaveLength(2)
    expect(subjectInstalls[0]!.args).toContain(packs[0]!.outFile)
    expect(subjectInstalls[1]!.args).toContain(packs[1]!.outFile)

    const boots = calls.filter(call => call.env.H2_PROBE_SERVICES !== undefined)
    expect(boots).toHaveLength(2)
    expect(boots[0]!.env.DSH_HOME).not.toBe(boots[1]!.env.DSH_HOME)
  })

  it('packs one tarball per distinct subject and reuses it for the stabilization retry', async () => {
    // Attempt one boots without a marker (a failed attempt); attempt two is
    // served from a fresh disposable home and succeeds.
    const { io, packs, calls } = recorderIo([{}, {}, { stdout: 'no marker yet' }, {}, {}, { stdout: BOOT_MARKER }])
    const workspace = subjectWorkspace('export function apply(ctx) { ctx.plugin(WidgetService) }\n')

    const result = await io.runtimeCheck({ workspaceDir: workspace, services: ['widget'], tools: [] })
    expect(result.ok).toBe(true)
    expect(packs).toHaveLength(1)

    const boots = calls.filter(call => call.env.H2_PROBE_SERVICES !== undefined)
    expect(boots).toHaveLength(2)
    // Every attempt consumes a fresh disposable home, all built from the one
    // tarball packed for this subject.
    expect(boots[0]!.env.DSH_HOME).not.toBe(boots[1]!.env.DSH_HOME)
    const subjectInstalls = calls.filter(call => call.args.some(arg => arg.includes('graded-subject')))
    expect(subjectInstalls).toHaveLength(2)
    for (const call of subjectInstalls) expect(call.args).toContain(packs[0]!.outFile)
  })

  it('grades the same subject from one tarball no matter how often it is graded', async () => {
    const { io, packs } = recorderIo([{ stdout: BOOT_MARKER }])
    const workspace = subjectWorkspace('export function apply() {}\n')
    await io.runtimeCheck({ workspaceDir: workspace, services: ['widget'], tools: [] })
    await io.runtimeCheck({ workspaceDir: workspace, services: ['widget'], tools: [] })
    expect(packs).toHaveLength(1)
  })
})