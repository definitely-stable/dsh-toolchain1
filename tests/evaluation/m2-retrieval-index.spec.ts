import { describe, expect, it } from 'vitest'

import {
  createFrozenM2RetrievalIndex,
  M2_RETRIEVAL_FIXTURE_MANIFEST,
  M2_RETRIEVAL_TARGET,
} from './m2-retrieval-index.js'

const requiredPackages = Object.freeze([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-compaction',
])

function exportsOf(
  contract: Awaited<ReturnType<typeof createFrozenM2RetrievalIndex>>['contracts'][number],
): string[] {
  return contract.facts
    .filter(fact => fact.key === 'declaration-export')
    .map(fact => fact.value)
}

describe('M2.3 frozen rc.2 retrieval index', () => {
  it('binds the fixture to the registry-artifact Web target and real content-addressed identities', async () => {
    const index = await createFrozenM2RetrievalIndex()

    expect(M2_RETRIEVAL_FIXTURE_MANIFEST).toMatchObject({
      schema: 'dsh-toolchain-m2-fixture-v1',
      fixtureVersion: 'rc2-web-v1',
      canonicalTarget: {
        package: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
        profile: 'web',
        upstreamDocumentationCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      },
      generator: {
        generationPolicy: 'registry-artifact-production-acquisition-v1',
        sanitizationPolicy: 'drop-evidence-location-v1',
      },
      source: {
        lockfileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      expected: {
        targetFingerprint: expect.stringMatching(/^dsh-target-v2:[0-9a-f]{64}$/),
        contractIndexFingerprint: expect.stringMatching(/^dsh-contract-index-v1:[0-9a-f]{64}$/),
      },
    })
    expect(M2_RETRIEVAL_TARGET).toEqual({
      dshVersion: '0.1.1-rc.2',
      profile: 'web',
      upstreamCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      targetFingerprint: M2_RETRIEVAL_FIXTURE_MANIFEST.expected.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractIndexFingerprint,
      targetProof: 'registry artifact fixture rc2-web-v1',
    })
    expect(index.targetFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(index.fingerprint).toBe(M2_RETRIEVAL_TARGET.contractIndexFingerprint)
  })

  it('contains the full captured production package universe and never invents type-level contract ids', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const ids = new Set(index.contracts.map(contract => contract.id))

    expect(index.contracts.length).toBe(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractCount)
    expect(index.evidence.length).toBe(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.evidenceCount)
    expect(index.contracts.length).toBe(M2_RETRIEVAL_FIXTURE_MANIFEST.packages.length)
    for (const packageIdentity of M2_RETRIEVAL_FIXTURE_MANIFEST.packages) {
      expect(ids.has(`package:${packageIdentity.name}`), `missing ${packageIdentity.name}`).toBe(true)
    }
    for (const packageName of requiredPackages) {
      expect(ids.has(`package:${packageName}`), `missing ${packageName}`).toBe(true)
    }
    expect(index.contracts.some(contract => contract.id.startsWith('type:'))).toBe(false)
  })

  it('mirrors production M2.1 package shape and selected artifact-proven public exports', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const byId = new Map(index.contracts.map(contract => [contract.id, contract]))

    for (const packageIdentity of M2_RETRIEVAL_FIXTURE_MANIFEST.packages) {
      const contract = byId.get(`package:${packageIdentity.name}`)
      expect(contract, `missing ${packageIdentity.name}`).toBeDefined()
      expect(contract).toMatchObject({
        kind: 'package',
        name: packageIdentity.name,
        qualifiedName: `package:${packageIdentity.name}`,
        availability: 'unknown',
        summary: `Installed package ${packageIdentity.name}@${packageIdentity.version}`,
      })
      expect(contract!.facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'version', value: packageIdentity.version }),
      ]))
    }

    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-tools')!)).toEqual(expect.arrayContaining([
      'ToolDefinition',
      'ToolExecution',
      'PreToolDecision',
    ]))
    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-agent')!)).toEqual(expect.arrayContaining([
      'AgentRegistry',
      'AgentHandle',
      'CreateAgentOptions',
    ]))
    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-session')!)).toEqual(expect.arrayContaining([
      'SessionPreparation',
      'SessionEvent',
      'snapshotSessionEvent',
    ]))
  })

  it('uses content-hashed artifact provenance and resolves every contract/fact evidence reference', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const evidenceIds = new Set(index.evidence.map(item => item.id))

    expect(index.evidence.length).toBeGreaterThanOrEqual(index.contracts.length)
    for (const item of index.evidence) {
      expect(item.location).toBeUndefined()
      expect(item.source.trim().length).toBeGreaterThan(0)
      expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
    for (const contract of index.contracts) {
      for (const evidenceId of contract.evidenceIds) expect(evidenceIds.has(evidenceId)).toBe(true)
      for (const fact of contract.facts) {
        expect(fact.evidenceIds.length).toBeGreaterThan(0)
        for (const evidenceId of fact.evidenceIds) expect(evidenceIds.has(evidenceId)).toBe(true)
      }
    }
  })

  it('rebuilds the exact captured content-addressed index deterministically', async () => {
    const first = await createFrozenM2RetrievalIndex()
    const second = await createFrozenM2RetrievalIndex()

    expect(second).toEqual(first)
    expect(second.fingerprint).toBe(M2_RETRIEVAL_FIXTURE_MANIFEST.expected.contractIndexFingerprint)
  })
})
