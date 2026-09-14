import { describe, expect, it } from 'vitest'

import {
  reducePluginVerification,
  type PluginVerificationReductionInput,
} from '../../src/model/plugin-verify.js'
import type { PluginCheckResult, VerificationReport } from '../../src/protocol/index.js'

const ARTIFACT = `dsh-plugin-artifact-v1:${'a'.repeat(64)}`
const TARGET = `dsh-target-v2:${'b'.repeat(64)}`

type Check = VerificationReport['checks'][number]

function runtimeChecks(): Check[] {
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
    { id: 'behavior', status: 'skipped', reason: 'not-supported-in-m4.1' },
  ]
}

function mismatchRequirement(): PluginCheckResult['requirements'][number] {
  return {
    packageName: '@deepseek-ai/cordis',
    range: '^5.0.0',
    relationship: 'host-peer-required',
    status: 'version-mismatch',
    targetVersion: '4.0.2',
    evidenceIds: [],
  }
}

function missingRequirement(): PluginCheckResult['requirements'][number] {
  return {
    packageName: '@deepseek-ai/dsh',
    range: '^0.2.0',
    relationship: 'host-peer-required',
    status: 'missing',
    evidenceIds: [],
  }
}

function input(requirements: PluginCheckResult['requirements']): PluginVerificationReductionInput {
  return {
    artifactFingerprint: ARTIFACT,
    initialTargetFingerprint: TARGET,
    finalTargetFingerprint: TARGET,
    staticResult: {
      contractIndexFingerprint: `dsh-contract-index-v1:${'c'.repeat(64)}`,
      subjectFingerprint: `dsh-plugin-subject-v1:${'d'.repeat(64)}`,
      subjectCompleteness: 'complete',
      ruleset: 'plugin-static-alpha-v1',
      scopeComplete: false,
      verdict: 'incompatible',
      requirements,
      evidence: [],
      candidateCodeExecuted: false,
    },
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
  }
}

function dependencyCheck(report: VerificationReport): Check {
  const found = report.checks.find(check => check.id === 'dependency')
  if (found === undefined) throw new Error('missing dependency check')
  return found
}

describe('M3.2 static version mismatch verification reduction', () => {
  it('fails the dependency stage explicitly without reporting static uncertainty', () => {
    const report = reducePluginVerification(input([mismatchRequirement()]))

    expect(report.status).toBe('failed')
    expect(dependencyCheck(report)).toEqual({
      id: 'dependency',
      status: 'failed',
      reason: 'static-host-requirement-version-mismatch',
    })
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'VERIFY_STATIC_UNPROVEN',
    }))
  })

  it('preserves missing-required-peer precedence when missing and mismatch coexist', () => {
    const report = reducePluginVerification(input([
      mismatchRequirement(),
      missingRequirement(),
    ]))

    expect(report.status).toBe('failed')
    expect(dependencyCheck(report)).toEqual({
      id: 'dependency',
      status: 'failed',
      reason: 'static-host-requirement-missing',
    })
  })
})
