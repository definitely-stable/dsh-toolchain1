import { describe, expect, it } from 'vitest'

import {
  createContractSearchIndex,
  intentQueryTokens,
  searchTokens,
} from '../../src/model/contract-search-index.js'
import { explainContractSearch, searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import { R2_RETRIEVAL_DEV } from './m2-retrieval-r2.js'

interface RelationProfile {
  readonly taskId: string
  readonly topContractId: string | null
  readonly knownTokenCount: number
  readonly matchedTokenCount: number
  readonly semanticTermCount: number
  readonly maxSameFactMatchedTokens: number
}

function taskById(taskId: string) {
  const task = R2_RETRIEVAL_DEV.find(candidate => candidate.id === taskId)
  if (task === undefined) throw new Error(`Missing frozen R2 task ${taskId}`)
  return task
}

describe('Contract Search v3 relation/proximity evidence gate', () => {
  it('shows that coarse same-fact support does not cleanly separate the remaining false positive', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const derived = createContractSearchIndex(index)

    const profile = (taskId: string): RelationProfile => {
      const task = taskById(taskId)
      const queryTokens = intentQueryTokens(task.query)
      const knownTokens = queryTokens.filter(token => (derived.documentFrequency.get(token) ?? 0) > 0)
      const selection = searchContractIndex(index, task.query, undefined, 5, derived)
      const explanation = explainContractSearch(index, task.query, undefined, 5, derived)
      const top = selection.matches[0]
      const terms = explanation.results[0]?.terms ?? []
      const document = top === undefined ? undefined : derived.documents.get(top.id)
      const maxSameFactMatchedTokens = document === undefined
        ? 0
        : Math.max(0, ...document.facts.map(fact =>
          queryTokens.filter(token => fact.uniqueTokens.has(token)).length,
        ))

      return Object.freeze({
        taskId,
        topContractId: top?.id ?? null,
        knownTokenCount: knownTokens.length,
        matchedTokenCount: terms.length,
        semanticTermCount: terms.filter(term => term.field === 'fact' || term.field === 'summary').length,
        maxSameFactMatchedTokens,
      })
    }

    const futureMemory = profile('r2-hard-negative-future-memory')
    const childFinalMessage = profile('r2-indirect-child-final-message')
    const toolsSchema = profile('r2-long-tools-schema-validation')
    const scopeAncestry = profile('r2-indirect-scope-ancestry')

    console.log(`M2_RETRIEVAL_R2_RELATION_GATE ${JSON.stringify({
      futureMemory,
      childFinalMessage,
      toolsSchema,
      scopeAncestry,
    })}`)

    expect(futureMemory).toEqual({
      taskId: 'r2-hard-negative-future-memory',
      topContractId: 'package:@deepseek-ai/dsh-api-remotes',
      knownTokenCount: 5,
      matchedTokenCount: 4,
      semanticTermCount: 4,
      maxSameFactMatchedTokens: 2,
    })
    expect(childFinalMessage.maxSameFactMatchedTokens).toBe(2)
    expect(childFinalMessage.semanticTermCount).toBeGreaterThanOrEqual(4)
    expect(toolsSchema.maxSameFactMatchedTokens).toBe(2)
    expect(toolsSchema.semanticTermCount).toBe(4)
    expect(scopeAncestry.knownTokenCount).toBe(2)
    expect(scopeAncestry.topContractId).toBeNull()

    // A threshold on coarse fact-local support cannot reject future-memory without
    // also colliding with currently correct or separately wrong answerable cases.
    expect(new Set([
      futureMemory.maxSameFactMatchedTokens,
      childFinalMessage.maxSameFactMatchedTokens,
      toolsSchema.maxSameFactMatchedTokens,
    ])).toEqual(new Set([2]))
  })

  it('records that the current derived representation is order-insensitive, not positional', () => {
    expect(searchTokens('session events search')).toEqual(['events', 'search', 'session'])
    expect(searchTokens('search session events')).toEqual(['events', 'search', 'session'])
    expect(searchTokens('events session search')).toEqual(['events', 'search', 'session'])
  })
})
