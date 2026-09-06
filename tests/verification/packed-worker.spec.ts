import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessOutcome, VerificationProcessRequest } from '../../src/verification/process.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const roots: string[] = []

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

function target(): TargetSnapshot {
  return Object.freeze({
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-06T12:00:00.000Z',
    dsh: Object.freeze({ name: '@deepseek-ai/dsh' as const, version: '0.1.1-rc.2' }),
    runtime: Object.freeze({ nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' }),
    profile: Object.freeze({
      name: 'web',
      bundles: Object.freeze([]),
      dependencies: Object.freeze([]),
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: Object.freeze([]),
    }),
    evidence: Object.freeze([Object.freeze({
      id: 'manifest:profile',
      kind: 'manifest' as const,
      strength: 'authoritative' as const,
      contentHash: 'd'.repeat(64),
      location: '/active/dsh-home/profiles/web/package.json',
    })]),
    supportStatus: 'tested' as const,
  })
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
) {
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
  }, outcomes.signal)

  return { execution, workerRoot }
}

function check(execution: Awaited<ReturnType<typeof runPackedPluginVerification>>, id: string) {
  return execution.checks.find(item => item.id === id)
}

describe('packed plugin verification worker', () => {
  it('binds exact artifact bytes and executes install/compose only in one disposable DSH environment', async () => {
    const root = await fixtureRoot()
    const runner = fakeRunner([
      { kind: 'exited', code: 0, stdout: '', stderr: '' },
      { kind: 'exited', code: 0, stdout: '', stderr: '' },
      { kind: 'exited', code: 0, stdout: 'composed', stderr: '' },
    ])

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
    expect(check(execution, 'boot')).toEqual({ id: 'boot', status: 'skipped', reason: 'boot-probe-required' })
    expect(check(execution, 'visibility')).toEqual({ id: 'visibility', status: 'skipped', reason: 'no-visibility-assertions' })
    expect(check(execution, 'behavior')).toEqual({ id: 'behavior', status: 'skipped', reason: 'not-supported-in-m4.1' })

    expect(runner.calls).toHaveLength(3)
    const [installDsh, installCandidate, compose] = runner.calls
    const runnerDir = path.join(workerRoot, 'runner')
    const temporaryDshHome = path.join(workerRoot, 'dsh-home')
    const candidateCopy = path.join(workerRoot, 'artifact', 'candidate.tgz')

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
    const runner = fakeRunner([
      { kind: 'exited', code: 0, stdout: '', stderr: '' },
      { kind: 'exited', code: 0, stdout: '', stderr: '' },
      { kind: 'exited', code: 0, stdout: '', stderr: '' },
    ])

    const { execution } = await runWith(root, runner, {
      cleanup: async () => {
        throw new Error('cleanup denied')
      },
    })

    expect(execution.terminal).toBe('completed')
    expect(execution.cleanup).toBe('failed')
    expect(execution.diagnostics.map(item => item.code)).toContain('VERIFY_CLEANUP_FAILED')
    expect(check(execution, 'compose')).toMatchObject({ status: 'passed' })
  })
})
