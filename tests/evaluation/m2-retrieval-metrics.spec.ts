import { describe, expect, it } from 'vitest'

import {
  calculateM2RetrievalMetrics,
  validateM2RetrievalCorpus,
  type M2RankedTaskResult,
  type M2RetrievalTask,
} from './m2-retrieval-metrics.js'

const knownContractIds = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'Z'])

function validTasks(): M2RetrievalTask[] {
  return [
    {
      id: 'exact',
      category: 'exact-symbol',
      query: 'ExactSymbol',
      expectedContractIds: ['A'],
      provenance: 'fixture:exact',
    },
    {
      id: 'package',
      category: 'package-api',
      query: 'Package API',
      expectedContractIds: ['B'],
      forbiddenContractIds: ['X'],
      provenance: 'fixture:package',
    },
    {
      id: 'natural',
      category: 'natural-language',
      query: 'natural language mechanism',
      expectedContractIds: ['C'],
      provenance: 'fixture:natural',
    },
    {
      id: 'indirect',
      category: 'indirect',
      query: 'indirect phrasing',
      expectedContractIds: ['D'],
      provenance: 'fixture:indirect',
    },
    {
      id: 'ambiguous',
      category: 'ambiguous',
      query: 'ambiguous entry point',
      expectedContractIds: ['E', 'F'],
      forbiddenContractIds: ['Z'],
      provenance: 'fixture:ambiguous',
    },
    {
      id: 'none',
      category: 'no-result',
      query: 'obsolete nonexistent api',
      expectedContractIds: [],
      expectNoResult: true,
      provenance: 'fixture:none',
    },
  ]
}

function rankedResults(): M2RankedTaskResult[] {
  const tasks = validTasks()
  return [
    { task: tasks[0]!, rankedContractIds: ['A'] },
    { task: tasks[1]!, rankedContractIds: ['X', 'B'] },
    { task: tasks[2]!, rankedContractIds: ['Y', 'Z', 'X', 'D', 'C'] },
    { task: tasks[3]!, rankedContractIds: [] },
    { task: tasks[4]!, rankedContractIds: ['F'] },
    { task: tasks[5]!, rankedContractIds: [] },
  ]
}

function expectInvalid(tasks: readonly M2RetrievalTask[], pattern: RegExp): void {
  expect(() => validateM2RetrievalCorpus(tasks, knownContractIds)).toThrow(pattern)
}

describe('M2.3 retrieval metric arithmetic', () => {
  it('computes macro top-k recall, MRR, no-result correctness, and explicit wrong-contract rate', () => {
    const metrics = calculateM2RetrievalMetrics(rankedResults())

    expect(metrics.taskCount).toBe(6)
    expect(metrics.answerableTaskCount).toBe(5)
    expect(metrics.noResultTaskCount).toBe(1)
    expect(metrics.recallAt1).toBeCloseTo(2 / 5)
    expect(metrics.recallAt3).toBeCloseTo(3 / 5)
    expect(metrics.recallAt5).toBeCloseTo(4 / 5)
    expect(metrics.meanReciprocalRank).toBeCloseTo((1 + 1 / 2 + 1 / 5 + 0 + 1) / 5)
    expect(metrics.noResultCorrectness).toBe(1)
    expect(metrics.wrongContractRate).toBeCloseTo(1 / 2)
  })

  it('keeps category failures visible instead of letting exact-symbol tasks hide them', () => {
    const metrics = calculateM2RetrievalMetrics(rankedResults())

    expect(metrics.byCategory['exact-symbol']).toMatchObject({
      taskCount: 1,
      recallAt1: 1,
      meanReciprocalRank: 1,
    })
    expect(metrics.byCategory['natural-language']).toMatchObject({
      taskCount: 1,
      recallAt1: 0,
      recallAt3: 0,
      recallAt5: 1,
      meanReciprocalRank: 1 / 5,
    })
    expect(metrics.byCategory.indirect).toMatchObject({
      taskCount: 1,
      recallAt5: 0,
      meanReciprocalRank: 0,
    })
    expect(metrics.byCategory['no-result']).toMatchObject({
      taskCount: 1,
      recallAt1: null,
      meanReciprocalRank: null,
      noResultCorrectness: 1,
    })
  })
})

