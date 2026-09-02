import { describe, expect, it } from 'vitest'

import { evaluateMeasurementHealth } from '../../scripts/eval/health-gate.mjs'

function row(overrides: Partial<{ arm: 'B' | 'C'; formatValid: boolean; decisionResolved: boolean; infrastructureFailures: number; attemptCount: number; hasModelOutcome: boolean; unrecoveredInfrastructure: boolean }> = {}) {
  return {
    arm: 'B' as const,
    formatValid: true,
    decisionResolved: true,
    infrastructureFailures: 0,
    attemptCount: 1,
    hasModelOutcome: true,
    unrecoveredInfrastructure: false,
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
      unrecoveredInfrastructureRate: 0,
      retryAttemptRate: 0,
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

  it('stops on unrecovered infrastructure missingness above two percent', () => {
    const observations = [
      ...Array.from({ length: 49 }, () => row({ arm: 'B' })),
      ...Array.from({ length: 3 }, () => row({ arm: 'B', hasModelOutcome: false, formatValid: false, decisionResolved: false, infrastructureFailures: 1, attemptCount: 1, unrecoveredInfrastructure: true })),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('STOP')
    expect(result.reasons).toContain('UNRECOVERED_INFRASTRUCTURE_RATE_ABOVE_MAXIMUM')
  })

  it('reports recovered retry attempts without invalidating an otherwise healthy measurement', () => {
    const observations = [
      ...Array.from({ length: 50 }, () => row({ arm: 'B' })),
      ...Array.from({ length: 50 }, () => row({ arm: 'C' })),
    ]
    observations[0] = row({ arm: 'B', infrastructureFailures: 1, attemptCount: 2, hasModelOutcome: true, unrecoveredInfrastructure: false })
    const result = evaluateMeasurementHealth({ observations })
    expect(result.status).toBe('PASS')
    expect(result.metrics.retryAttemptRate).toBeGreaterThan(0)
    expect(result.metrics.unrecoveredInfrastructureRate).toBe(0)
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
