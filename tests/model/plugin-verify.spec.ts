import { describe, expect, it } from 'vitest'

import {
  reducePluginVerification,
  type PluginVerificationReductionInput,
} from '../../src/model/plugin-verify.js'
import type {
  Diagnostic,
  PluginCheckResult,
  VerificationReport,
} from '../../src/protocol/index.js'

const ARTIFACT = `dsh-plugin-artifact-v1:${'a'.repeat(64)}`
const TARGET = `dsh-target-v2:${'b'.repeat(64)}`
const DRIFTED_TARGET = `dsh-target-v2:${'c'.repeat(64)}`

function staticResult(overrides: Partial<PluginCheckResult> = {}): PluginCheckResult {
  return {
    contractIndexFingerprint: `dsh-contract-index-v1:${'d'.repeat(64)}`,
    subjectFingerprint: `dsh-plugin-subject-v1:${'e'.repeat(64)}`,
    subjectCompleteness: 'complete',
    ruleset: 'plugin-static-alpha-v1',
    scopeComplete: false,
    verdict: 'compatible-in-scope',
    requirements: [],
    evidence: [],
    candidateCodeExecuted: false,
    ...overrides,
  }
}

type Check = VerificationReport['checks'][number]

function runtimeChecks(overrides: Partial<Record<Check['id'], Check>> = {}): Check[] {
  const defaults: Check[] = [
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
    { id: 'behavior', status: 'skipped', reason: 'not-supported-in-m4.1' },
  ]
  return defaults.map(check => overrides[check.id] ?? check)
}

function input(overrides: Partial<PluginVerificationReductionInput> = {}): PluginVerificationReductionInput {
  return {
    artifactFingerprint: ARTIFACT,
    initialTargetFingerprint: TARGET,
    finalTargetFingerprint: TARGET,
    staticResult: staticResult(),
    staticDiagnostics: [],
    execution: {
      artifactFingerprint: ARTIFACT,
      targetFingerprint: TARGET,
      executionPolicy: 'safe',
      checks: runtimeChecks(),
      diagnostics: [],
      cleanup: 'succeeded',
      terminal: 'completed',
    },
    ...overrides,
  }
}

function check(report: VerificationReport, id: Check['id']): Check {
  const found = report.checks.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`missing ${id}`)
  return found
}

describe('M4.2 public verification reducer', () => {
  it('returns verified only for fresh exact-artifact completed execution with proven required static checks', () => {
    const report = reducePluginVerification(input())

    expect(report.status).toBe('verified')
    expect(report.artifactFingerprint).toBe(ARTIFACT)
    expect(report.targetFingerprint).toBe(TARGET)
    expect(report.executionPolicy).toBe('safe')
    expect(report.cleanup).toBe('succeeded')
    expect(report.checks.map(item => item.id)).toEqual([
      'structure', 'manifest', 'dependency', 'contract', 'build', 'package',
      'install', 'compose', 'boot', 'visibility', 'behavior',
    ])
    expect(check(report, 'structure').status).toBe('passed')
    expect(check(report, 'manifest').status).toBe('passed')
    expect(check(report, 'dependency').status).toBe('passed')
    expect(check(report, 'contract').status).toBe('passed')
  })

  it('keeps proven static incompatibility failed even when runtime stages pass', () => {
    const report = reducePluginVerification(input({
      staticResult: staticResult({
        verdict: 'incompatible',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '4.0.1',
          relationship: 'host-peer-required',
          status: 'missing',
          evidenceIds: [],
        }],
      }),
    }))

    expect(report.status).toBe('failed')
    expect(check(report, 'dependency').status).toBe('failed')
    expect(check(report, 'contract').status).toBe('failed')
  })

  it('returns failed when a required runtime stage fails', () => {
    const diagnostic: Diagnostic = {
      code: 'VERIFY_BOOT_FAILED',
      severity: 'error',
      domain: 'verification',
      summary: 'boot failed',
    }
    const report = reducePluginVerification(input({
      execution: {
        artifactFingerprint: ARTIFACT,
        targetFingerprint: TARGET,
        executionPolicy: 'safe',
        checks: runtimeChecks({
          boot: { id: 'boot', status: 'failed', reason: 'verify-boot-failed' },
        }),
        diagnostics: [diagnostic],
        cleanup: 'succeeded',
        terminal: 'failed',
      },
    }))

    expect(report.status).toBe('failed')
    expect(report.diagnostics).toContainEqual(diagnostic)
  })

  it('returns partial when cleanup fails after otherwise completed verification', () => {
    const cleanupDiagnostic: Diagnostic = {
      code: 'VERIFY_CLEANUP_FAILED',
      severity: 'error',
      domain: 'verification',
      summary: 'cleanup failed',
    }
    const report = reducePluginVerification(input({
      execution: {
        artifactFingerprint: ARTIFACT,
        targetFingerprint: TARGET,
        executionPolicy: 'safe',
        checks: runtimeChecks(),
        diagnostics: [cleanupDiagnostic],
        cleanup: 'failed',
        terminal: 'completed',
      },
    }))

    expect(report.status).toBe('partial')
    expect(report.diagnostics.filter(item => item.code === 'VERIFY_CLEANUP_FAILED')).toHaveLength(1)
  })

  it('returns partial when a material static requirement is unproven', () => {
    const report = reducePluginVerification(input({
      staticResult: staticResult({
        verdict: 'unproven',
        requirements: [{
          packageName: '@deepseek-ai/cordis',
          range: '^4.0.1',
          relationship: 'host-peer-required',
          status: 'unproven',
          targetVersion: '4.0.1',
          evidenceIds: [],
        }],
      }),
    }))

    expect(report.status).toBe('partial')
    expect(check(report, 'dependency').status).toBe('skipped')
    expect(check(report, 'contract').status).toBe('skipped')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_STATIC_UNPROVEN',
      severity: 'warning',
      domain: 'verification',
    }))
  })

  it('returns stale when the target changes after non-cancelled execution', () => {
    const report = reducePluginVerification(input({ finalTargetFingerprint: DRIFTED_TARGET }))

    expect(report.status).toBe('stale')
    expect(report.targetFingerprint).toBe(TARGET)
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_TARGET_STALE',
      severity: 'error',
      domain: 'verification',
    }))
  })

  it('preserves cancelled as stronger than post-run target drift', () => {
    const report = reducePluginVerification(input({
      finalTargetFingerprint: DRIFTED_TARGET,
      execution: {
        artifactFingerprint: ARTIFACT,
        targetFingerprint: TARGET,
        executionPolicy: 'safe',
        checks: runtimeChecks({
          boot: { id: 'boot', status: 'failed', reason: 'verify-cancelled' },
        }),
        diagnostics: [{
          code: 'VERIFY_CANCELLED',
          severity: 'warning',
          domain: 'verification',
          summary: 'cancelled',
        }],
        cleanup: 'succeeded',
        terminal: 'cancelled',
      },
    }))

    expect(report.status).toBe('cancelled')
  })

  it('fails closed when worker artifact identity does not match the pre-bound artifact', () => {
    const report = reducePluginVerification(input({
      execution: {
        artifactFingerprint: `dsh-plugin-artifact-v1:${'f'.repeat(64)}`,
        targetFingerprint: TARGET,
        executionPolicy: 'safe',
        checks: runtimeChecks(),
        diagnostics: [],
        cleanup: 'succeeded',
        terminal: 'completed',
      },
    }))

    expect(report.status).toBe('failed')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_ARTIFACT_IDENTITY_MISMATCH',
      severity: 'error',
      domain: 'verification',
    }))
  })
})
