import { describe, expect, it } from 'vitest'

import {
  checkPluginResponse,
  createApplicationKernel,
} from '../../src/kernel/index.js'
import type {
  AcquiredContractFacts,
} from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const targetFacts: AcquiredTargetFacts = {
  dsh: { name: '@deepseek-ai/dsh', version: '0.1.2-alpha.5' },
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

function validSubject(): AcquiredPluginSubject {
  return {
    completeness: 'complete',
    packageName: 'example-dsh-plugin',
    packageVersion: '1.0.0',
    bundlePatchHash: '4'.repeat(64),
    requirements: [{
      packageName: '@deepseek-ai/cordis',
      range: '4.0.1',
      relationship: 'host-peer-required',
    }],
    evidence: [{
      id: 'plugin:manifest',
      kind: 'manifest',
      strength: 'authoritative',
      contentHash: '5'.repeat(64),
    }],
    diagnostics: [],
  }
}

describe('plugin.check kernel', () => {
  it('uses one exact target/index acquisition, one plugin acquisition, and never invokes search ranking', async () => {
    let targetAcquisitions = 0
    let contractAcquisitions = 0
    let pluginAcquisitions = 0
    let searchIndexBuilds = 0

    const kernel = createApplicationKernel({
      targetAcquisition: {
        acquire: async () => {
          targetAcquisitions += 1
          return targetFacts
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
          expect(subject).toEqual({ kind: 'directory', path: '/candidate' })
          return validSubject()
        },
      },
      digest: {
        sha256Utf8: async value => value.includes('dsh-plugin-subject-v1')
          ? 'c'.repeat(64)
          : value.includes('dsh-contract-index-v1')
            ? 'b'.repeat(64)
            : 'a'.repeat(64),
      },
      now: () => '2026-09-02T00:00:00.000Z',
      createContractSearchIndex: source => {
        searchIndexBuilds += 1
        throw new Error(`plugin.check must not build a search index for ${source.fingerprint}`)
      },
    })

    const outcome = await kernel.checkPlugin({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/candidate' },
    })

    expect(targetAcquisitions).toBe(1)
    expect(contractAcquisitions).toBe(1)
    expect(pluginAcquisitions).toBe(1)
    expect(searchIndexBuilds).toBe(0)
    expect(outcome.snapshotFingerprint).toBe(`dsh-target-v2:${'a'.repeat(64)}`)
    expect(outcome.data).toMatchObject({
      contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      subjectFingerprint: `dsh-plugin-subject-v1:${'c'.repeat(64)}`,
      subjectCompleteness: 'complete',
      ruleset: 'plugin-static-alpha-v1',
      scopeComplete: false,
      verdict: 'compatible-in-scope',
      candidateCodeExecuted: false,
    })
    expect(outcome.diagnostics).toEqual([])
  })

  it('returns malformed plugin input as status ok with diagnostics and without inventing subject identity', async () => {
    const invalidSubject: AcquiredPluginSubject = {
      completeness: 'invalid',
      requirements: [],
      evidence: [],
      diagnostics: [{
        code: 'PLUGIN_MANIFEST_READ_FAILED',
        severity: 'error',
        domain: 'plugin',
        summary: 'package.json could not be acquired.',
      }],
    }
    const kernel = createApplicationKernel({
      targetAcquisition: { acquire: async () => targetFacts },
      contractAcquisition: { acquire: async () => contractFacts() },
      pluginSubjectAcquisition: { acquire: async () => invalidSubject },
      digest: {
        sha256Utf8: async value => value.includes('dsh-contract-index-v1')
          ? 'b'.repeat(64)
          : 'a'.repeat(64),
      },
      now: () => '2026-09-02T00:00:00.000Z',
    })

    const response = await checkPluginResponse(kernel, {
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/broken' },
    }, 'plugin-check-broken')

    expect(response).toMatchObject({
      status: 'ok',
      requestId: 'plugin-check-broken',
      snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      data: {
        subjectCompleteness: 'invalid',
        verdict: 'unproven',
        scopeComplete: false,
        candidateCodeExecuted: false,
      },
      diagnostics: [{ code: 'PLUGIN_MANIFEST_READ_FAILED', domain: 'plugin' }],
    })
    if (response.status !== 'ok') throw new Error('expected plugin.check success envelope')
    expect(response.data.subjectFingerprint).toBeUndefined()
  })
})
