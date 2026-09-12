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

function requiredPeer(range: string) {
  return subject({
    requirements: [{
      packageName: '@deepseek-ai/cordis',
      range,
      relationship: 'host-peer-required',
    }],
  })
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
    expect(analysis.requirements).toContainEqual(expect.objectContaining({
      packageName: '@deepseek-ai/dsh-tools',
      status: 'not-required-from-host',
    }))
  })

  it('checks an optional Host peer with npm-compatible positive range proof', () => {
    const exact = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/dsh-tools',
        range: '0.1.2-alpha.5',
        relationship: 'host-peer-optional',
      }],
    }), contractIndex({ '@deepseek-ai/dsh-tools': '0.1.2-alpha.5' }))

    expect(verdict(exact)).toBe('compatible-in-scope')
    expect(exact.requirements).toContainEqual(expect.objectContaining({
      packageName: '@deepseek-ai/dsh-tools',
      status: 'satisfied',
      targetVersion: '0.1.2-alpha.5',
    }))

    const range = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/dsh-tools',
        range: '^0.1.2-alpha.5',
        relationship: 'host-peer-optional',
      }],
    }), contractIndex({ '@deepseek-ai/dsh-tools': '0.1.2-alpha.5' }))

    expect(verdict(range)).toBe('compatible-in-scope')
    expect(range.requirements).toContainEqual(expect.objectContaining({
      packageName: '@deepseek-ai/dsh-tools',
      status: 'satisfied',
      targetVersion: '0.1.2-alpha.5',
    }))
    expect(range.diagnostics).not.toContainEqual(expect.objectContaining({
      code: 'PLUGIN_DSH_VERSION_UNPROVEN',
    }))
  })

  it('proves stable caret, prerelease caret, and matching OR ranges using npm semver semantics', () => {
    const stableCaret = analyzePluginCompatibility(
      requiredPeer('^4.0.1'),
      contractIndex({ '@deepseek-ai/cordis': '4.0.2' }),
    )
    expect(verdict(stableCaret)).toBe('compatible-in-scope')
    expect(stableCaret.requirements[0]).toEqual(expect.objectContaining({
      status: 'satisfied',
      targetVersion: '4.0.2',
    }))

    const prereleaseCaret = analyzePluginCompatibility(
      requiredPeer('^0.1.5-rc.1'),
      contractIndex({ '@deepseek-ai/cordis': '0.1.5-rc.2' }),
    )
    expect(verdict(prereleaseCaret)).toBe('compatible-in-scope')
    expect(prereleaseCaret.requirements[0]).toEqual(expect.objectContaining({
      status: 'satisfied',
      targetVersion: '0.1.5-rc.2',
    }))

    const matchingOr = analyzePluginCompatibility(
      requiredPeer('^0.1.2-alpha.5 || ^0.1.5-rc.1'),
      contractIndex({ '@deepseek-ai/cordis': '0.1.5-rc.2' }),
    )
    expect(verdict(matchingOr)).toBe('compatible-in-scope')
    expect(matchingOr.requirements[0]).toEqual(expect.objectContaining({
      status: 'satisfied',
      targetVersion: '0.1.5-rc.2',
    }))
  })

  it('preserves exact string equality even when the version is not valid SemVer', () => {
    const analysis = analyzePluginCompatibility(
      requiredPeer('workspace-build'),
      contractIndex({ '@deepseek-ai/cordis': 'workspace-build' }),
    )

    expect(verdict(analysis)).toBe('compatible-in-scope')
    expect(analysis.requirements[0]).toEqual(expect.objectContaining({
      status: 'satisfied',
      targetVersion: 'workspace-build',
    }))
  })

  it('proves canonical stable, prerelease, and wildcard non-matches as version mismatch', () => {
    const cases = [
      { target: '4.0.2', range: '^5.0.0' },
      { target: '0.1.5-rc.2', range: '0.1.5-rc.1' },
      { target: '0.1.5-rc.2', range: '^0.1.2-alpha.5 || 0.1.5-rc.1' },
      { target: '0.1.5-rc.2', range: '*' },
    ]

    for (const testCase of cases) {
      const analysis = analyzePluginCompatibility(
        requiredPeer(testCase.range),
        contractIndex({ '@deepseek-ai/cordis': testCase.target }),
      )

      expect(verdict(analysis)).toBe('incompatible')
      expect(analysis.requirements[0]).toEqual(expect.objectContaining({
        status: 'version-mismatch',
        targetVersion: testCase.target,
      }))
      expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
        code: 'PLUGIN_DSH_VERSION_MISMATCH',
        severity: 'error',
        domain: 'plugin',
      }))
      expect(analysis.diagnostics).not.toContainEqual(expect.objectContaining({
        code: 'PLUGIN_DSH_VERSION_UNPROVEN',
      }))
    }
  })

  it('treats an installed optional Host peer with a canonical non-match as incompatible', () => {
    const analysis = analyzePluginCompatibility(subject({
      requirements: [{
        packageName: '@deepseek-ai/dsh-tools',
        range: '^0.2.0',
        relationship: 'host-peer-optional',
      }],
    }), contractIndex({ '@deepseek-ai/dsh-tools': '0.1.5-rc.2' }))

    expect(verdict(analysis)).toBe('incompatible')
    expect(analysis.requirements[0]).toEqual(expect.objectContaining({
      status: 'version-mismatch',
      targetVersion: '0.1.5-rc.2',
    }))
    expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
      code: 'PLUGIN_DSH_VERSION_MISMATCH',
      severity: 'error',
    }))
  })

  it('keeps malformed target versions and ranges unproven without throwing', () => {
    const cases = [
      { target: 'not-semver', range: '^4.0.1' },
      { target: '4.0.2', range: 'definitely not a range' },
    ]

    for (const testCase of cases) {
      expect(() => analyzePluginCompatibility(
        requiredPeer(testCase.range),
        contractIndex({ '@deepseek-ai/cordis': testCase.target }),
      )).not.toThrow()

      const analysis = analyzePluginCompatibility(
        requiredPeer(testCase.range),
        contractIndex({ '@deepseek-ai/cordis': testCase.target }),
      )
      expect(verdict(analysis)).toBe('unproven')
      expect(analysis.requirements[0]).toEqual(expect.objectContaining({
        status: 'unproven',
        targetVersion: testCase.target,
      }))
      expect(analysis.diagnostics).toContainEqual(expect.objectContaining({
        code: 'PLUGIN_DSH_VERSION_UNPROVEN',
        severity: 'warning',
      }))
      expect(analysis.diagnostics).not.toContainEqual(expect.objectContaining({
        code: 'PLUGIN_DSH_VERSION_MISMATCH',
      }))
    }
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
