import { describe, expect, it } from 'vitest'

import {
  buildContingency,
  computePairedOutcomes,
  decideH2Outcome,
  exactOneSidedMcNemarP,
} from '../../scripts/eval/h2/h2-statistics.mjs'

const resolved = (b: boolean, c: boolean) => ({ bSuccess: b, cSuccess: c, resolved: true })

describe('H2 exact paired McNemar', () => {
  it('computes the preregistered anchor values exactly', () => {
    // C-only=5, B-only=0 -> p = 1/2^5 = 0.03125
    expect(exactOneSidedMcNemarP({ cOnly: 5, bOnly: 0 })).toBeCloseTo(0.03125, 12)
    // C-only=4, B-only=0 -> p = 1/2^4 = 0.0625
    expect(exactOneSidedMcNemarP({ cOnly: 4, bOnly: 0 })).toBeCloseTo(0.0625, 12)
  })

  it('computes the one-sided sum over the upper tail of the discordant binomial', () => {
    // P(X >= 2 | X ~ Bin(3, 0.5)) = (C(3,2)+C(3,3))/8 = 4/8 = 0.5
    expect(exactOneSidedMcNemarP({ cOnly: 2, bOnly: 1 })).toBeCloseTo(0.5, 12)
    // P(X >= 3 | X ~ Bin(3, 0.5)) = 1/8 = 0.125
    expect(exactOneSidedMcNemarP({ cOnly: 3, bOnly: 0 })).toBeCloseTo(0.125, 12)
    // One C-only and one B-only discordant pair: P(X >= 1 | Bin(2, 0.5)) = 3/4
    expect(exactOneSidedMcNemarP({ cOnly: 1, bOnly: 1 })).toBeCloseTo(0.75, 12)
    // Symmetric discordance is far from the 0.05 threshold: P(X >= 1 | Bin(2, 0.5)) = 0.75
    expect(exactOneSidedMcNemarP({ cOnly: 1, bOnly: 1 }) <= 0.05).toBe(false)
    // No discordant pairs: the test cannot confirm anything
    expect(exactOneSidedMcNemarP({ cOnly: 0, bOnly: 0 })).toBe(1)
  })

  it('decides exactly at the preregistered threshold without floating-point fuzz', () => {
    expect(exactOneSidedMcNemarP({ cOnly: 5, bOnly: 0 }) <= 0.05).toBe(true)
    expect(exactOneSidedMcNemarP({ cOnly: 4, bOnly: 0 }) <= 0.05).toBe(false)
  })

  it('rejects negative or non-integer discordant counts loudly', () => {
    expect(() => exactOneSidedMcNemarP({ cOnly: -1, bOnly: 0 })).toThrow()
    expect(() => exactOneSidedMcNemarP({ cOnly: 1.5, bOnly: 0 })).toThrow()
  })
})

describe('H2 paired outcomes and contingency', () => {
  it('builds the paired contingency from per-task outcomes', () => {
    const pairs = [
      resolved(true, true),
      resolved(true, false),
      resolved(false, true),
      resolved(false, false),
      resolved(true, true),
    ]
    const contingency = buildContingency(pairs)
    expect(contingency).toEqual({ bothSuccess: 2, bOnly: 1, cOnly: 1, bothFail: 1, totalPairs: 5 })
    expect(computePairedOutcomes(pairs)).toEqual({
      bSuccess: 3,
      cSuccess: 3,
      bSuccessRate: 3 / 5,
      cSuccessRate: 3 / 5,
      delta: 0,
    })
  })

  it('refuses to compute paired outcomes when any pair is unresolved', () => {
    const pairs = [resolved(true, true), { bSuccess: false, cSuccess: false, resolved: false }]
    expect(() => computePairedOutcomes(pairs)).toThrow(/unresolved/)
  })
})

describe('H2 outcome decision', () => {
  it('declares CONFIRMED_BENEFIT only when C wins, delta meets MCID and McNemar p <= 0.05', () => {
    // Construct explicitly: pairs 3..7 are B=false, C=true; the rest both true
    const pairs = Array.from({ length: 18 }, (_, i) =>
      i >= 3 && i < 8 ? resolved(false, true) : resolved(true, true))
    const decision = decideH2Outcome({ pairs, allResolved: true })
    expect(decision.outcome).toBe('CONFIRMED_BENEFIT')
    expect(decision.contingency).toEqual({ bothSuccess: 13, bOnly: 0, cOnly: 5, bothFail: 0, totalPairs: 18 })
    expect(decision.delta).toBe(5 / 18)
    expect(decision.pValue).toBeCloseTo(0.03125, 12)
  })

  it('declares INCONCLUSIVE for a moderate positive effect below the decision threshold', () => {
    // 4 C-only wins, 0 B-only wins: delta = 4/18, p = 0.0625
    const pairs = Array.from({ length: 18 }, (_, i) =>
      i >= 3 && i < 7 ? resolved(false, true) : resolved(true, true))
    const decision = decideH2Outcome({ pairs, allResolved: true })
    expect(decision.outcome).toBe('INCONCLUSIVE')
    expect(decision.pValue).toBeCloseTo(0.0625, 12)
  })

  it('never interprets a null or negative effect as proof of no benefit', () => {
    const pairs = Array.from({ length: 18 }, (_, i) =>
      i % 3 === 0 ? resolved(false, true) : resolved(true, false))
    const decision = decideH2Outcome({ pairs, allResolved: true })
    expect(decision.outcome).toBe('INCONCLUSIVE')
  })

  it('refuses confirmatory analysis when any observation is unresolved', () => {
    const pairs = Array.from({ length: 18 }, () => resolved(true, true))
    pairs[7] = { bSuccess: false, cSuccess: false, resolved: false }
    const decision = decideH2Outcome({ pairs, allResolved: false })
    expect(decision.outcome).toBe('STOPPED_INVALID')
    expect(decision).not.toHaveProperty('pValue')
  })
})
