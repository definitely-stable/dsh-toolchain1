import { describe, expect, it } from 'vitest'

import { searchContractIndex } from '../../src/model/contract.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  R2_DEV_SCENARIOS,
  R2_RETRIEVAL_DEV,
  fingerprintR2RetrievalCorpus,
  validateR2RetrievalCorpus,
} from './m2-retrieval-r2.js'

interface ScenarioBaseline {
  readonly taskCount: number
  readonly answerableCount: number
  readonly top1Hits: number
  readonly top5Hits: number
  readonly noResultCorrect: number
  readonly forbiddenHitAt5: number
}

function emptyScenarioBaseline(): ScenarioBaseline {
  return {
    taskCount: 0,
    answerableCount: 0,
    top1Hits: 0,
    top5Hits: 0,
    noResultCorrect: 0,
    forbiddenHitAt5: 0,
  }
}

describe('Contract Search R2 development baseline observation', () => {
  it('records the immutable corpus identity and descriptive current-v2 behavior without making it a tuning gate', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const knownContractIds = new Set(index.contracts.map(contract => contract.id))
    validateR2RetrievalCorpus(R2_RETRIEVAL_DEV, knownContractIds)

    const byScenario = Object.fromEntries(
      R2_DEV_SCENARIOS.map(scenario => [scenario, emptyScenarioBaseline()]),
    ) as Record<(typeof R2_DEV_SCENARIOS)[number], ScenarioBaseline>

    let answerableCount = 0
    let top1Hits = 0
    let top5Hits = 0
    let noResultCorrect = 0
    let forbiddenHitAt5 = 0

    for (const task of R2_RETRIEVAL_DEV) {
      const selection = searchContractIndex(index, task.query, undefined, 5)
      const ranked = selection.matches.map(match => match.id)
      const expected = new Set(task.expectedContractIds)
      const forbidden = new Set(task.forbiddenContractIds ?? [])
      const scenario = byScenario[task.scenario]

      expect(ranked.length).toBeLessThanOrEqual(5)
      expect(new Set(ranked).size).toBe(ranked.length)
      for (const evidence of selection.evidence) {
        expect(index.evidence.some(item => item.id === evidence.id)).toBe(true)
      }

      scenario.taskCount += 1
      if (task.expectNoResult === true) {
        if (ranked.length === 0) {
          noResultCorrect += 1
          scenario.noResultCorrect += 1
        }
      } else {
        answerableCount += 1
        scenario.answerableCount += 1
        if (ranked[0] !== undefined && expected.has(ranked[0])) {
          top1Hits += 1
          scenario.top1Hits += 1
        }
        if (ranked.slice(0, 5).some(id => expected.has(id))) {
          top5Hits += 1
          scenario.top5Hits += 1
        }
      }
      if (ranked.slice(0, 5).some(id => forbidden.has(id))) {
        forbiddenHitAt5 += 1
        scenario.forbiddenHitAt5 += 1
      }
    }

    const marker = Object.freeze({
      schema: 'dsh-contract-search-r2-dev-baseline-v1',
      corpusFingerprint: fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint),
      contractIndexFingerprint: index.fingerprint,
      productionRankerVersion: 'dsh-contract-search-v2-intent',
      taskCount: R2_RETRIEVAL_DEV.length,
      answerableCount,
      noResultCount: R2_RETRIEVAL_DEV.length - answerableCount,
      top1Hits,
      top5Hits,
      noResultCorrect,
      forbiddenHitAt5,
      byScenario,
    })

    console.log(`M2_RETRIEVAL_R2_DEV_BASELINE ${JSON.stringify(marker)}`)

    expect(marker.taskCount).toBe(18)
    expect(marker.answerableCount).toBe(12)
    expect(marker.noResultCount).toBe(6)
  })
})
