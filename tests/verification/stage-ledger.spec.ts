import { describe, expect, it } from 'vitest'

import {
  createM41StageLedger,
  failVerificationStage,
  passVerificationStage,
  skipVerificationStage,
} from '../../src/verification/stages.js'

const stageIds = [
  'structure',
  'manifest',
  'dependency',
  'contract',
  'build',
  'package',
  'install',
  'compose',
  'boot',
  'visibility',
  'behavior',
] as const

describe('M4.1 verification stage ledger', () => {
  it('starts with all Protocol v1 stages in canonical order and no synthetic pass', () => {
    const checks = createM41StageLedger()

    expect(checks.map(check => check.id)).toEqual(stageIds)
    expect(checks.every(check => check.status === 'skipped')).toBe(true)
    expect(checks.slice(0, 5).map(check => check.reason)).toEqual([
      'handled-by-static-check',
      'handled-by-static-check',
      'handled-by-static-check',
      'handled-by-static-check',
      'not-requested-in-m4.1',
    ])
    expect(checks[5]?.reason).toBe('not-executed')
    expect(checks[9]?.reason).toBe('no-visibility-assertions')
    expect(checks[10]?.reason).toBe('not-supported-in-m4.1')
  })

  it('allows an explicit stage to pass without changing unrelated stages', () => {
    const initial = createM41StageLedger()
    const next = passVerificationStage(initial, 'package')

    expect(next).not.toBe(initial)
    expect(next.find(check => check.id === 'package')).toEqual({ id: 'package', status: 'passed' })
    expect(next.find(check => check.id === 'install')).toEqual({
      id: 'install',
      status: 'skipped',
      reason: 'not-executed',
    })
    expect(initial.find(check => check.id === 'package')).toEqual({
      id: 'package',
      status: 'skipped',
      reason: 'not-executed',
    })
  })

  it('fails one runtime stage and deterministically skips every downstream execution stage', () => {
    let checks = createM41StageLedger()
    checks = passVerificationStage(checks, 'package')
    checks = failVerificationStage(checks, 'install', 'install-command-failed')

    expect(checks.find(check => check.id === 'package')).toEqual({ id: 'package', status: 'passed' })
    expect(checks.find(check => check.id === 'install')).toEqual({
      id: 'install',
      status: 'failed',
      reason: 'install-command-failed',
    })
    for (const id of ['compose', 'boot', 'visibility'] as const) {
      expect(checks.find(check => check.id === id)).toEqual({
        id,
        status: 'skipped',
        reason: 'prerequisite-install-failed',
      })
    }
    expect(checks.find(check => check.id === 'behavior')).toEqual({
      id: 'behavior',
      status: 'skipped',
      reason: 'not-supported-in-m4.1',
    })
  })

  it('preserves already completed upstream evidence when a later stage fails', () => {
    let checks = createM41StageLedger()
    for (const id of ['package', 'install', 'compose'] as const) checks = passVerificationStage(checks, id)
    checks = failVerificationStage(checks, 'boot', 'boot-probe-failed')

    expect(checks.filter(check => ['package', 'install', 'compose'].includes(check.id)).map(check => check.status))
      .toEqual(['passed', 'passed', 'passed'])
    expect(checks.find(check => check.id === 'boot')).toEqual({
      id: 'boot',
      status: 'failed',
      reason: 'boot-probe-failed',
    })
    expect(checks.find(check => check.id === 'visibility')).toEqual({
      id: 'visibility',
      status: 'skipped',
      reason: 'prerequisite-boot-failed',
    })
  })

  it('records an explicit skip without implying success', () => {
    const checks = skipVerificationStage(createM41StageLedger(), 'visibility', 'assertion-not-applicable')

    expect(checks.find(check => check.id === 'visibility')).toEqual({
      id: 'visibility',
      status: 'skipped',
      reason: 'assertion-not-applicable',
    })
  })

  it('rejects passing a downstream runtime stage while its prerequisite is unexecuted', () => {
    expect(() => passVerificationStage(createM41StageLedger(), 'compose')).toThrow(/prerequisite|install/i)
    expect(() => passVerificationStage(createM41StageLedger(), 'boot')).toThrow(/prerequisite|compose/i)
  })

  it('never permits static M4.1 stages or behavior to be marked passed by runtime helpers', () => {
    for (const id of ['structure', 'manifest', 'dependency', 'contract', 'build', 'behavior'] as const) {
      expect(() => passVerificationStage(createM41StageLedger(), id)).toThrow(/m4\.1|runtime|stage/i)
    }
  })
})
