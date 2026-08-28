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
      domain: 'tools',
      intentGroup: 'tool-definition-symbol',
      sourceKind: 'declaration',
      query: 'ExactSymbol',
      expectedContractIds: ['A'],
      referenceRoute: ['package:A', 'declaration-export:ExactSymbol'],
      provenance: 'fixture:exact',
    },
    {
      id: 'package',
      category: 'package-api',
      domain: 'agent',
      intentGroup: 'agent-package-api',
      sourceKind: 'declaration',
      query: 'Package API',
      expectedContractIds: ['B'],
      forbiddenContractIds: ['X'],
      referenceRoute: ['package:B', 'declaration-export:PackageApi'],
      provenance: 'fixture:package',
    },
    {
      id: 'natural',
      category: 'natural-language',
      domain: 'session',
      intentGroup: 'session-lifecycle',
      sourceKind: 'declaration',
      query: 'natural language mechanism',
      expectedContractIds: ['C'],
      referenceRoute: ['package:C', 'declaration-export:SessionLifecycle'],
      provenance: 'fixture:natural',
    },
    {
      id: 'indirect',
      category: 'indirect',
      domain: 'prompt',
      intentGroup: 'prompt-assembly',
      sourceKind: 'declaration',
      query: 'indirect phrasing',
      expectedContractIds: ['D'],
      referenceRoute: ['package:D', 'declaration-export:PromptAssembler'],
      provenance: 'fixture:indirect',
    },
    {
      id: 'ambiguous',
      category: 'ambiguous',
      domain: 'scope',
      intentGroup: 'scope-control',
      sourceKind: 'declaration',
      query: 'ambiguous entry point',
      expectedContractIds: ['E', 'F'],
      forbiddenContractIds: ['Z'],
      referenceRoute: ['package:E', 'declaration-export:ScopeControl'],
      provenance: 'fixture:ambiguous',
    },
    {
      id: 'none',
      category: 'no-result',
      domain: 'obsolete-api',
      intentGroup: 'nonexistent-obsolete-api',
      sourceKind: 'negative-oracle',
      query: 'obsolete nonexistent api',
      expectedContractIds: [],
      expectNoResult: true,
      referenceRoute: ['fixture:complete-contract-universe', 'oracle:no-useful-replacement'],
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
  it('computes macro top-k success, MRR, no-result correctness, and explicit forbidden-hit rate', () => {
    const metrics = calculateM2RetrievalMetrics(rankedResults())

    expect(metrics.taskCount).toBe(6)
    expect(metrics.answerableTaskCount).toBe(5)
    expect(metrics.noResultTaskCount).toBe(1)
    expect(metrics.successAt1).toBeCloseTo(2 / 5)
    expect(metrics.successAt3).toBeCloseTo(3 / 5)
    expect(metrics.successAt5).toBeCloseTo(4 / 5)
    expect(metrics.meanReciprocalRank).toBeCloseTo((1 + 1 / 2 + 1 / 5 + 0 + 1) / 5)
    expect(metrics.noResultCorrectness).toBe(1)
    expect(metrics.forbiddenHitRateAt5).toBeCloseTo(1 / 2)
  })

  it('keeps category failures visible instead of letting exact-symbol tasks hide them', () => {
    const metrics = calculateM2RetrievalMetrics(rankedResults())

    expect(metrics.byCategory['exact-symbol']).toMatchObject({
      taskCount: 1,
      successAt1: 1,
      meanReciprocalRank: 1,
    })
    expect(metrics.byCategory['natural-language']).toMatchObject({
      taskCount: 1,
      successAt1: 0,
      successAt3: 0,
      successAt5: 1,
      meanReciprocalRank: 1 / 5,
    })
    expect(metrics.byCategory.indirect).toMatchObject({
      taskCount: 1,
      successAt5: 0,
      meanReciprocalRank: 0,
    })
    expect(metrics.byCategory['no-result']).toMatchObject({
      taskCount: 1,
      successAt1: null,
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

  it('rejects empty query, provenance, orthogonal metadata, or reference-route segments', () => {
    const query = validTasks()
    query[0] = { ...query[0]!, query: '   ' }
    expectInvalid(query, /query/i)

    const provenance = validTasks()
    provenance[0] = { ...provenance[0]!, provenance: '' }
    expectInvalid(provenance, /provenance/i)

    for (const field of ['domain', 'intentGroup', 'sourceKind'] as const) {
      const tasks = validTasks()
      tasks[0] = { ...tasks[0]!, [field]: '   ' }
      expectInvalid(tasks, new RegExp(field, 'i'))
    }

    const noRoute = validTasks()
    noRoute[0] = { ...noRoute[0]!, referenceRoute: [] }
    expectInvalid(noRoute, /reference route/i)

    const blankRoute = validTasks()
    blankRoute[0] = { ...blankRoute[0]!, referenceRoute: ['package:A', '   '] }
    expectInvalid(blankRoute, /reference route/i)
  })

  it('bounds intent-group concentration to three tasks', () => {
    const tasks = validTasks()
    for (let index = 0; index < 4; index += 1) {
      tasks[index] = { ...tasks[index]!, intentGroup: 'over-concentrated-intent' }
    }
    expectInvalid(tasks, /intent group.*more than 3/i)
  })

  it('rejects duplicate or blank risk tags', () => {
    const duplicate = validTasks()
    duplicate[0] = { ...duplicate[0]!, riskTags: ['version-drift', 'version-drift'] }
    expectInvalid(duplicate, /duplicate risk tag/i)

    const blank = validTasks()
    blank[0] = { ...blank[0]!, riskTags: ['   '] }
    expectInvalid(blank, /risk tag/i)
  })

  it('rejects expected, forbidden, or replacement contract ids absent from the frozen index', () => {
    const expected = validTasks()
    expected[0] = { ...expected[0]!, expectedContractIds: ['missing'] }
    expectInvalid(expected, /unknown expected contract/i)

    const forbidden = validTasks()
    forbidden[1] = { ...forbidden[1]!, forbiddenContractIds: ['missing'] }
    expectInvalid(forbidden, /unknown forbidden contract/i)

    const replacement = validTasks()
    replacement[0] = {
      ...replacement[0]!,
      expectedContractIds: ['A'],
      replacementContractIds: ['missing'],
      riskTags: ['version-drift'],
    }
    expectInvalid(replacement, /unknown replacement contract/i)
  })

  it('requires replacements to be acceptable version-drift answers', () => {
    const validReplacement = validTasks()
    validReplacement[0] = {
      ...validReplacement[0]!,
      expectedContractIds: ['A', 'B'],
      replacementContractIds: ['B'],
      riskTags: ['version-drift'],
    }
    expect(() => validateM2RetrievalCorpus(validReplacement, knownContractIds)).not.toThrow()

    const notExpected = validTasks()
    notExpected[0] = {
      ...notExpected[0]!,
      replacementContractIds: ['B'],
      riskTags: ['version-drift'],
    }
    expectInvalid(notExpected, /replacement contract.*expected/i)

    const missingRisk = validTasks()
    missingRisk[0] = {
      ...missingRisk[0]!,
      expectedContractIds: ['A', 'B'],
      replacementContractIds: ['B'],
    }
    expectInvalid(missingRisk, /replacement.*version-drift/i)
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

    const replacement = validTasks()
    replacement[5] = {
      ...replacement[5]!,
      replacementContractIds: ['A'],
      riskTags: ['version-drift'],
    }
    expectInvalid(replacement, /no-result task.*replacement/i)

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

    const noForbidden = validTasks().map(task => {
      const { forbiddenContractIds, ...withoutForbidden } = task
      void forbiddenContractIds
      return withoutForbidden
    })
    expectInvalid(noForbidden, /at least one.*forbidden/i)
  })
})
