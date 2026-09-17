import { describe, expect, it } from 'vitest'

import { getPerfProfile, listPerfProfiles } from '../../scripts/perf/suites.mjs'

describe('performance suite profiles', () => {
  it('exposes only the bounded smoke, benchmark, and stress profiles', () => {
    expect(listPerfProfiles()).toEqual(['smoke', 'benchmark', 'stress'])
  })

  it('increases measured work monotonically without making PR smoke concurrent', () => {
    const smoke = getPerfProfile('smoke')
    const benchmark = getPerfProfile('benchmark')
    const stress = getPerfProfile('stress')

    expect(smoke.iterations).toBeLessThan(benchmark.iterations)
    expect(benchmark.iterations).toBeLessThan(stress.iterations)
    expect(smoke.scale).toBeLessThanOrEqual(benchmark.scale)
    expect(benchmark.scale).toBeLessThanOrEqual(stress.scale)
    expect(smoke.concurrency).toEqual([1])
    expect(Math.max(...benchmark.concurrency)).toBeLessThanOrEqual(4)
    expect(Math.max(...stress.concurrency)).toBeLessThanOrEqual(16)
  })

  it('keeps all profile bounds positive safe integers and frozen', () => {
    for (const name of listPerfProfiles()) {
      const profile = getPerfProfile(name)
      expect(Object.isFrozen(profile)).toBe(true)
      expect(Object.isFrozen(profile.concurrency)).toBe(true)
      for (const value of [profile.warmups, profile.iterations, profile.scale, ...profile.concurrency]) {
        expect(Number.isSafeInteger(value)).toBe(true)
        expect(value).toBeGreaterThan(0)
      }
    }
  })

  it('rejects unknown profiles', () => {
    expect(() => getPerfProfile('unbounded')).toThrow(/unknown performance profile/i)
  })
})
