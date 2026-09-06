import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessOutcome, VerificationProcessRequest } from '../../src/verification/process.js'
import type { Diagnostic, TargetSnapshot, VerificationReport } from '../../src/protocol/index.js'

const roots: string[] = []

type VerificationCheck = VerificationReport['checks'][number]

interface ExecutionView {
  readonly artifactFingerprint?: string
  readonly targetFingerprint: string
  readonly executionPolicy: 'safe'
  readonly runtime: {
    readonly nodeVersion: string
    readonly platform: string
    readonly arch: string
  }
  readonly checks: readonly VerificationCheck[]
  readonly diagnostics: readonly Diagnostic[]
  readonly cleanup: VerificationReport['cleanup']
  readonly terminal: 'completed' | 'failed' | 'cancelled'
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-worker-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function bootMarker(profile: string): string {
  return `DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:${sha256(Buffer.from(`profile:${profile}`))}`
}

function target(): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-06T12:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [{
      id: 'manifest:profile',
      kind: 'manifest',
      strength: 'authoritative',
      contentHash: 'd'.repeat(64),
      location: '/active/dsh-home/profiles/web/package.json',
    }],
    supportStatus: 'tested',
  }
}

interface FakeRunner {
  readonly calls: VerificationProcessRequest[]
  readonly run: (request: VerificationProcessRequest, signal?: AbortSignal) => Promise<VerificationProcessOutcome>
}

function fakeRunner(outcomes: readonly VerificationProcessOutcome[]): FakeRunner {
  const calls: VerificationProcessRequest[] = []
  const queue = [...outcomes]
  return {
    calls,
    run: async (request: VerificationProcessRequest) => {
      calls.push(request)
      return queue.shift() ?? { kind: 'exited', code: 0, stdout: '', stderr: '' }
    },
  }
}

async function candidate(root: string, bytes: Buffer = Buffer.from('packed-candidate-v1')): Promise<{
  readonly path: string
  readonly expectedContentHash: string
}> {
  const source = path.join(root, 'source.tgz')
  await writeFile(source, bytes)
  return { path: source, expectedContentHash: sha256(bytes) }
}

async function runWith(
  root: string,
  runner: FakeRunner,
  outcomes: {
    readonly artifactHash?: string
    readonly cleanup?: (temporaryRoot: string) => Promise<void>
    readonly signal?: AbortSignal
  } = {},
): Promise<{ readonly execution: ExecutionView; readonly workerRoot: string }> {
  const artifact = await candidate(root)
  const workerRoot = path.join(root, 'worker')
  const input = {
    artifact: {
      ...artifact,
      ...(outcomes.artifactHash === undefined ? {} : { expectedContentHash: outcomes.artifactHash }),
    },
    target: target(),
    executionPolicy: 'safe' as const,
  }

  const execution = await runPackedPluginVerification(input, {
    processRunner: runner.run,
    parentEnv: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: 'must-not-cross-worker-boundary',
      DSH_HOME: '/active/dsh-home',
    },
    createTemporaryRoot: async () => {
      await mkdir(workerRoot, { recursive: true })
      return workerRoot
    },
    cleanupTemporaryRoot: outcomes.cleanup ?? (async (temporaryRoot: string) => {
      await rm(temporaryRoot, { recursive: true, force: true })
    }),
  }, outcomes.signal) as ExecutionView

  return { execution, workerRoot }
}

function check(execution: ExecutionView, id: string): VerificationCheck | undefined {
  return execution.checks.find(item => item.id === id)
}

function successfulOutcomes(): readonly VerificationProcessOutcome[] {
  return [
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: 'composed', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: `${bootMarker('web')}\n`, stderr: '' },
  ]
}

