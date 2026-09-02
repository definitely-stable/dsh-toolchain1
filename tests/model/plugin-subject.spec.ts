import { describe, expect, it } from 'vitest'

import {
  createPluginSubjectSemanticProjection,
  fingerprintPluginSubject,
  type AcquiredPluginSubject,
} from '../../src/model/plugin.js'
import type { Sha256Port } from '../../src/model/digest.js'

const digest: Sha256Port = {
  async sha256Utf8(value) {
    const normalized = Buffer.from(value, 'utf8').toString('hex').slice(0, 64).padEnd(64, '0')
    return normalized
  },
}

function subject(overrides: Partial<AcquiredPluginSubject> = {}): AcquiredPluginSubject {
  return {
    completeness: 'complete',
    packageName: 'example-plugin',
    packageVersion: '1.0.0',
    bundlePatchHash: 'a'.repeat(64),
    requirements: [
      {
        packageName: '@deepseek-ai/cordis',
        range: '^4.0.1',
        relationship: 'host-peer-required',
      },
      {
        packageName: '@deepseek-ai/dsh-tools',
        range: '^0.1.1',
        relationship: 'artifact-dependency',
      },
    ],
    evidence: [
      {
        id: 'plugin:manifest',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: 'b'.repeat(64),
        location: '/machine/a/package.json',
      },
    ],
    diagnostics: [],
    ...overrides,
  }
}

describe('dsh-plugin-subject-v1 semantic identity', () => {
  it('excludes evidence coordinates and diagnostics while sorting semantic requirements', async () => {
    const first = subject()
    const second = subject({
      requirements: [...subject().requirements].reverse(),
      evidence: [{
        id: 'plugin:manifest-copy',
        kind: 'manifest',
        strength: 'authoritative',
        contentHash: 'c'.repeat(64),
        location: 'C:\\copy\\package.json',
      }],
      diagnostics: [{
        code: 'PLUGIN_NOTE',
        severity: 'info',
        domain: 'plugin',
        summary: 'non-semantic diagnostic wording',
      }],
    })

    const firstProjection = createPluginSubjectSemanticProjection(first)
    const secondProjection = createPluginSubjectSemanticProjection(second)
    expect(secondProjection).toEqual(firstProjection)
    expect(firstProjection?.requirements.map(item => item.relationship)).toEqual([
      'artifact-dependency',
      'host-peer-required',
    ])
    expect(await fingerprintPluginSubject(firstProjection!, digest))
      .toBe(await fingerprintPluginSubject(secondProjection!, digest))
  })

  it('changes semantic identity when a compatibility-relevant requirement changes', async () => {
    const first = createPluginSubjectSemanticProjection(subject())
    const changed = createPluginSubjectSemanticProjection(subject({
      requirements: subject().requirements.map(requirement =>
        requirement.relationship === 'host-peer-required'
          ? { ...requirement, range: '^5.0.0' }
          : requirement),
    }))

    expect(await fingerprintPluginSubject(changed!, digest))
      .not.toBe(await fingerprintPluginSubject(first!, digest))
  })

  it('does not invent a semantic fingerprint for an invalid subject without package identity', () => {
    expect(createPluginSubjectSemanticProjection(subject({
      completeness: 'invalid',
      packageName: undefined,
      packageVersion: undefined,
    }))).toBeUndefined()
  })
})
