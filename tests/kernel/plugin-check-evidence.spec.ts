import { describe, expect, it } from 'vitest'

import { createApplicationKernel } from '../../src/kernel/index.js'
import type { AcquiredContractFacts } from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'
import type { AcquiredTargetFacts } from '../../src/model/target.js'

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

const contractFacts: AcquiredContractFacts = {
  evidence: [{
    id: 'manifest:cordis',
    kind: 'manifest',
    strength: 'authoritative',
    contentHash: '3'.repeat(64),
  }],
  contracts: [{
    id: 'package:@deepseek-ai/cordis',
    kind: 'package',
    name: '@deepseek-ai/cordis',
    qualifiedName: 'package:@deepseek-ai/cordis',
    availability: 'unknown',
    facts: [{ key: 'version', value: '4.0.1', evidenceIds: ['manifest:cordis'] }],
    evidenceIds: ['manifest:cordis'],
  }],
}

const subject: AcquiredPluginSubject = {
  completeness: 'complete',
  packageName: 'example-plugin',
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

describe('plugin.check evidence binding', () => {
  it('binds each proven Host requirement to plugin declaration and target version evidence', async () => {
    const kernel = createApplicationKernel({
      targetAcquisition: { acquire: async () => targetFacts },
      contractAcquisition: { acquire: async () => contractFacts },
      pluginSubjectAcquisition: { acquire: async () => subject },
      digest: {
        sha256Utf8: async value => value.includes('dsh-plugin-subject-v1')
          ? 'c'.repeat(64)
          : value.includes('dsh-contract-index-v1')
            ? 'b'.repeat(64)
            : 'a'.repeat(64),
      },
      now: () => '2026-09-02T00:00:00.000Z',
    })

    const outcome = await kernel.checkPlugin({
      target: { profile: 'web' },
      subject: { kind: 'directory', path: '/candidate' },
    })

    expect(outcome.data.requirements).toEqual([expect.objectContaining({
      packageName: '@deepseek-ai/cordis',
      status: 'satisfied',
      targetVersion: '4.0.1',
      evidenceIds: ['plugin:manifest', 'manifest:cordis'],
    })])
    expect(outcome.data.evidence.map(item => item.id)).toEqual([
      'plugin:manifest',
      'manifest:cordis',
    ])
  })
})
