import { describe, expect, it } from 'vitest'

import { reducePluginVerification } from '../../src/model/plugin-verify.js'
import type { PluginCheckResult, VerificationReport } from '../../src/protocol/index.js'

const ARTIFACT = `dsh-plugin-artifact-v1:${'a'.repeat(64)}`
const TARGET = `dsh-target-v2:${'b'.repeat(64)}`
const CONTRACT_INDEX = `dsh-contract-index-v1:${'d'.repeat(64)}`

type Check = VerificationReport['checks'][number]

function staticResult(): PluginCheckResult {
  return {
    contractIndexFingerprint: CONTRACT_INDEX,
    subjectFingerprint: `dsh-plugin-subject-v1:${'e'.repeat(64)}`,
    subjectCompleteness: 'complete',
    ruleset: 'plugin-static-alpha-v1',
    scopeComplete: false,
    verdict: 'compatible-in-scope',
    requirements: [],
    evidence: [],
    candidateCodeExecuted: false,
  }
}

function checks(behavior: Check): Check[] {
  return [
    { id: 'structure', status: 'skipped', reason: 'handled-by-static-check' },
    { id: 'manifest', status: 'skipped', reason: 'handled-by-static-check' },
    { id: 'dependency', status: 'skipped', reason: 'handled-by-static-check' },
    { id: 'contract', status: 'skipped', reason: 'handled-by-static-check' },
    { id: 'build', status: 'skipped', reason: 'not-requested-in-m4.1' },
    { id: 'package', status: 'passed' },
    { id: 'install', status: 'passed' },
    { id: 'compose', status: 'passed' },
    { id: 'boot', status: 'passed' },
    { id: 'visibility', status: 'skipped', reason: 'no-visibility-assertions' },
    behavior,
  ]
}

function reduce(behavior: Check, diagnostics: VerificationReport['diagnostics'] = []): VerificationReport {
  return reducePluginVerification({
    artifactFingerprint: ARTIFACT,
    initialTargetFingerprint: TARGET,
    finalTargetFingerprint: TARGET,
    initialContractIndexFingerprint: CONTRACT_INDEX,
    finalContractIndexFingerprint: CONTRACT_INDEX,
    staticResult: staticResult(),
    staticDiagnostics: [],
    execution: {
      artifactFingerprint: ARTIFACT,
      targetFingerprint: TARGET,
      executionPolicy: 'safe',
      checks: checks(behavior),
      diagnostics,
      cleanup: 'succeeded',
      terminal: 'completed',
    },
  })
}

describe('plugin.verify behavior reduction', () => {
  it('keeps the no-assertion behavior baseline non-blocking', () => {
    const report = reduce({ id: 'behavior', status: 'skipped', reason: 'no-behavior-assertions' })
    expect(report.status).toBe('verified')
  })

  it('treats a requested behavior failure as verification failure', () => {
    const behaviorDiagnostic = {
      code: 'VERIFY_BEHAVIOR_FAILED',
      severity: 'error' as const,
      domain: 'verification',
      summary: 'Requested Agent Tool behavior did not match its expected structured result.',
    }
    const report = reduce(
      { id: 'behavior', status: 'failed', reason: 'verify-behavior-failed' },
      [behaviorDiagnostic],
    )

    expect(report.status).toBe('failed')
    expect(report.diagnostics).toContainEqual(behaviorDiagnostic)
  })

  it('returns partial and reports uncertainty when requested behavior was not executed', () => {
    const report = reduce({
      id: 'behavior',
      status: 'skipped',
      reason: 'behavior-assertions-not-executed',
    })

    expect(report.status).toBe('partial')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_BEHAVIOR_UNPROVEN',
      severity: 'warning',
      domain: 'verification',
    }))
  })

  it('does not invent optional assertion uncertainty when no visibility or behavior assertion was requested and boot failed', () => {
    const bootDiagnostic = {
      code: 'VERIFY_BOOT_FAILED',
      severity: 'error' as const,
      domain: 'verification',
      summary: 'Verification boot failed.',
    }
    const runtimeChecks = checks({
      id: 'behavior',
      status: 'skipped',
      reason: 'prerequisite-boot-failed',
    }).map(check => check.id === 'boot'
      ? { id: 'boot' as const, status: 'failed' as const, reason: 'verify-boot-failed' }
      : check)

    const report = reducePluginVerification({
      artifactFingerprint: ARTIFACT,
      initialTargetFingerprint: TARGET,
      finalTargetFingerprint: TARGET,
      initialContractIndexFingerprint: CONTRACT_INDEX,
      finalContractIndexFingerprint: CONTRACT_INDEX,
      staticResult: staticResult(),
      staticDiagnostics: [],
      execution: {
        artifactFingerprint: ARTIFACT,
        targetFingerprint: TARGET,
        executionPolicy: 'safe',
        checks: runtimeChecks,
        diagnostics: [bootDiagnostic],
        cleanup: 'succeeded',
        terminal: 'failed',
      },
    })

    expect(report.status).toBe('failed')
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'VERIFY_VISIBILITY_UNPROVEN',
    }))
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'VERIFY_BEHAVIOR_UNPROVEN',
    }))
  })
})
