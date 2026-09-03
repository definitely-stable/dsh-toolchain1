import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseStagedRunArguments, runStagedCommand } from '../../scripts/eval/run-staged.mjs'

const cleanupPaths: string[] = []
const repoRoot = path.resolve(import.meta.dirname, '../..')
const developmentManifest = path.join(repoRoot, 'docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')

type DevelopmentTask = {
  id: string
  domain: string
  prompt: string
  successRule:
    | { kind: 'api-exists-any'; package: string; symbols: readonly string[] }
    | { kind: 'api-absent'; symbols: readonly string[]; proofScope: { kind: 'package'; package: string } | { kind: 'target' } }
}

async function tempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-staged-command-'))
  cleanupPaths.push(directory)
  return directory
}

function successfulExecutor(call: { taskId: string; arm: 'B' | 'C' }, task: DevelopmentTask) {
  const claim = task.successRule.kind === 'api-exists-any'
    ? {
        package: task.successRule.package,
        symbol: task.successRule.symbols[0],
        assertion: 'exists' as const,
      }
    : {
        package: task.successRule.proofScope.kind === 'package' ? task.successRule.proofScope.package : '*',
        symbol: task.successRule.symbols[0],
        assertion: 'absent' as const,
      }

  return Promise.resolve({
    transportStatus: 'ok' as const,
    structuredContent: {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: call.taskId,
      claims: [claim],
    },
    attempts: 1,
    infrastructureFailures: 0,
    wallTimeMs: 1,
  })
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(cleanupPaths.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('one-command staged evaluation runner', () => {
  it('accepts only the closed operator surface', () => {
    expect(parseStagedRunArguments([
      '--mode', 'canary',
      '--manifest', 'corpus/manifest.json',
      '--output', 'result/report.json',
    ])).toEqual({
      mode: 'canary',
      manifestPath: 'corpus/manifest.json',
      outputPath: 'result/report.json',
    })

    expect(() => parseStagedRunArguments([
      '--mode', 'dev', '--manifest', 'manifest.json', '--output', 'report.json', '--chunk-size', '48',
    ])).toThrow(/unknown staged evaluation option --chunk-size/i)
    expect(() => parseStagedRunArguments([
      '--mode', 'release', '--manifest', 'manifest.json', '--output', 'report.json', '--arms', 'B,C',
    ])).toThrow(/unknown staged evaluation option --arms/i)
    expect(() => parseStagedRunArguments([
      '--mode', 'research', '--manifest', 'manifest.json', '--output', 'report.json', '--repetitions', '2',
    ])).toThrow(/unknown staged evaluation option --repetitions/i)
    expect(() => parseStagedRunArguments([
      '--mode', 'deterministic', '--manifest', 'manifest.json', '--output', 'report.json',
    ])).toThrow(/mode must be one of canary, dev, release, research/i)
  })

  it('loads the DEVELOPMENT_ONLY corpus, executes the canary, and writes one report', async () => {
    const directory = await tempDirectory()
    const outputPath = path.join(directory, 'nested', 'report.json')

    const report = await runStagedCommand({
      args: ['--mode', 'canary', '--manifest', developmentManifest, '--output', outputPath],
      execute: successfulExecutor,
    })

    expect(report).toMatchObject({
      schema: 'dsh-toolchain-staged-eval-report-v1',
      mode: 'canary',
      measurement: { status: 'PASS' },
      authorization: { plannedCalls: 16, executedCalls: 16, remainderAuthorized: 0 },
      cost: { modelCalls: 16, attempts: 16 },
    })
    const serialized = JSON.parse(await readFile(outputPath, 'utf8'))
    expect(serialized).toEqual(report)
  })

  it('creates and always disposes the provider executor when no executor is injected', async () => {
    const directory = await tempDirectory()
    const outputPath = path.join(directory, 'report.json')
    const dispose = vi.fn(async () => undefined)
    const createExecutor = vi.fn(async () => ({ execute: successfulExecutor, dispose }))

    const report = await runStagedCommand({
      args: ['--mode', 'canary', '--manifest', developmentManifest, '--output', outputPath],
      environment: { M2_STAGED_PROVIDER_PROBE: 'probe.json', OPENCODE_API_KEY: 'test-only' },
      createExecutor,
    })

    expect(report.measurement.status).toBe('PASS')
    expect(createExecutor).toHaveBeenCalledOnce()
    expect(createExecutor).toHaveBeenCalledWith({
      environment: { M2_STAGED_PROVIDER_PROBE: 'probe.json', OPENCODE_API_KEY: 'test-only' },
    })
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('rejects a corpus that is not DEVELOPMENT_ONLY before creating or calling any executor', async () => {
    const directory = await tempDirectory()
    const manifestPath = path.join(directory, 'manifest.json')
    const outputPath = path.join(directory, 'report.json')
    await writeFile(manifestPath, JSON.stringify({
      schema: 'dsh-toolchain-m2-h1-development-corpus-manifest-v1',
      status: 'HOLDOUT',
      futureHoldoutAllowed: false,
      taskCount: 0,
      shards: [],
    }), 'utf8')
    let calls = 0
    const createExecutor = vi.fn(async () => ({ execute: successfulExecutor, dispose: async () => undefined }))

    await expect(runStagedCommand({
      args: ['--mode', 'canary', '--manifest', manifestPath, '--output', outputPath],
      execute: async (call: { taskId: string; arm: 'B' | 'C' }, task: DevelopmentTask) => {
        calls += 1
        return successfulExecutor(call, task)
      },
      createExecutor,
    })).rejects.toThrow(/development corpus must be DEVELOPMENT_ONLY/i)
    expect(calls).toBe(0)
    expect(createExecutor).not.toHaveBeenCalled()
  })

  it('binds the default operator path to the real development executor factory', async () => {
    const source = await readFile(path.join(repoRoot, 'scripts/eval/run-staged.mjs'), 'utf8')
    expect(source).toContain("import { createDevelopmentExecutor } from './m2-development-executor.mjs'")
    expect(source).toContain("input.createExecutor === 'function' ? input.createExecutor : createDevelopmentExecutor")
  })

  it('fails closed when the default provider executor is not configured', async () => {
    await expect(runStagedCommand({
      args: ['--mode', 'canary', '--manifest', developmentManifest, '--output', 'report.json'],
      environment: {},
      createExecutor: async () => { throw new Error('Missing required staged provider configuration: M2_STAGED_PROVIDER_PROBE') },
    })).rejects.toThrow(/M2_STAGED_PROVIDER_PROBE/i)
  })
})