describe('M2.3 retrieval corpus validation', () => {
  it('accepts one well-formed corpus covering every frozen category', () => {
    expect(() => validateM2RetrievalCorpus(validTasks(), knownContractIds)).not.toThrow()
  })

  it('rejects duplicate task ids', () => {
    const tasks = validTasks()
    tasks[1] = { ...tasks[1]!, id: tasks[0]!.id }
    expectInvalid(tasks, /duplicate task id/i)
  })

  it('rejects duplicate expected or forbidden contract ids', () => {
    const expected = validTasks()
    expected[0] = { ...expected[0]!, expectedContractIds: ['A', 'A'] }
    expectInvalid(expected, /duplicate expected contract/i)

    const forbidden = validTasks()
    forbidden[1] = { ...forbidden[1]!, forbiddenContractIds: ['X', 'X'] }
    expectInvalid(forbidden, /duplicate forbidden contract/i)
  })

  it('rejects empty query or provenance', () => {
    const query = validTasks()
    query[0] = { ...query[0]!, query: '   ' }
    expectInvalid(query, /query/i)

    const provenance = validTasks()
    provenance[0] = { ...provenance[0]!, provenance: '' }
    expectInvalid(provenance, /provenance/i)
  })

  it('rejects expected or forbidden contract ids absent from the frozen index', () => {
    const expected = validTasks()
    expected[0] = { ...expected[0]!, expectedContractIds: ['missing'] }
    expectInvalid(expected, /unknown expected contract/i)

    const forbidden = validTasks()
    forbidden[1] = { ...forbidden[1]!, forbiddenContractIds: ['missing'] }
    expectInvalid(forbidden, /unknown forbidden contract/i)
  })

  it('rejects overlap between acceptable and forbidden ids', () => {
    const tasks = validTasks()
    tasks[1] = { ...tasks[1]!, forbiddenContractIds: ['B'] }
    expectInvalid(tasks, /both expected and forbidden/i)
  })

  it('rejects contradictory no-result tasks and answerable tasks without expectations', () => {
    const contradictory = validTasks()
    contradictory[5] = {
      ...contradictory[5]!,
      expectedContractIds: ['A'],
      expectNoResult: true,
    }
    expectInvalid(contradictory, /no-result task.*expected/i)

    const answerable = validTasks()
    answerable[0] = { ...answerable[0]!, expectedContractIds: [] }
    expectInvalid(answerable, /answerable task.*expected/i)
  })

  it('requires the no-result category to agree with expectNoResult', () => {
    const mislabeledNoResult = validTasks()
    mislabeledNoResult[5] = {
      ...mislabeledNoResult[5]!,
      category: 'exact-symbol',
    }
    expectInvalid(mislabeledNoResult, /no-result category/i)

    const mislabeledAnswerable = validTasks()
    mislabeledAnswerable[0] = {
      ...mislabeledAnswerable[0]!,
      category: 'no-result',
    }
    expectInvalid(mislabeledAnswerable, /no-result category/i)
  })

  it('requires every frozen category, at least one no-result task, and at least one forbidden-bearing task', () => {
    const missingCategory = validTasks()
    missingCategory[4] = { ...missingCategory[4]!, category: 'indirect' }
    expectInvalid(missingCategory, /missing category.*ambiguous/i)

    const noNoResult = validTasks().map(task => task.id === 'none'
      ? { ...task, category: 'exact-symbol' as const, expectedContractIds: ['A'], expectNoResult: false }
      : task)
    expectInvalid(noNoResult, /at least one no-result/i)

    const noForbidden = validTasks().map(task => ({ ...task, forbiddenContractIds: undefined }))
    expectInvalid(noForbidden, /at least one.*forbidden/i)
  })
})
