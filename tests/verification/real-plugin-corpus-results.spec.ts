import { describe, expect, it } from 'vitest'

import {
  parseToolchainEnvelope,
  summarizeCorpusResults,
} from '../../scripts/real-plugin-corpus/results.mjs'

function staticEnvelope(verdict: 'compatible-in-scope' | 'incompatible' | 'unproven') {
  const diagnostic = verdict === 'compatible-in-scope'
    ? []
    : [{
        code: verdict === 'incompatible' ? 'PLUGIN_DSH_PACKAGE_MISSING' : 'PLUGIN_DSH_VERSION_UNPROVEN',
        severity: verdict === 'incompatible' ? 'error' : 'warning',
        domain: 'plugin',
        summary: 'compatibility reason',
      }]
  return JSON.stringify({
    protocolVersion: '1',
    status: 'ok',
    snapshotFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    data: {
      verdict,
      subjectFingerprint: `dsh-plugin-subject-v1:${'b'.repeat(64)}`,
      candidateCodeExecuted: false,
      subjectCompleteness: 'complete',
      requirements: [
        {
          packageName: '@deepseek-ai/dsh-settings',
          range: '^0.1.5-rc.1',
          relationship: 'host-peer',
          status: verdict === 'incompatible' ? 'missing' : verdict === 'unproven' ? 'unproven' : 'satisfied',
          targetVersion: verdict === 'incompatible' ? undefined : '0.1.5-rc.2',
          evidenceIds: ['plugin:manifest'],
        },
      ],
    },
    diagnostics: diagnostic,
  })
}

function verifyEnvelope(status: 'verified' | 'partial' | 'failed') {
  const failed = status === 'failed'
  const partial = status === 'partial'
  return JSON.stringify({
    protocolVersion: '1',
    status: 'ok',
    snapshotFingerprint: `dsh-target-v2:${'c'.repeat(64)}`,
    data: {
      status,
      cleanup: 'succeeded',
      artifactFingerprint: `dsh-plugin-artifact-v1:${'d'.repeat(64)}`,
      lifecycleFingerprint: `dsh-profile-lifecycle-v1:${'e'.repeat(64)}`,
      checks: [
        { id: 'structure', status: 'passed' },
        { id: 'manifest', status: 'passed' },
        { id: 'dependency', status: partial ? 'skipped' : 'passed' },
        { id: 'contract', status: partial ? 'skipped' : 'passed' },
        { id: 'build', status: 'skipped' },
        { id: 'package', status: 'passed' },
        { id: 'install', status: 'passed' },
        { id: 'compose', status: 'passed' },
        { id: 'boot', status: failed ? 'failed' : 'passed' },
        { id: 'visibility', status: 'skipped' },
        { id: 'behavior', status: 'skipped' },
      ],
      diagnostics: failed
        ? [{ code: 'VERIFY_BOOT_FAILED', severity: 'error' }]
        : partial
          ? [{ code: 'VERIFY_STATIC_UNPROVEN', severity: 'warning' }]
          : [],
    },
    diagnostics: [],
  })
}

describe('real plugin corpus evidence semantics', () => {
  it.each(['compatible-in-scope', 'incompatible', 'unproven'] as const)(
    'treats plugin.check verdict %s as valid evidence',
    verdict => {
      const parsed = parseToolchainEnvelope(staticEnvelope(verdict), 'plugin.check')

      expect(parsed.kind).toBe('plugin.check')
      expect(parsed.semanticOutcome).toBe(verdict)
      expect(parsed.harnessFailure).toBe(false)
      expect(parsed.targetFingerprint).toMatch(/^dsh-target-v2:[0-9a-f]{64}$/u)
      expect(parsed.requirements).toHaveLength(1)
      expect(parsed.requirements?.[0]?.packageName).toBe('@deepseek-ai/dsh-settings')
      expect(parsed.diagnostics).toEqual(verdict === 'compatible-in-scope'
        ? []
        : [expect.objectContaining({ domain: 'plugin', summary: 'compatibility reason' })])
    },
  )

  it.each(['verified', 'partial', 'failed'] as const)(
    'treats plugin.verify status %s as valid evidence when cleanup/evidence are present',
    status => {
      const parsed = parseToolchainEnvelope(verifyEnvelope(status), 'plugin.verify')

      expect(parsed.kind).toBe('plugin.verify')
      expect(parsed.semanticOutcome).toBe(status)
      expect(parsed.harnessFailure).toBe(false)
      expect(parsed.cleanup).toBe('succeeded')
    },
  )

  it('rejects malformed or non-Protocol child output as harness failure', () => {
    expect(() => parseToolchainEnvelope('not-json', 'plugin.check')).toThrow(/protocol json/i)
    expect(() => parseToolchainEnvelope(JSON.stringify({ status: 'ok' }), 'plugin.check')).toThrow(/protocolVersion/i)
  })

  it('summarizes semantic compatibility separately from harness failures', () => {
    const summary = summarizeCorpusResults([
      { pluginId: 'one', operation: 'plugin.check', semanticOutcome: 'compatible-in-scope', harnessFailure: false },
      { pluginId: 'two', operation: 'plugin.check', semanticOutcome: 'incompatible', harnessFailure: false },
      { pluginId: 'three', operation: 'plugin.check', semanticOutcome: 'unproven', harnessFailure: false },
      { pluginId: 'three', operation: 'plugin.verify', semanticOutcome: 'partial', harnessFailure: false },
      { pluginId: 'four', operation: 'plugin.verify', semanticOutcome: 'failed', harnessFailure: false },
      { pluginId: 'five', operation: 'runner', semanticOutcome: 'harness-failure', harnessFailure: true },
    ])

    expect(summary.totalRecords).toBe(6)
    expect(summary.harnessFailures).toBe(1)
    expect(summary.staticVerdicts).toEqual({
      'compatible-in-scope': 1,
      incompatible: 1,
      unproven: 1,
    })
    expect(summary.verificationStatuses).toEqual({ verified: 0, partial: 1, failed: 1 })
  })
})
