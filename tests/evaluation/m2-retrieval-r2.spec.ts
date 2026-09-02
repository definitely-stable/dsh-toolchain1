import { describe, expect, it } from 'vitest'

import { M2_RETRIEVAL_R1 } from './m2-retrieval-corpus.js'
import { createFrozenM2RetrievalIndex } from './m2-retrieval-index.js'
import {
  R2_DEV_SCENARIOS,
  R2_RETRIEVAL_DEV,
  canonicalizeR2RetrievalCorpus,
  fingerprintR2RetrievalCorpus,
  validateR2RetrievalCorpus,
  type R2RetrievalTask,
} from './m2-retrieval-r2.js'

const R2_DEV_FINGERPRINT =
  'dsh-contract-search-r2-dev-v1:f2ba02022f1567a3ab748d8182e113d63773556020ab70f3738299645ef4e1b4'

function cloneTask(task: R2RetrievalTask): R2RetrievalTask {
  return {
    ...task,
    expectedContractIds: [...task.expectedContractIds],
    ...(task.forbiddenContractIds === undefined
      ? {}
      : { forbiddenContractIds: [...task.forbiddenContractIds] }),
    referenceRoute: [...task.referenceRoute],
  }
}

describe('Contract Search R2 development corpus', () => {
  it('covers every preregistered development scenario against the exact rc.2 ContractIndex', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const knownContractIds = new Set(index.contracts.map(contract => contract.id))

    expect(() => validateR2RetrievalCorpus(R2_RETRIEVAL_DEV, knownContractIds)).not.toThrow()
    expect(new Set(R2_RETRIEVAL_DEV.map(task => task.scenario))).toEqual(new Set(R2_DEV_SCENARIOS))
    expect(R2_RETRIEVAL_DEV.length).toBeGreaterThanOrEqual(R2_DEV_SCENARIOS.length * 2)
  })

  it('keeps every R2 query newly authored rather than copying disclosed R1 query text', () => {
    const r1Queries = new Set(M2_RETRIEVAL_R1.map(task => task.query))
    const duplicates = R2_RETRIEVAL_DEV.filter(task => r1Queries.has(task.query)).map(task => task.id)
    expect(duplicates).toEqual([])
  })

  it('rejects duplicate ids, missing scenarios, unknown contracts, overlap and contradictory no-result semantics', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const knownContractIds = new Set(index.contracts.map(contract => contract.id))
    const first = R2_RETRIEVAL_DEV[0]!

    expect(() => validateR2RetrievalCorpus([...R2_RETRIEVAL_DEV, cloneTask(first)], knownContractIds))
      .toThrow(/Duplicate R2 task id/u)

    const missingScenario = R2_RETRIEVAL_DEV.filter(task => task.scenario !== R2_DEV_SCENARIOS[0])
    expect(() => validateR2RetrievalCorpus(missingScenario, knownContractIds))
      .toThrow(/missing scenario/u)

    const unknownExpected = R2_RETRIEVAL_DEV.map((task, index) => index === 0
      ? { ...cloneTask(task), expectedContractIds: ['package:@deepseek-ai/dsh-does-not-exist'] }
      : task)
    expect(() => validateR2RetrievalCorpus(unknownExpected, knownContractIds))
      .toThrow(/Unknown expected contract/u)

    const answerable = R2_RETRIEVAL_DEV.find(task => task.expectNoResult !== true)!
    const overlap = R2_RETRIEVAL_DEV.map(task => task.id === answerable.id
      ? {
          ...cloneTask(task),
          forbiddenContractIds: [task.expectedContractIds[0]!],
        }
      : task)
    expect(() => validateR2RetrievalCorpus(overlap, knownContractIds))
      .toThrow(/both expected and forbidden/u)

    const contradictory = R2_RETRIEVAL_DEV.map(task => task.id === answerable.id
      ? { ...cloneTask(task), expectNoResult: true }
      : task)
    expect(() => validateR2RetrievalCorpus(contradictory, knownContractIds))
      .toThrow(/No-result R2 task/u)
  })

  it('locks canonical identity while remaining insensitive to task and set-like id ordering', async () => {
    const index = await createFrozenM2RetrievalIndex()
    const reordered = [...R2_RETRIEVAL_DEV]
      .toReversed()
      .map(task => ({
        ...cloneTask(task),
        expectedContractIds: [...task.expectedContractIds].toReversed(),
        ...(task.forbiddenContractIds === undefined
          ? {}
          : { forbiddenContractIds: [...task.forbiddenContractIds].toReversed() }),
      }))

    const canonical = canonicalizeR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)
    expect(canonicalizeR2RetrievalCorpus(reordered, index.fingerprint)).toBe(canonical)

    const fingerprint = fingerprintR2RetrievalCorpus(R2_RETRIEVAL_DEV, index.fingerprint)
    expect(fingerprint).toBe(R2_DEV_FINGERPRINT)
    expect(fingerprintR2RetrievalCorpus(reordered, index.fingerprint)).toBe(R2_DEV_FINGERPRINT)

    const changed = R2_RETRIEVAL_DEV.map((task, taskIndex) => taskIndex === 0
      ? { ...cloneTask(task), query: `${task.query} changed-semantics` }
      : task)
    expect(fingerprintR2RetrievalCorpus(changed, index.fingerprint)).not.toBe(R2_DEV_FINGERPRINT)
  })
})
