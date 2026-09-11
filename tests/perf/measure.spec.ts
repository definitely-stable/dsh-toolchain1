import { describe, expect, it } from 'vitest'

import { measureSample } from '../../scripts/perf/measure.mjs'

describe('performance sample measurement', () => {
  it('records elapsed, CPU, memory, ELU, metadata, and the operation value', async () => {
    const measured = await measureSample({
      caseName: 'unit-control',
      phase: 'measure',
      iteration: 2,
      concurrency: 1,
      operation: async () => {
        await Promise.resolve()
        return { fingerprint: 'stable' }
      },
    })

    expect(measured.value).toEqual({ fingerprint: 'stable' })
    expect(measured.sample).toMatchObject({
      schema: 'dsh-perf-sample-v1',
      caseName: 'unit-control',
      phase: 'measure',
      iteration: 2,
      concurrency: 1,
      outcome: 'ok',
    })
    expect(measured.sample.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(measured.sample.cpu.userMicros).toBeGreaterThanOrEqual(0)
    expect(measured.sample.cpu.systemMicros).toBeGreaterThanOrEqual(0)
    expect(measured.sample.memory.rssBytes).toBeGreaterThan(0)
    expect(measured.sample.memory.heapUsedBytes).toBeGreaterThan(0)
    expect(measured.sample.memory.maxRssKiB).toBeGreaterThan(0)
    expect(measured.sample.eventLoop.utilization).toBeGreaterThanOrEqual(0)
    expect(measured.sample.eventLoop.utilization).toBeLessThanOrEqual(1)
  })

  it('does not swallow operation failures', async () => {
    await expect(measureSample({
      caseName: 'failure-control',
      phase: 'measure',
      iteration: 1,
      concurrency: 1,
      operation: async () => { throw new Error('expected failure') },
    })).rejects.toThrow('expected failure')
  })
})
