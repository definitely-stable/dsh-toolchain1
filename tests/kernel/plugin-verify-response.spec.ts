import { describe, expect, it, vi } from 'vitest'

import {
  createApplicationKernel,
  verifyPluginResponse,
  type VerificationApplicationKernel,
} from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'
import { TargetAcquisitionError, type AcquiredTargetFacts } from '../../src/model/target.js'
import type {
  PluginVerifyRequest,
  VerificationReport,
} from '../../src/protocol/index.js'

const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
const artifactFingerprint = `dsh-plugin-artifact-v1:${'9'.repeat(64)}`

const request: PluginVerifyRequest = {
  target: { profile: 'web' },
  subject: { kind: 'packed', path: '/candidate.tgz' },
  executionPolicy: 'safe',
}

function report(status: VerificationReport['status']): VerificationReport {
  return {
    status,
    artifactFingerprint,
    targetFingerprint,
    executionPolicy: 'safe',
    checks: [],
    diagnostics: status === 'stale'
      ? [{
          code: 'VERIFY_TARGET_STALE',
          severity: 'error',
          domain: 'verification',
          summary: 'target changed',
        }]
      : [],
    cleanup: 'succeeded',
  }
}

function semanticKernel(status: VerificationReport['status']): VerificationApplicationKernel {
  return {
    describe: () => ({ product: 'dsh-toolchain', version: '0.0.0', protocolVersion: '1' }),
    resolveTarget: vi.fn(async () => { throw new Error('unused') }),
    searchContracts: vi.fn(async () => { throw new Error('unused') }),
    inspectContract: vi.fn(async () => { throw new Error('unused') }),
    checkPlugin: vi.fn(async () => { throw new Error('unused') }),
    verifyPlugin: vi.fn(async () => ({ snapshotFingerprint: targetFingerprint, data: report(status) })),
  }
}

function targetFacts(): AcquiredTargetFacts {
  return {
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [],
      dependencies: [],
      profilePatchHash: '1'.repeat(64),
      homePatchHash: '2'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [],
  }
}

const emptyContracts: AcquiredContractFacts = { evidence: [], contracts: [] }

function partialPackedSubject(): AcquiredPluginSubject {
  return {
    completeness: 'partial',
    packageName: 'broken-plugin',
    packageVersion: '1.0.0',
    requirements: [],
    evidence: [],
    diagnostics: [{
      code: 'PLUGIN_PACKED_ARCHIVE_INVALID',
      severity: 'error',
      domain: 'plugin',
      summary: 'packed artifact could not be proven',
    }],
  }
}

describe('plugin.verify Protocol response projection', () => {
  it.each(['verified', 'failed', 'partial', 'stale', 'cancelled'] as const)(
    'keeps semantic report status %s inside a successful outer envelope',
    async status => {
      const response = await verifyPluginResponse(semanticKernel(status), request, `verify-${status}`)

      expect(response).toMatchObject({
        protocolVersion: '1',
        requestId: `verify-${status}`,
        snapshotFingerprint: targetFingerprint,
        status: 'ok',
        data: {
          status,
          artifactFingerprint,
          targetFingerprint,
        },
        diagnostics: [],
      })
    },
  )

  it('maps target acquisition failure to the only outer failed envelope', async () => {
    const kernel = createApplicationKernel({
      targetAcquisition: {
        acquire: async () => {
          throw new TargetAcquisitionError(
            'TARGET_PROFILE_NOT_FOUND',
            'DSH profile was not found',
            ['/tmp/missing/profile'],
          )
        },
      },
      contractAcquisition: { acquire: async () => emptyContracts },
      pluginSubjectAcquisition: { acquire: async () => partialPackedSubject() },
      pluginVerificationExecution: {
        verify: async () => { throw new Error('worker must not start') },
      },
      digest: { sha256Utf8: async () => 'a'.repeat(64) },
    })

    const response = await verifyPluginResponse(kernel, request, 'verify-target-failed')
    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'verify-target-failed',
      status: 'failed',
      diagnostics: [{ code: 'TARGET_PROFILE_NOT_FOUND', domain: 'target' }],
    })
    expect(response).not.toHaveProperty('data')
  })

  it('fails closed before worker execution when exact packed artifact identity cannot be bound', async () => {
    let workerCalls = 0
    const kernel = createApplicationKernel({
      targetAcquisition: { acquire: async () => targetFacts() },
      contractAcquisition: { acquire: async () => emptyContracts },
      pluginSubjectAcquisition: { acquire: async () => partialPackedSubject() },
      pluginVerificationExecution: {
        verify: async () => {
          workerCalls += 1
          throw new Error('worker must not start')
        },
      },
      digest: {
        sha256Utf8: async value => value.includes('dsh-contract-index-v1')
          ? 'b'.repeat(64)
          : 'a'.repeat(64),
      },
    })

    const response = await verifyPluginResponse(kernel, request, 'verify-artifact-unproven')
    expect(workerCalls).toBe(0)
    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'verify-artifact-unproven',
      status: 'failed',
      diagnostics: [{ code: 'VERIFY_ARTIFACT_UNPROVEN', domain: 'verification' }],
    })
  })
})
