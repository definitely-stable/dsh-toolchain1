import { describe, expect, it } from 'vitest'

import { createApplicationKernel } from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type {
  ContractDefinition,
  Evidence,
  TargetSnapshot,
} from '../../src/protocol/index.js'
import type { PluginVerificationExecutionObservation } from '../../src/model/plugin-verify.js'

const ARTIFACT_HASH = '9'.repeat(64)
const ARTIFACT_FINGERPRINT = `dsh-plugin-artifact-v1:${ARTIFACT_HASH}`
const INITIAL_TARGET_FINGERPRINT = `dsh-target-v2:${'a'.repeat(64)}`
const DRIFTED_TARGET_FINGERPRINT = `dsh-target-v2:${'f'.repeat(64)}`

function targetFacts(version = '0.1.1-rc.2'): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [{ name: '@deepseek-ai/cordis', version: '4.0.1' }],
      profilePatchHash: '1'.repeat(64),
      homePatchHash: '2'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
  }
}

function contractFacts(): AcquiredContractFacts {
  const evidence: Evidence = {
    id: 'manifest:cordis',
    kind: 'manifest',
    strength: 'authoritative',
    contentHash: '3'.repeat(64),
  }
  const contract: ContractDefinition = {
    id: 'package:@deepseek-ai/cordis',
    kind: 'package',
    name: '@deepseek-ai/cordis',
    qualifiedName: 'package:@deepseek-ai/cordis',
    availability: 'unknown',
    facts: [{ key: 'version', value: '4.0.1', evidenceIds: [evidence.id] }],
    evidenceIds: [evidence.id],
  }
  return { evidence: [evidence], contracts: [contract] }
}

function packedSubject(overrides: Partial<AcquiredPluginSubject> = {}): AcquiredPluginSubject {
  return {
    completeness: 'complete',
    packageName: 'example-dsh-plugin',
    packageVersion: '1.0.0',
    requirements: [{
      packageName: '@deepseek-ai/cordis',
      range: '4.0.1',
      relationship: 'host-peer-required',
    }],
    evidence: [
      {
        id: 'plugin:manifest',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: '5'.repeat(64),
      },
      {
        id: 'plugin:packed-artifact',
        kind: 'package',
        strength: 'authoritative',
        contentHash: ARTIFACT_HASH,
        location: '/candidate.tgz',
      },
    ],
    diagnostics: [],
    ...overrides,
  }
}

function completedExecution(target: TargetSnapshot): PluginVerificationExecutionObservation {
  return {
    artifactFingerprint: ARTIFACT_FINGERPRINT,
    targetFingerprint: target.fingerprint,
    executionPolicy: 'safe',
    checks: [
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
    ],
    diagnostics: [],
    cleanup: 'succeeded',
    terminal: 'completed',
  }
}

function digest() {
  return {
    sha256Utf8: async (value: string) => value.includes('dsh-plugin-subject-v1')
      ? 'c'.repeat(64)
      : value.includes('dsh-contract-index-v1')
        ? 'b'.repeat(64)
        : value.includes('0.1.2-drift')
          ? 'f'.repeat(64)
          : 'a'.repeat(64),
  }
}

