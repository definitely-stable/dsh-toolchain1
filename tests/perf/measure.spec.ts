import { describe, expect, it } from 'vitest'

import { measureSample } from '../../scripts/perf/measure.mjs'

describe('performance sample measurement', () => {
  it('records elapsed, CPU, point-in-time memory, ELU, metadata, and the operation value', async () => {
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

    expect(measured.error).toBeUndefined()
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
    expect(measured.sample.memory).not.toHaveProperty('maxRssKiB')
    expect(measured.sample.eventLoop.utilization).toBeGreaterThanOrEqual(0)
    expect(measured.sample.eventLoop.utilization).toBeLessThanOrEqual(1)
  })

  it('captures bounded sanitized failure evidence without swallowing the original error', async () => {
    process.env.PERF_TEST_SECRET = 'do-not-leak-this-value'
    const failure = new Error(`expected failure ${process.env.PERF_TEST_SECRET} ${process.cwd()} ${'x'.repeat(900)}`)

    try {
      const measured = await measureSample({
        caseName: 'failure-control',
        phase: 'measure',
        iteration: 1,
        concurrency: 1,
        operation: async () => { throw failure },
      })

      expect(measured.error).toBe(failure)
      expect(measured.value).toBeUndefined()
      expect(measured.sample.outcome).toBe('error')
      expect(measured.sample.elapsedMs).toBeGreaterThanOrEqual(0)
      expect(measured.sample.memory.rssBytes).toBeGreaterThan(0)
      expect(measured.sample.error?.name).toBe('Error')
      expect(measured.sample.error?.message.length).toBeLessThanOrEqual(512)
      expect(measured.sample.error?.message).not.toContain('do-not-leak-this-value')
      expect(measured.sample.error?.message).not.toContain(process.cwd())
    } finally {
      delete process.env.PERF_TEST_SECRET
    }
  })
})
