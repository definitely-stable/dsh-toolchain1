import { describe, expect, it } from 'vitest'

import {
  analyzePluginCompatibility,
  type PluginCompatibilityAnalysis,
} from '../../src/model/plugin-check.js'
import type { ContractIndex } from '../../src/model/contract.js'
import type { AcquiredPluginSubject } from '../../src/model/plugin.js'

function contractIndex(packages: Readonly<Record<string, string>> = {}): ContractIndex {
  return {
    targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    fingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
    evidence: [],
    contracts: Object.entries(packages).map(([name, version]) => ({
      id: `package:${name}`,
      kind: 'package',
      name,
      qualifiedName: `package:${name}`,
      availability: 'unknown',
      summary: `Installed package ${name}@${version}`,
      facts: [{ key: 'version', value: version, evidenceIds: ['manifest:test'] }],
      evidenceIds: ['manifest:test'],
    })),
  }
}

function subject(overrides: Partial<AcquiredPluginSubject> = {}): AcquiredPluginSubject {
  return {
    completeness: 'complete',
    packageName: 'example-plugin',
    packageVersion: '1.0.0',
    requirements: [],
    evidence: [],
    diagnostics: [],
    ...overrides,
  }
}

function verdict(analysis: PluginCompatibilityAnalysis): PluginCompatibilityAnalysis['verdict'] {
  return analysis.verdict
}

describe('Exact Target Plugin Check static compatibility reducer', () => {
  it('proves incompatibility when a required Host peer is absent from the exact ContractIndex', () => {
    const analysis = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '4.0.1',
        relationship: 'host-peer-required',
      }],
    }), contractIndex())

    expect(verdict(analysis)).toBe('incompatible')
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_DSH_PACKAGE_MISSING',
      severity: 'error',
      domain: 'plugin',
    }))
  })

  it('does not require artifact dependencies or absent optional peers to exist in the Host target', () => {
    const analysis = analyzePluginCompatibility(subject({
      requirements: [
        {
          packageName: '@deepseek-ai/dsh-agent',
          range: '^0.1.1',
          relationship: 'artifact-dependency',
        },
        {
          packageName: '@deepseek-ai/dsh-tools',
          range: '^0.1.1',
          relationship: 'host-peer-optional',
        },
      ],
    }), contractIndex())

    expect(verdict(analysis)).toBe('compatible-in-scope')
    expect(analysis.diagnostics).toEqual([])
  })

  it('proves an exact required Host version but refuses to guess unsupported semver ranges', () => {
    const exact = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '4.0.1',
        relationship: 'host-peer-required',
      }],
    }), contractIndex({ '@deepseek-ai/cordis': '4.0.1' }))
    expect(verdict(exact)).toBe('compatible-in-scope')

    const range = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/cordis',
        range: '^4.0.1',
        relationship: 'host-peer-required',
      }],
    }), contractIndex({ '@deepseek-ai/cordis': '4.0.1' }))
    expect(verdict(range)).toBe('unproven')
    expect(range.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_DSH_VERSION_UNPROVEN',
      severity: 'warning',
    }))
  })

  it('keeps expected subject acquisition diagnostics in a successful unproven analysis', () => {
    const acquisitionDiagnostic = {
      code: 'PLUGIN_BUNDLE_PATCH_MISSING',
      severity: 'error' as const,
      domain: 'plugin',
      summary: 'missing patch',
    }
    const analysis = analyzePluginCompatibility(subject({
      completeness: 'partial',
      diagnostics: [acquisitionDiagnostic],
    }), contractIndex())

    expect(verdict(analysis)).toBe('unproven')
    expect(analysis.diagnostics).toContainEqual(acquisitionDiagnostic)
  })
})