describe('plugin.verify kernel orchestration', () => {
  it('passes one exact initial snapshot and same-pass authoritative packed hash to the execution port, then re-resolves freshness', async () => {
    let targetAcquisitions = 0
    let contractAcquisitions = 0
    let pluginAcquisitions = 0
    const executionInputs: Array<{
      artifactPath: string
      expectedContentHash: string
      target: TargetSnapshot
      executionPolicy: 'safe'
    }> = []

    const kernel = createApplicationKernel({
      targetAcquisition: {
        acquire: async () => {
          targetAcquisitions += 1
          return targetFacts()
        },
      },
      contractAcquisition: {
        acquire: async () => {
          contractAcquisitions += 1
          return contractFacts()
        },
      },
      pluginSubjectAcquisition: {
        acquire: async subject => {
          pluginAcquisitions += 1
          expect(subject).toEqual({ kind: 'packed', path: '/candidate.tgz' })
          return packedSubject()
        },
      },
      pluginVerificationExecution: {
        verify: async input => {
          executionInputs.push(input)
          return completedExecution(input.target)
        },
      },
      digest: digest(),
      now: () => '2026-09-06T00:00:00.000Z',
    })

    const outcome = await kernel.verifyPlugin({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate.tgz' },
      executionPolicy: 'safe',
    })

    expect(targetAcquisitions).toBe(2)
    expect(contractAcquisitions).toBe(1)
    expect(pluginAcquisitions).toBe(1)
    expect(executionInputs).toHaveLength(1)
    expect(executionInputs[0]).toMatchObject({
      artifactPath: '/candidate.tgz',
      expectedContentHash: ARTIFACT_HASH,
      executionPolicy: 'safe',
      target: { fingerprint: INITIAL_TARGET_FINGERPRINT },
    })
    expect(outcome.snapshotFingerprint).toBe(INITIAL_TARGET_FINGERPRINT)
    expect(outcome.data).toMatchObject({
      status: 'verified',
      artifactFingerprint: ARTIFACT_FINGERPRINT,
      targetFingerprint: INITIAL_TARGET_FINGERPRINT,
      cleanup: 'succeeded',
    })
  })

  it('returns semantic stale when the exact target changes after execution', async () => {
    let targetAcquisitions = 0
    const kernel = createApplicationKernel({
      targetAcquisition: {
        acquire: async () => {
          targetAcquisitions += 1
          return targetAcquisitions === 1 ? targetFacts() : targetFacts('0.1.2-drift')
        },
      },
      contractAcquisition: { acquire: async () => contractFacts() },
      pluginSubjectAcquisition: { acquire: async () => packedSubject() },
      pluginVerificationExecution: {
        verify: async input => completedExecution(input.target),
      },
      digest: digest(),
      now: () => '2026-09-06T00:00:00.000Z',
    })

    const outcome = await kernel.verifyPlugin({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate.tgz' },
      executionPolicy: 'safe',
    })

    expect(targetAcquisitions).toBe(2)
    expect(outcome.snapshotFingerprint).toBe(INITIAL_TARGET_FINGERPRINT)
    expect(outcome.data.status).toBe('stale')
    expect(outcome.data.targetFingerprint).toBe(INITIAL_TARGET_FINGERPRINT)
    expect(outcome.data.diagnostics).toContainEqual(expect.objectContaining({
      code: 'VERIFY_TARGET_STALE',
    }))
    expect(DRIFTED_TARGET_FINGERPRINT).not.toBe(outcome.data.targetFingerprint)
  })

  it('fails before execution when the packed acquisition cannot prove one exact authoritative artifact', async () => {
    let workerCalls = 0
    const subject = packedSubject({
      completeness: 'partial',
      evidence: [{
        id: 'plugin:manifest',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: '5'.repeat(64),
      }],
      diagnostics: [{
        code: 'PLUGIN_PACKED_ARCHIVE_INVALID',
        severity: 'error',
        domain: 'plugin',
        summary: 'packed artifact is incomplete',
      }],
    })
    const kernel = createApplicationKernel({
      targetAcquisition: { acquire: async () => targetFacts() },
      contractAcquisition: { acquire: async () => contractFacts() },
      pluginSubjectAcquisition: { acquire: async () => subject },
      pluginVerificationExecution: {
        verify: async input => {
          workerCalls += 1
          return completedExecution(input.target)
        },
      },
      digest: digest(),
      now: () => '2026-09-06T00:00:00.000Z',
    })

    await expect(kernel.verifyPlugin({
      target: { profile: 'web' },
      subject: { kind: 'packed', path: '/candidate.tgz' },
      executionPolicy: 'safe',
    })).rejects.toMatchObject({ code: 'VERIFY_ARTIFACT_UNPROVEN' })
    expect(workerCalls).toBe(0)
  })
})
