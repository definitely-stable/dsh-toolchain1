import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runPerfSuite } from '../../scripts/perf/run.mjs'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('performance memory summary', () => {
  it('records first, last, peak, and signed deltas per case/concurrency', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'dsh-perf-memory-summary-'))
    temporaryDirectories.push(outputDir)

    const result = await runPerfSuite({
      profileName: 'smoke',
      outputDir,
      cases: [{ name: 'memory-control', run: async () => 'stable' }],
    })

    const memory = result.summary.cases[0]?.memory
    expect(memory).toMatchObject({
      firstRssBytes: expect.any(Number),
      lastRssBytes: expect.any(Number),
      peakRssBytes: expect.any(Number),
      rssDeltaBytes: expect.any(Number),
      firstHeapUsedBytes: expect.any(Number),
      lastHeapUsedBytes: expect.any(Number),
      peakHeapUsedBytes: expect.any(Number),
      heapUsedDeltaBytes: expect.any(Number),
    })
    expect(memory?.rssDeltaBytes).toBe((memory?.lastRssBytes ?? 0) - (memory?.firstRssBytes ?? 0))
    expect(memory?.heapUsedDeltaBytes).toBe((memory?.lastHeapUsedBytes ?? 0) - (memory?.firstHeapUsedBytes ?? 0))
  })
})
