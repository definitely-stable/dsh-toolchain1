import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Diagnostic, TargetSnapshot, VerificationReport } from '../../src/protocol/index.js'
import { runPackedPluginVerification } from '../../src/verification/packed-worker.js'
import type { VerificationProcessOutcome, VerificationProcessRequest } from '../../src/verification/process.js'

const roots: string[] = []
type Check = VerificationReport['checks'][number]

interface BehaviorAssertion {
  readonly kind: 'agent-tool-result'
  readonly name: string
  readonly arguments: unknown
  readonly expectedValue: unknown
}

interface ExecutionView {
  readonly checks: readonly Check[]
  readonly diagnostics: readonly Diagnostic[]
  readonly terminal: 'completed' | 'failed' | 'cancelled'
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-worker-behavior-test-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function bootMarker(profile: string): string {
  return `DSH_TOOLCHAIN_VERIFY_BOOT_PROBE_V1:${sha256(`profile:${profile}`)}`
}

function behaviorMarkers(profile: string, assertions: readonly BehaviorAssertion[]) {
  const digest = sha256(`profile:${profile}\nbehavior:${JSON.stringify(assertions)}`)
  const prefix = `DSH_TOOLCHAIN_VERIFY_BEHAVIOR_PROBE_V1:${digest}`
  return { passedMarker: `${prefix}:PASS`, failedMarker: `${prefix}:FAIL` }
}

function target(): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-09-13T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.5-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'headless',
      bundles: [],
      dependencies: [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
    supportStatus: 'tested',
  }
}

function runner(outcomes: readonly VerificationProcessOutcome[]) {
  const queue = [...outcomes]
  const calls: VerificationProcessRequest[] = []
  return {
    calls,
    run: async (request: VerificationProcessRequest) => {
      calls.push(request)
      return queue.shift() ?? { kind: 'exited' as const, code: 0, stdout: '', stderr: '' }
    },
  }
}

function successfulOutcomes(stdout: string): readonly VerificationProcessOutcome[] {
  return [
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout: 'composed', stderr: '' },
    { kind: 'exited', code: 0, stdout: '', stderr: '' },
    { kind: 'exited', code: 0, stdout, stderr: '' },
  ]
}

async function run(root: string, assertions: readonly BehaviorAssertion[], stdout: string): Promise<ExecutionView> {
  const bytes = Buffer.from('behavior-candidate')
  const artifact = path.join(root, 'candidate.tgz')
  await writeFile(artifact, bytes)
  const workerRoot = path.join(root, 'worker')
  const fake = runner(successfulOutcomes(stdout))
  const input = {
    artifact: { path: artifact, expectedContentHash: sha256(bytes) },
    target: target(),
    executionPolicy: 'safe' as const,
    behaviorAssertions: assertions,
  }
  return await runPackedPluginVerification(input, {
    processRunner: fake.run,
    parentEnv: { PATH: process.env.PATH },
    createTemporaryRoot: async () => {
      await mkdir(workerRoot, { recursive: true })
      return workerRoot
    },
    cleanupTemporaryRoot: async temporaryRoot => {
      await rm(temporaryRoot, { recursive: true, force: true })
    },
  }) as ExecutionView
}

function check(execution: ExecutionView, id: Check['id']): Check | undefined {
  return execution.checks.find(candidate => candidate.id === id)
}

describe('packed worker behavior assertions', () => {
  const assertions: readonly BehaviorAssertion[] = [{
    kind: 'agent-tool-result',
    name: 'candidate_tool',
    arguments: { value: 1 },
    expectedValue: { ok: true },
  }]

  it('passes behavior only when the bound PASS marker is observed after boot', async () => {
    const root = await fixtureRoot()
    const markers = behaviorMarkers('headless', assertions)
    const execution = await run(root, assertions, `${bootMarker('headless')}\n${markers.passedMarker}\n`)

    expect(execution.terminal).toBe('completed')
    expect(check(execution, 'boot')).toEqual({ id: 'boot', status: 'passed' })
    expect(check(execution, 'behavior')).toEqual({ id: 'behavior', status: 'passed' })
    expect(execution.diagnostics).toEqual([])
  })

  it('fails behavior with a stable diagnostic when the probe reports FAIL', async () => {
    const root = await fixtureRoot()
    const markers = behaviorMarkers('headless', assertions)
    const execution = await run(root, assertions, `${bootMarker('headless')}\n${markers.failedMarker}\n`)

    expect(check(execution, 'behavior')).toEqual({
      id: 'behavior',
      status: 'failed',
      reason: 'verify-behavior-failed',
    })
    expect(execution.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_BEHAVIOR_FAILED',
      severity: 'error',
      domain: 'verification',
    }))
  })

  it('does not claim requested behavior when the probe emits no behavior marker', async () => {
    const root = await fixtureRoot()
    const execution = await run(root, assertions, `${bootMarker('headless')}\n`)

    expect(check(execution, 'behavior')).toEqual({
      id: 'behavior',
      status: 'skipped',
      reason: 'behavior-assertions-not-executed',
    })
  })
})
