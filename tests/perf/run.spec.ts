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

  it('fails closed if a deterministic case changes its output fingerprint inside one run', async () => {
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
