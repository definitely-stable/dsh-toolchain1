import { describe, expect, it } from 'vitest'

import { loadDevelopmentCorpus, selectEvaluationTasks } from '../../scripts/eval/development-corpus.mjs'

describe('staged evaluation development corpus', () => {
  it('loads the disclosed H1 corpus with verified shard hashes', async () => {
    const corpus = await loadDevelopmentCorpus('docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    expect(corpus.status).toBe('DEVELOPMENT_ONLY')
    expect(corpus.tasks).toHaveLength(96)
    expect(new Set(corpus.tasks.map(task => task.id)).size).toBe(96)
    expect(corpus.futureHoldoutAllowed).toBe(false)
  })

  it('selects an 8-task canary with one task from each domain', async () => {
    const corpus = await loadDevelopmentCorpus('docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    const selected = selectEvaluationTasks(corpus.tasks, 8)
    expect(selected).toHaveLength(8)
    expect(new Set(selected.map(task => task.domain)).size).toBe(8)
  })

  it('selects larger sets deterministically with no duplicates', async () => {
    const corpus = await loadDevelopmentCorpus('docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    const first = selectEvaluationTasks(corpus.tasks, 20)
    const second = selectEvaluationTasks(corpus.tasks, 20)
    expect(first).toEqual(second)
    expect(new Set(first.map(task => task.id)).size).toBe(20)
    expect(new Set(first.map(task => task.domain)).size).toBe(8)
  })
})
