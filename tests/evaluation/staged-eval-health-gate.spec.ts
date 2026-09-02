import { describe, expect, it } from 'vitest'

import { evaluateMeasurementHealth } from '../../scripts/eval/health-gate.mjs'

function row(overrides: Partial<{ arm: 'B' | 'C'; formatValid: boolean; decisionResolved: boolean; infrastructureFailures: number; attemptCount: number }> = {}) {
  return {
    arm: 'B' as const,
    formatValid: true,
    decisionResolved: true,
    infrastructureFailures: 0,
    attemptCount: 1,
    ...overrides,
  }
}

describe('staged evaluation measurement health gate', () => {
  it('passes healthy balanced B/C observations', () => {
    const observations = [
      ...Array.from({ length: 50 }, () => row({ arm: 'B' })),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('PASS')
    expect(result.reasons).toEqual([])
    expect(result.metrics).toMatchObject({
      formatComplianceRate: 1,
      decisionResolutionRate: 1,
      infrastructureFailureRate: 0,
      resolutionGap: 0,
    })
  })

  it('stops when format compliance is below 98 percent', () => {
    const observations = [
      ...Array.from({ length: 49 }, () => row({ arm: 'B' })),
      row({ arm: 'B', formatValid: false }),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    expect(evaluateMeasurementHealth({ observations })).toMatchObject({
      status: 'STOP',
      reasons: ['FORMAT_COMPLIANCE_BELOW_MINIMUM'],
    })
  })

  it('stops when decision resolution is below 95 percent', () => {
    const observations = [
      ...Array.from({ length: 47 }, () => row({ arm: 'B' })),
      ...Array.from({ length: 3 }, () => row({ arm: 'B', decisionResolved: false })),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('STOP')
    expect(result.reasons).toContain('DECISION_RESOLUTION_BELOW_MINIMUM')
  })

  it('stops when infrastructure failures exceed 2 percent of attempts', () => {
    const observations = [
      ...Array.from({ length: 49 }, () => row({ arm: 'B' })),
      row({ arm: 'B', infrastructureFailures: 3, attemptCount: 4 }),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('STOP')
    expect(result.reasons).toContain('INFRASTRUCTURE_FAILURE_RATE_ABOVE_MAXIMUM')
  })

  it('stops when B and C resolution differ by more than five percentage points', () => {
    const observations = [
      ...Array.from({ length: 50 }, () => row({ arm: 'B' })),
      ...Array.from({ length: 45 }, () => row({ arm: 'C' })),
      ...Array.from({ length: 5 }, () => row({ arm: 'C', decisionResolved: false })),
    ]
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('STOP')
    expect(result.reasons).toContain('ARM_RESOLUTION_GAP_ABOVE_MAXIMUM')
  })

  it('rejects non B/C observations and empty input', () => {
    expect(() => evaluateMeasurementHealth({ observations: [] })).toThrow(/at least one observation/i)
    expect(() => evaluateMeasurementHealth({ observations: [{ ...row(), arm: 'A' }] })).toThrow(/arm must be B or C/i)
  })
})
