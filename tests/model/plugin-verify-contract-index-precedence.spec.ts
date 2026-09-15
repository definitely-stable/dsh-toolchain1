import { describe, expect, it } from 'vitest'

import {
  reducePluginVerification,
  type PluginVerificationReductionInput,
} from '../../src/model/plugin-verify.js'
import type { PluginCheckResult, VerificationReport } from '../../src/protocol/index.js'

const ARTIFACT = `dsh-plugin-artifact-v1:${'a'.repeat(64)}`
const TARGET = `dsh-target-v2:${'b'.repeat(64)}`
const DRIFTED_TARGET = `dsh-target-v2:${'c'.repeat(64)}`
const CONTRACT_INDEX = `dsh-contract-index-v1:${'d'.repeat(64)}`
const DRIFTED_CONTRACT_INDEX = `dsh-contract-index-v1:${'e'.repeat(64)}`
const LIFECYCLE = `dsh-profile-lifecycle-v1:${'1'.repeat(64)}`
const DRIFTED_LIFECYCLE = `dsh-profile-lifecycle-v1:${'2'.repeat(64)}`

type Check = VerificationReport['checks'][number]

function checks(): Check[] {
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
    { id: 'behavior', status: 'skipped', reason: 'no-behavior-assertions' },
  ]
}

function staticResult(): PluginCheckResult {
  return {
    contractIndexFingerprint: CONTRACT_INDEX,
    subjectFingerprint: `dsh-plugin-subject-v1:${'f'.repeat(64)}`,
    subjectCompleteness: 'complete',
    ruleset: 'plugin-static-alpha-v1',
    scopeComplete: false,
    verdict: 'compatible-in-scope',
    requirements: [],
    evidence: [],
    candidateCodeExecuted: false,
  }
}

function input(): PluginVerificationReductionInput {
  return {
    artifactFingerprint: ARTIFACT,
    initialTargetFingerprint: TARGET,
    finalTargetFingerprint: DRIFTED_TARGET,
    initialContractIndexFingerprint: CONTRACT_INDEX,
    finalContractIndexFingerprint: DRIFTED_CONTRACT_INDEX,
    staticResult: staticResult(),
    staticDiagnostics: [],
    execution: {
      artifactFingerprint: ARTIFACT,
      targetFingerprint: TARGET,
      executionPolicy: 'safe',
      checks: checks(),
      diagnostics: [],
      cleanup: 'succeeded',
      terminal: 'completed',
    },
  }
}

describe('plugin.verify freshness diagnostic precedence', () => {
  it('reports target drift without a redundant Contract Index drift diagnostic', () => {
    const report = reducePluginVerification(input())

    expect(report.status).toBe('stale')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_TARGET_STALE',
    }))
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'VERIFY_CONTRACT_INDEX_STALE',
    }))
  })

  it('reports lifecycle drift without attributing the same stale receipt to Contract Index drift', () => {
    const report = reducePluginVerification({
      ...input(),
      finalTargetFingerprint: TARGET,
      initialLifecycleFingerprint: LIFECYCLE,
      finalLifecycleFingerprint: DRIFTED_LIFECYCLE,
      execution: {
        ...input().execution,
        lifecycleFingerprint: LIFECYCLE,
      },
    })

    expect(report.status).toBe('stale')
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_LIFECYCLE_STALE',
    }))
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'VERIFY_CONTRACT_INDEX_STALE',
    }))
  })
})
