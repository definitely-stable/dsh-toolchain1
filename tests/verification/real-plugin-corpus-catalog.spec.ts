import { describe, expect, it } from 'vitest'

import {
  REAL_PLUGIN_CORPUS_DSH_VERSION,
  listRealPluginCorpus,
  selectRealPluginCorpus,
} from '../../scripts/real-plugin-corpus/catalog.mjs'

const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const commitSha = /^[0-9a-f]{40}$/u

describe('real plugin corpus catalog', () => {
  it('pins the current compatibility target without changing historical smoke trains', () => {
    expect(REAL_PLUGIN_CORPUS_DSH_VERSION).toBe('0.1.5-rc.2')
  })

  it('contains six unique, exact, source-pinned popular plugins', () => {
    const corpus = listRealPluginCorpus()

    expect(corpus).toHaveLength(6)
    expect(new Set(corpus.map(entry => entry.id)).size).toBe(corpus.length)
    expect(new Set(corpus.map(entry => `${entry.packageName}@${entry.version}`)).size).toBe(corpus.length)

    for (const entry of corpus) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(entry.packageName.length).toBeGreaterThan(0)
      expect(entry.version).toMatch(exactVersion)
      expect(entry.version).not.toMatch(/[\^~*><=|]/u)
      expect(entry.sourceRepo).toMatch(/^[^/]+\/[^/]+$/u)
      expect(entry.sourceRef).toMatch(commitSha)
      expect(entry.category.length).toBeGreaterThan(0)
      expect(['npm', 'github-source']).toContain(entry.distribution)
    }
  })

  it('models source-distributed plugins explicitly instead of assuming npm publication', () => {
    const corpus = listRealPluginCorpus()
    const atFile = corpus.find(entry => entry.id === 'at-file')

    expect(atFile?.distribution).toBe('github-source')
    expect(corpus.filter(entry => entry.distribution === 'github-source').map(entry => entry.id)).toEqual(['at-file'])
  })

  it('keeps runtime verification opt-in and bounded to three entries', () => {
    const runtimeEntries = listRealPluginCorpus().filter(entry => entry.runtimeVerify)

    expect(runtimeEntries.map(entry => entry.id).toSorted()).toEqual([
      'agent-teams',
      'at-file',
      'dsh-market',
    ])
  })

  it('uses a two-plugin static-only smoke set and the full corpus for static/full', () => {
    const smoke = selectRealPluginCorpus('smoke')
    const staticCorpus = selectRealPluginCorpus('static')
    const full = selectRealPluginCorpus('full')

    expect(smoke.map(entry => entry.id)).toEqual(['modlens', 'at-file'])
    expect(smoke.every(entry => entry.runtimeExecution === false)).toBe(true)
    expect(staticCorpus).toHaveLength(6)
    expect(staticCorpus.every(entry => entry.runtimeExecution === false)).toBe(true)
    expect(full).toHaveLength(6)
    expect(full.filter(entry => entry.runtimeExecution).map(entry => entry.id).toSorted()).toEqual([
      'agent-teams',
      'at-file',
      'dsh-market',
    ])
  })

  it('rejects unknown corpus modes', () => {
    expect(() => selectRealPluginCorpus('everything')).toThrow(/unknown real plugin corpus mode/i)
  })
})
