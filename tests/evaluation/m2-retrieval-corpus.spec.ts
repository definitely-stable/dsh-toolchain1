import { describe, expect, it } from 'vitest'

import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  M2_RETRIEVAL_CATEGORIES,
  validateM2RetrievalCorpus,
  type M2RetrievalCategory,
} from './m2-retrieval-metrics.js'

const EXPECTED_CATEGORY_COUNTS: Readonly<Record<M2RetrievalCategory, number>> = Object.freeze({
  'exact-symbol': 8,
  'package-api': 6,
  'natural-language': 7,
  indirect: 6,
  ambiguous: 5,
  'no-result': 4,
})

function routeExport(segment: string): string {
  const prefix = 'declaration-export:'
  expect(segment.startsWith(prefix)).toBe(true)
  return segment.slice(prefix.length)
}

function routeAbsenceNeedle(segment: string): string {
  const prefix = 'absent:'
  expect(segment.startsWith(prefix)).toBe(true)
  const value = segment.slice(prefix.length).trim()
  expect(value.length).toBeGreaterThan(0)
  return value
}

describe('M2.3 frozen R1 retrieval corpus', () => {
  it('freezes exactly 36 tasks with the preregistered category distribution', () => {
    expect(M2_RETRIEVAL_R1).toHaveLength(36)

    for (const category of M2_RETRIEVAL_CATEGORIES) {
      expect(M2_RETRIEVAL_R1.filter(task => task.category === category)).toHaveLength(
        EXPECTED_CATEGORY_COUNTS[category],
      )
    }
  })

  it('passes the corpus validator against the exact frozen rc.2 contract universe', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const knownContractIds = new Set(index.contracts.map(contract => contract.id))

    expect(() => validateM2RetrievalCorpus(M2_RETRIEVAL_R1, knownContractIds)).not.toThrow()
  })

  it('keeps domain coverage broad and intent groups bounded independently of retrieval category', () => {
    const domains = new Set(M2_RETRIEVAL_R1.map(task => task.domain))
    const intentGroupCounts = new Map<string, number>()

    for (const task of M2_RETRIEVAL_R1) {
      intentGroupCounts.set(task.intentGroup, (intentGroupCounts.get(task.intentGroup) ?? 0) + 1)
    }

    expect(domains.size).toBeGreaterThanOrEqual(8)
    expect(Math.max(...intentGroupCounts.values())).toBeLessThanOrEqual(3)
  })

  it('grounds every answerable task in a captured declaration export and authoritative evidence', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const contracts = new Map(index.contracts.map(contract => [contract.id, contract]))
    const evidence = new Map(index.evidence.map(item => [item.id, item]))

    for (const task of M2_RETRIEVAL_R1.filter(task => task.expectNoResult !== true)) {
      expect(task.sourceKind).toBe('declaration')
      expect(task.referenceRoute).toHaveLength(3)

      const [contractId, exportSegment, evidenceId] = task.referenceRoute
      expect(task.expectedContractIds).toContain(contractId)
      const contract = contracts.get(contractId!)
      expect(contract, `missing route contract for ${task.id}`).toBeDefined()

      const exportName = routeExport(exportSegment!)
      const fact = contract!.facts.find(
        item => item.key === 'declaration-export' && item.value === exportName,
      )
      expect(fact, `missing route export ${exportName} for ${task.id}`).toBeDefined()
      expect(fact!.evidenceIds).toContain(evidenceId)

      const item = evidence.get(evidenceId!)
      expect(item, `missing route evidence ${evidenceId} for ${task.id}`).toBeDefined()
      expect(item!.kind).toBe('type-declaration')
      expect(item!.strength).toBe('authoritative')
      expect(item!.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('grounds every no-result task in the complete frozen universe and an actually absent oracle needle', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const searchableFacts = index.contracts.flatMap(contract => [
      contract.id,
      contract.name,
      contract.qualifiedName,
      contract.summary ?? '',
      ...contract.facts.map(fact => fact.value),
    ]).map(value => value.toLocaleLowerCase('en-US'))

    for (const task of M2_RETRIEVAL_R1.filter(task => task.expectNoResult === true)) {
      expect(task.sourceKind).toBe('negative-oracle')
      expect(task.referenceRoute).toHaveLength(2)
      expect(task.referenceRoute[0]).toBe('fixture:rc2-web-v1:complete-contract-universe')

      const needle = routeAbsenceNeedle(task.referenceRoute[1]!).toLocaleLowerCase('en-US')
      expect(
        searchableFacts.some(value => value.includes(needle)),
        `negative oracle needle ${needle} unexpectedly exists for ${task.id}`,
      ).toBe(false)
    }
  })

  it('contains explicit confusion controls and a version-drift negative canary', () => {
    expect(M2_RETRIEVAL_R1.some(task => (task.forbiddenContractIds?.length ?? 0) > 0)).toBe(true)
    expect(M2_RETRIEVAL_R1.some(task => task.riskTags?.includes('version-drift'))).toBe(true)
    expect(M2_RETRIEVAL_R1.some(task => task.referenceRoute.includes('absent:patchReload'))).toBe(true)
  })
})
