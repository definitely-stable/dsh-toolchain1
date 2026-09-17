import { describe, expect, it } from 'vitest'

import { percentile, summarizeNumbers } from '../../scripts/perf/statistics.mjs'

describe('performance statistics', () => {
  it('uses nearest-rank percentiles independent of input order', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20)
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40)
    expect(percentile([40, 10, 30, 20], 0.99)).toBe(40)
  })

  it('summarizes a finite non-empty sample', () => {
    expect(summarizeNumbers([1, 2, 3, 4])).toEqual({
      count: 4,
      min: 1,
      max: 4,
      mean: 2.5,
      p50: 2,
      p95: 4,
      p99: 4,
    })
  })

  it('fails closed for empty, non-finite, or invalid percentile input', () => {
    expect(() => percentile([], 0.5)).toThrow(/non-empty/i)
    expect(() => percentile([1, Number.NaN], 0.5)).toThrow(/finite/i)
    expect(() => percentile([1], -0.1)).toThrow(/percentile/i)
    expect(() => percentile([1], 1.1)).toThrow(/percentile/i)
    expect(() => summarizeNumbers([])).toThrow(/non-empty/i)
  })
})
