import { describe, expect, it } from 'vitest'

import { searchContractIndex } from '../../src/model/contract.js'
import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'

function routeExport(segment: string): string {
  const prefix = 'declaration-export:'
  if (!segment.startsWith(prefix)) throw new Error(`Invalid declaration route segment ${segment}`)
  return segment.slice(prefix.length)
}

describe('M2.3 R1 evidence sufficiency', () => {
  it('proves every answerable oracle route is acquisition-complete even when retrieval misses it', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const contracts = new Map(index.contracts.map(contract => [contract.id, contract]))
    const evidence = new Map(index.evidence.map(item => [item.id, item]))

    for (const task of M2_RETRIEVAL_R1.filter(task => task.expectNoResult !== true)) {
      const [contractId, exportSegment, evidenceId] = task.referenceRoute
      const contract = contracts.get(contractId!)
      expect(contract, `missing expected contract for ${task.id}`).toBeDefined()

      const exportName = routeExport(exportSegment!)
      const fact = contract!.facts.find(
        item => item.key === 'declaration-export' && item.value === exportName,
      )
      expect(fact, `missing expected export ${exportName} for ${task.id}`).toBeDefined()
      expect(fact!.evidenceIds).toContain(evidenceId)

      const item = evidence.get(evidenceId!)
      expect(item, `missing expected evidence ${evidenceId} for ${task.id}`).toBeDefined()
      expect(item!.kind).toBe('type-declaration')
      expect(item!.strength).toBe('authoritative')
      expect(item!.contentHash).toMatch(/^[0-9a-f]{64}$/)

      const retrieval = searchContractIndex(index, task.query, undefined, 5)
      const hit = retrieval.matches.some(match => task.expectedContractIds.includes(match.id))
      if (!hit) {
        expect(contract!.evidenceIds).toContain(evidenceId)
      }
    }
  })

  it('keeps every evidence id returned by production search resolvable in the frozen index', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const evidenceIds = new Set(index.evidence.map(item => item.id))

    for (const task of M2_RETRIEVAL_R1) {
      const selection = searchContractIndex(index, task.query, undefined, 5)
      for (const match of selection.matches) {
        expect(match.evidenceIds.length, `missing search witness for ${task.id}/${match.id}`).toBeGreaterThan(0)
        for (const evidenceId of match.evidenceIds) {
          expect(evidenceIds.has(evidenceId), `unresolved search evidence ${evidenceId}`).toBe(true)
        }
      }
      for (const item of selection.evidence) {
        expect(evidenceIds.has(item.id)).toBe(true)
      }
    }
  })
})
