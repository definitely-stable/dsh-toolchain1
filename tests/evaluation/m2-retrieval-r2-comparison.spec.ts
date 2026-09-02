import { describe, expect, it } from 'vitest'

import {
  compareR2RetrievalResults,
  type R2RankedResult,
} from './m2-retrieval-r2-comparison.js'
import type { R2RetrievalTask } from './m2-retrieval-r2.js'

function answerableTask(overrides: Partial<R2RetrievalTask> = {}): R2RetrievalTask {
  return {
    id: 'answerable',
    scenario: 'indirect-intent',
    domain: 'tools',
    query: 'find tools contract',
    expectedContractIds: ['package:expected'],
    forbiddenContractIds: ['package:forbidden'],
    referenceRoute: ['fixture:answerable'],
    provenance: 'synthetic comparison fixture',
    ...overrides,
  }
}

function noResultTask(overrides: Partial<R2RetrievalTask> = {}): R2RetrievalTask {
  return {
    id: 'negative',
    scenario: 'natural-hard-negative',
    domain: 'tools',
    query: 'nothing real',
    expectedContractIds: [],
    expectNoResult: true,
    referenceRoute: ['fixture:negative'],
    provenance: 'synthetic comparison fixture',
    ...overrides,
  }
}

function result(taskId: string, rankedContractIds: readonly string[]): R2RankedResult {
  return { taskId, rankedContractIds }
}

describe('Contract Search R2 per-query comparison', () => {
  it('classifies expected-rank improvements and regressions before forbidden-hit tie breaking', () => {
    const task = answerableTask()

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, ['package:other', 'package:expected'])],
      [result(task.id, ['package:expected'])],
    )[0]).toMatchObject({
      taskId: task.id,
      outcome: 'win',
      baseline: { expectedRank: 2 },
      candidate: { expectedRank: 1 },
    })

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, ['package:expected'])],
      [result(task.id, [])],
    )[0]).toMatchObject({
      outcome: 'loss',
      baseline: { expectedRank: 1 },
      candidate: { expectedRank: null },
    })

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, ['package:expected', 'package:forbidden'])],
      [result(task.id, ['package:expected'])],
    )[0]).toMatchObject({
      outcome: 'win',
      baseline: { expectedRank: 1, forbiddenHitAt5: true },
      candidate: { expectedRank: 1, forbiddenHitAt5: false },
    })
  })

  it('treats exact empty-result correctness as the only no-result preference', () => {
    const task = noResultTask()

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, ['package:false-positive'])],
      [result(task.id, [])],
    )[0]).toMatchObject({
      outcome: 'win',
      baseline: { noResultCorrect: false },
      candidate: { noResultCorrect: true },
    })

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, [])],
      [result(task.id, ['package:false-positive'])],
    )[0]?.outcome).toBe('loss')

    expect(compareR2RetrievalResults(
      [task],
      [result(task.id, [])],
      [result(task.id, [])],
    )[0]?.outcome).toBe('tie')
  })

  it('rejects duplicate, missing and unknown ranked results before comparing', () => {
    const tasks = [answerableTask(), noResultTask()]
    const complete = [result('answerable', []), result('negative', [])]

    expect(() => compareR2RetrievalResults(tasks, [complete[0]!, complete[0]!, complete[1]!], complete))
      .toThrow(/Duplicate baseline R2 result/u)
    expect(() => compareR2RetrievalResults(tasks, [complete[0]!], complete))
      .toThrow(/Missing baseline R2 result/u)
    expect(() => compareR2RetrievalResults(tasks, [...complete, result('unknown', [])], complete))
      .toThrow(/Unknown baseline R2 result/u)
  })

  it('returns diagnostics in stable task-id order independent of result input order', () => {
    const tasks = [noResultTask({ id: 'z-task' }), answerableTask({ id: 'a-task' })]
    const baseline = [result('z-task', []), result('a-task', ['package:expected'])]
    const candidate = baseline.toReversed()

    expect(compareR2RetrievalResults(tasks, baseline, candidate).map(item => item.taskId))
      .toEqual(['a-task', 'z-task'])
  })
})
