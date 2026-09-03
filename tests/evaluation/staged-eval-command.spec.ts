import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseStagedRunArguments, runStagedCommand } from '../../scripts/eval/run-staged.mjs'

const cleanupPaths: string[] = []
const repoRoot = path.resolve(import.meta.dirname, '../..')
const developmentManifest = path.join(repoRoot, 'docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')

async function tempDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-staged-command-'))
  cleanupPaths.push(directory)
  return directory
}

function successfulExecutor(call: { taskId: string; arm: 'B' | 'C' }) {
  return Promise.resolve({
    transportStatus: 'ok',
    structuredContent: {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: call.taskId,
      apiValid: true,
      taskSuccess: true,
      claims: [],
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

  it('rejects a corpus that is not DEVELOPMENT_ONLY before any executor call', async () => {
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

    await expect(runStagedCommand({
      args: ['--mode', 'canary', '--manifest', manifestPath, '--output', outputPath],
      execute: async call => {
        calls += 1
        return successfulExecutor(call)
      },
    })).rejects.toThrow(/development corpus must be DEVELOPMENT_ONLY/i)
    expect(calls).toBe(0)
  })

  it('fails closed when no executor is configured', async () => {
    await expect(runStagedCommand({
      args: ['--mode', 'canary', '--manifest', developmentManifest, '--output', 'report.json'],
    })).rejects.toThrow(/development executor is not configured/i)
  })
})