describe('packed plugin verification worker', () => {
  it('binds exact artifact bytes and proves install/compose/boot only in one disposable DSH environment', async () => {
    const root = await fixtureRoot()
    const runner = fakeRunner(successfulOutcomes())

    const { execution, workerRoot } = await runWith(root, runner)

    expect(execution).toMatchObject({
      artifactFingerprint: expect.stringMatching(/^dsh-plugin-artifact-v1:[0-9a-f]{64}$/u),
      targetFingerprint: target().fingerprint,
      executionPolicy: 'safe',
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      cleanup: 'succeeded',
      terminal: 'completed',
      diagnostics: [],
    })
    expect(execution.checks.map(item => item.id)).toEqual([
      'structure', 'manifest', 'dependency', 'contract', 'build', 'package',
      'install', 'compose', 'boot', 'visibility', 'behavior',
    ])
    expect(check(execution, 'package')).toEqual({ id: 'package', status: 'passed' })
    expect(check(execution, 'install')).toEqual({ id: 'install', status: 'passed' })
    expect(check(execution, 'compose')).toEqual({ id: 'compose', status: 'passed' })
    expect(check(execution, 'boot')).toEqual({ id: 'boot', status: 'passed' })
    expect(check(execution, 'visibility')).toEqual({ id: 'visibility', status: 'skipped', reason: 'no-visibility-assertions' })
    expect(check(execution, 'behavior')).toEqual({ id: 'behavior', status: 'skipped', reason: 'not-supported-in-m4.1' })

    expect(runner.calls).toHaveLength(5)
    const [installDsh, installCandidate, compose, installProbe, boot] = runner.calls
    const runnerDir = path.join(workerRoot, 'runner')
    const temporaryDshHome = path.join(workerRoot, 'dsh-home')
    const candidateCopy = path.join(workerRoot, 'artifact', 'candidate.tgz')
    const probePath = path.join(workerRoot, 'boot-probe')

    expect(installDsh).toMatchObject({
      args: ['add', '--save-exact', '--ignore-scripts', '@deepseek-ai/dsh@0.1.1-rc.2'],
      cwd: runnerDir,
    })
    expect(installCandidate).toMatchObject({
      args: ['exec', 'dsh', 'plugin', '--profile', 'web', 'add', '--ignore-scripts', candidateCopy],
      cwd: runnerDir,
    })
    expect(compose).toMatchObject({
      args: ['exec', 'dsh', '--profile', 'web', '--dump-config'],
      cwd: runnerDir,
    })
    expect(installProbe).toMatchObject({
      args: ['exec', 'dsh', 'plugin', '--profile', 'web', 'add', '--ignore-scripts', probePath],
      cwd: runnerDir,
    })
    expect(boot).toMatchObject({
      args: ['exec', 'dsh', '--profile', 'web', '--no-open', '--port', '0'],
      cwd: runnerDir,
      timeoutMs: 120_000,
    })
    for (const call of runner.calls) {
      expect(call.command).toBe(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
      expect(call.env.DSH_HOME).toBe(temporaryDshHome)
      expect(call.env.DSH_HOME).not.toContain('/active/dsh-home')
      expect(call.env.OPENAI_API_KEY).toBeUndefined()
      expect(call.env.HOME).toBe(path.join(workerRoot, 'home'))
      expect(call.env.TMP).toBe(path.join(workerRoot, 'tmp'))
    }
  })

  it('fails before subprocess execution when the packed artifact changed after acquisition', async () => {
    const root = await fixtureRoot()
    const runner = fakeRunner([])

    const { execution } = await runWith(root, runner, { artifactHash: '0'.repeat(64) })

    expect(runner.calls).toEqual([])
    expect(execution.artifactFingerprint).toBeUndefined()
    expect(execution.terminal).toBe('failed')
    expect(execution.diagnostics.map(item => item.code)).toEqual(['VERIFY_ARTIFACT_STALE'])
    expect(check(execution, 'package')).toMatchObject({ status: 'failed' })
    expect(check(execution, 'install')).toMatchObject({ status: 'skipped' })
    expect(check(execution, 'compose')).toMatchObject({ status: 'skipped' })
    expect(check(execution, 'boot')).toMatchObject({ status: 'skipped' })
    expect(execution.cleanup).toBe('succeeded')
  })

  it.each([
    {
      name: 'DSH installation non-zero exit',
      outcomes: [{ kind: 'exited', code: 1, stdout: '', stderr: 'install failed' }] as const,
      code: 'VERIFY_INSTALL_FAILED',
      failedStage: 'install',
      calls: 1,
    },
    {
      name: 'candidate installation non-zero exit',
      outcomes: [
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 2, stdout: '', stderr: 'candidate failed' },
      ] as const,
      code: 'VERIFY_INSTALL_FAILED',
      failedStage: 'install',
      calls: 2,
    },
    {
      name: 'compose non-zero exit',
      outcomes: [
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 3, stdout: '', stderr: 'compose failed' },
      ] as const,
      code: 'VERIFY_COMPOSE_FAILED',
      failedStage: 'compose',
      calls: 3,
    },
    {
      name: 'boot probe installation non-zero exit',
      outcomes: [
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 4, stdout: '', stderr: 'probe install failed' },
      ] as const,
      code: 'VERIFY_BOOT_FAILED',
      failedStage: 'boot',
      calls: 4,
    },
    {
      name: 'boot process non-zero exit',
      outcomes: [
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 5, stdout: '', stderr: 'boot failed' },
      ] as const,
      code: 'VERIFY_BOOT_FAILED',
      failedStage: 'boot',
      calls: 5,
    },
    {
      name: 'boot exits zero without marker',
      outcomes: [
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: '', stderr: '' },
        { kind: 'exited', code: 0, stdout: 'launcher exited cleanly\n', stderr: '' },
      ] as const,
      code: 'VERIFY_BOOT_FAILED',
      failedStage: 'boot',
      calls: 5,
    },
    {
      name: 'process timeout',
      outcomes: [{ kind: 'timeout', stdout: '', stderr: '' }] as const,
      code: 'VERIFY_PROCESS_TIMEOUT',
      failedStage: 'install',
      calls: 1,
    },
    {
      name: 'process start failure',
      outcomes: [{ kind: 'start-failed', message: 'ENOENT' }] as const,
      code: 'VERIFY_PROCESS_START_FAILED',
      failedStage: 'install',
      calls: 1,
    },
    {
      name: 'process output overflow',
      outcomes: [{ kind: 'output-limit', stream: 'stderr' }] as const,
      code: 'VERIFY_PROCESS_OUTPUT_LIMIT_EXCEEDED',
      failedStage: 'install',
      calls: 1,
    },
  ])('fails closed for $name', async ({ outcomes, code, failedStage, calls }) => {
    const root = await fixtureRoot()
    const runner = fakeRunner(outcomes)

    const { execution } = await runWith(root, runner)

    expect(runner.calls).toHaveLength(calls)
    expect(execution.terminal).toBe('failed')
    expect(execution.diagnostics.map(item => item.code)).toContain(code)
    expect(check(execution, failedStage)).toMatchObject({ status: 'failed' })
    expect(execution.cleanup).toBe('succeeded')
  })

  it('preserves cancellation as a distinct terminal outcome', async () => {
    const root = await fixtureRoot()
    const runner = fakeRunner([{ kind: 'cancelled', stdout: '', stderr: '' }])

    const { execution } = await runWith(root, runner)

    expect(execution.terminal).toBe('cancelled')
    expect(execution.diagnostics.map(item => item.code)).toContain('VERIFY_PROCESS_CANCELLED')
    expect(check(execution, 'install')).toMatchObject({ status: 'failed' })
    expect(check(execution, 'compose')).toMatchObject({ status: 'skipped' })
  })

  it('retains cleanup failure without rewriting the completed execution lifecycle', async () => {
    const root = await fixtureRoot()
    const runner = fakeRunner(successfulOutcomes())

    const { execution } = await runWith(root, runner, {
      cleanup: async () => {
        throw new Error('cleanup denied')
      },
    })

    expect(execution.terminal).toBe('completed')
    expect(execution.cleanup).toBe('failed')
    expect(execution.diagnostics.map(item => item.code)).toContain('VERIFY_CLEANUP_FAILED')
    expect(check(execution, 'compose')).toMatchObject({ status: 'passed' })
    expect(check(execution, 'boot')).toMatchObject({ status: 'passed' })
  })
})
