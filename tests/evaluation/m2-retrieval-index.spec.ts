import { describe, expect, it } from 'vitest'

import { createFrozenM2RetrievalIndex, M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

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
  it('binds the representative fixture to the exact published rc.2 headless target proven by Toolchain CI', async () => {
    const index = await createFrozenM2RetrievalIndex()

    expect(M2_RETRIEVAL_TARGET).toEqual({
      dshVersion: '0.1.1-rc.2',
      profile: 'headless',
      upstreamCommit: 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
      targetFingerprint: 'dsh-target-v2:84ee12bc591ba87cdb4392280ab8f3c8a211301bcc9c460334ede6e8015ee6be',
      targetProof: 'Toolchain CI #398 / primary target smoke',
    })
    expect(index.targetFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(index.fingerprint).toMatch(/^dsh-contract-index-v1:[0-9a-f]{64}$/)
  })

  it('contains the required real rc.2 package contracts and never invents type-level contract ids', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const ids = new Set(index.contracts.map(contract => contract.id))

    for (const packageName of requiredPackages) {
      expect(ids.has(`package:${packageName}`), `missing ${packageName}`).toBe(true)
    }
    expect(index.contracts.some(contract => contract.id.startsWith('type:'))).toBe(false)
  })

  it('mirrors the production M2.1 package shape and selected verified public exports', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const byId = new Map(index.contracts.map(contract => [contract.id, contract]))

    for (const packageName of requiredPackages) {
      const contract = byId.get(`package:${packageName}`)
      expect(contract, `missing ${packageName}`).toBeDefined()
      expect(contract).toMatchObject({
        kind: 'package',
        name: packageName,
        qualifiedName: `package:${packageName}`,
        availability: 'unknown',
        summary: `Installed package ${packageName}@0.1.1-rc.2`,
      })
      expect(contract!.facts).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'version', value: '0.1.1-rc.2' }),
        expect.objectContaining({ key: 'declaration-entry' }),
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
    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-system-prompt')!)).toEqual(expect.arrayContaining([
      'SystemPrompt',
      'PromptSection',
      'PromptAssembly',
    ]))
    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-scope')!)).toEqual(expect.arrayContaining([
      'ScopedLayers',
      'createScope',
      'scopeTarget',
    ]))
    expect(exportsOf(byId.get('package:@deepseek-ai/dsh-subagent')!)).toEqual(expect.arrayContaining([
      'SubagentRuntime',
      'SubagentProvider',
      'SubagentRunId',
    ]))
  })

  it('uses pinned provenance and resolves every contract/fact evidence reference', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const evidenceIds = new Set(index.evidence.map(item => item.id))

    expect(index.evidence.length).toBeGreaterThanOrEqual(requiredPackages.length * 2)
    for (const item of index.evidence) {
      expect(item.source).toContain(M2_RETRIEVAL_TARGET.upstreamCommit)
      expect(item.location).toBeUndefined()
    }
    for (const contract of index.contracts) {
      for (const evidenceId of contract.evidenceIds) expect(evidenceIds.has(evidenceId)).toBe(true)
      for (const fact of contract.facts) {
        expect(fact.evidenceIds.length).toBeGreaterThan(0)
        for (const evidenceId of fact.evidenceIds) expect(evidenceIds.has(evidenceId)).toBe(true)
      }
    }
  })

  it('rebuilds the same content-addressed index deterministically', async () => {
    const first = await createFrozenM2RetrievalIndex()
    const second = await createFrozenM2RetrievalIndex()

    expect(second).toEqual(first)
    expect(second.fingerprint).toBe(first.fingerprint)
  })
})
