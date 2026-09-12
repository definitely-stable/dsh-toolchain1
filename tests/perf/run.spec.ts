import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { requireSearchLane, runPerfSuite } from '../../scripts/perf/run.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  delete process.env.PERF_TEST_SECRET
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('performance receipt runner', () => {
  it('writes bounded v1 JSON, JSONL, and Markdown evidence without dumping environment secrets', async () => {
    process.env.PERF_TEST_SECRET = 'do-not-leak-this-value'
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-test-'))
    temporaryDirectories.push(outputDir)

    const result = await runPerfSuite({
      profileName: 'smoke',
      outputDir,
      cases: [{
        name: 'stable-control',
        run: async ({ scale, concurrency }: { scale: number; concurrency: number }) => `stable:${scale}:${concurrency}`,
      }],
      environmentOverrides: {
        gitSha: '0123456789abcdef',
        gitRef: 'refs/heads/test',
      },
    })

    expect(result.summary.schema).toBe('dsh-perf-v1')
    expect(result.summary.profile).toBe('smoke')
    expect(result.summary.cases).toHaveLength(1)
    expect(result.summary.cases[0]).toMatchObject({
      caseName: 'stable-control',
      outcome: 'ok',
      successfulSamples: 3,
      errorSamples: 0,
    })
    expect(result.summary.cases[0]?.latencyMs.count).toBeGreaterThan(0)

    const environmentText = await readFile(path.join(outputDir, 'environment.json'), 'utf8')
    const samplesText = await readFile(path.join(outputDir, 'samples.jsonl'), 'utf8')
    const summaryText = await readFile(path.join(outputDir, 'summary.json'), 'utf8')
    const markdown = await readFile(path.join(outputDir, 'summary.md'), 'utf8')

    expect(JSON.parse(environmentText)).toMatchObject({
      schema: 'dsh-perf-environment-v1',
      gitSha: '0123456789abcdef',
      gitRef: 'refs/heads/test',
    })
    const samples = samplesText.trim().split('\n').map(line => JSON.parse(line) as { schema: string; outcome: string })
    expect(samples.length).toBeGreaterThan(0)
    expect(samples.every(sample => sample.schema === 'dsh-perf-sample-v1' && sample.outcome === 'ok')).toBe(true)
    expect(JSON.parse(summaryText)).toEqual(result.summary)
    expect(markdown).toContain('# DSH Toolchain performance')
    expect(markdown).toContain('stable-control')

    for (const text of [environmentText, samplesText, summaryText, markdown]) {
      expect(text).not.toContain('do-not-leak-this-value')
      expect(text).not.toContain('PERF_TEST_SECRET')
    }
  })

  it('keeps latency and throughput evidence separate for every concurrency level', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-concurrency-summary-'))
    temporaryDirectories.push(outputDir)

    const result = await runPerfSuite({
      profileName: 'benchmark',
      outputDir,
      cases: [{
        name: 'stable-control',
        run: async () => 'stable',
      }],
    })

    expect(result.summary.cases).toHaveLength(2)
    expect(result.summary.cases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        caseName: 'stable-control',
        concurrency: 1,
        samples: 10,
        operations: 10,
      }),
      expect.objectContaining({
        caseName: 'stable-control',
        concurrency: 4,
        samples: 10,
        operations: 40,
      }),
    ]))
  })

  it('persists bounded partial evidence before failing a measured case', async () => {
    process.env.PERF_TEST_SECRET = 'do-not-leak-this-value'
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-failure-'))
    temporaryDirectories.push(outputDir)
    let invocation = 0

    await expect(runPerfSuite({
      profileName: 'smoke',
      outputDir,
      cases: [{
        name: 'failure-control',
        run: async () => {
          invocation += 1
          if (invocation >= 2) throw new Error(`synthetic failure ${process.env.PERF_TEST_SECRET}`)
          return 'stable-before-failure'
        },
      }],
    })).rejects.toThrow(/synthetic failure/i)

    const samplesText = await readFile(path.join(outputDir, 'samples.jsonl'), 'utf8')
    const summaryText = await readFile(path.join(outputDir, 'summary.json'), 'utf8')
    const markdown = await readFile(path.join(outputDir, 'summary.md'), 'utf8')
    const samples = samplesText.trim().split('\n').map(line => JSON.parse(line) as {
      outcome: string
      error?: { name: string; message: string }
    })
    const summary = JSON.parse(summaryText) as {
      cases: Array<{ caseName: string; outcome: string; successfulSamples: number; errorSamples: number }>
    }

    expect(samples.some(sample => sample.outcome === 'error')).toBe(true)
    expect(summary.cases[0]).toMatchObject({
      caseName: 'failure-control',
      outcome: 'error',
      successfulSamples: 0,
      errorSamples: 1,
    })
    expect(markdown).toContain('failure-control')
    for (const text of [samplesText, summaryText, markdown]) {
      expect(text).not.toContain('do-not-leak-this-value')
    }
  })

  it('fails closed and persists evidence if a deterministic case changes its output fingerprint', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-drift-'))
    temporaryDirectories.push(outputDir)
    let invocation = 0

    await expect(runPerfSuite({
      profileName: 'smoke',
      outputDir,
      cases: [{
        name: 'drifting-control',
        run: async () => `value-${++invocation}`,
      }],
    })).rejects.toThrow(/deterministic output drift/i)

    const samplesText = await readFile(path.join(outputDir, 'samples.jsonl'), 'utf8')
    const summary = JSON.parse(await readFile(path.join(outputDir, 'summary.json'), 'utf8')) as {
      cases: Array<{ outcome: string; errorSamples: number }>
    }
    expect(samplesText).toContain('"outcome":"error"')
    expect(summary.cases[0]).toMatchObject({ outcome: 'error', errorSamples: 1 })
  })
})

describe('search benchmark lane guard', () => {
  it('accepts only the explicitly expected production search lane', () => {
    expect(() => requireSearchLane({ lane: 'intent' }, 'intent', 'synthetic intent query')).not.toThrow()
    expect(() => requireSearchLane({ lane: 'strict' }, 'intent', 'synthetic intent query'))
      .toThrow(/expected intent.*received strict/i)
    expect(() => requireSearchLane({ lane: 'none' }, 'intent', 'synthetic intent query'))
      .toThrow(/expected intent.*received none/i)
  })
})
