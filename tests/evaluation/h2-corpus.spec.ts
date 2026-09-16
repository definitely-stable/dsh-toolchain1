import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { buildCorpusManifest, loadH2Corpus } from '../../scripts/eval/h2/h2-corpus.mjs'
import { buildDatasetCommitment } from '../../scripts/eval/h2/h2-commitment.mjs'

const SEED = resolve('tests/evaluation/fixtures/h2/corpus-seed')
// Fixture task ids use the reserved 90-series ordinal. The frozen policy fixes
// exactly three hidden tasks per stratum (ids -01..-03), so a 90-series id can
// never collide with a hidden task id, and these throwaway fixtures can never be
// mistaken for real corpus entries.
const FIXTURE_TASKS = [
  { taskId: 'h2-exact-target-api-90', stratum: 'exact-target-api' },
  { taskId: 'h2-cordis-service-90', stratum: 'cordis-service' },
]

let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-corpus-test-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  tmpRoot = await mkdtemp(join(tmpdir(), 'h2-corpus-test-'))
})

async function seedCorpus(): Promise<string> {
  const corpus = join(tmpRoot, 'corpus')
  await mkdir(corpus, { recursive: true })
  for (const name of ['prompts', 'workspaces', 'reference-fixes', 'graders']) {
    await mkdir(join(corpus, name), { recursive: true })
  }
  for (const task of FIXTURE_TASKS) {
    await copyFile(join(SEED, 'prompts', `${task.taskId}.md`), join(corpus, 'prompts', `${task.taskId}.md`))
    await copyFile(join(SEED, 'graders', `${task.taskId}.mjs`), join(corpus, 'graders', `${task.taskId}.mjs`))
    await mkdir(join(corpus, 'workspaces', task.taskId), { recursive: true })
    await copyFile(
      join(SEED, 'workspaces', task.taskId, 'index.mjs'),
      join(corpus, 'workspaces', task.taskId, 'index.mjs'),
    )
    await mkdir(join(corpus, 'reference-fixes', task.taskId), { recursive: true })
    await copyFile(
      join(SEED, 'reference-fixes', task.taskId, 'index.mjs'),
      join(corpus, 'reference-fixes', task.taskId, 'index.mjs'),
    )
  }
  await buildCorpusManifest(corpus)
  return corpus
}

describe('H2 private corpus loader', () => {
  it('loads a manifest-consistent corpus and returns path-only descriptors', async () => {
    const corpus = await seedCorpus()
    const { tasks, dataset } = loadH2Corpus({ corpusDir: corpus })
    expect(tasks).toHaveLength(2)
    expect(tasks.map(task => task.taskId).sort()).toEqual(FIXTURE_TASKS.map(task => task.taskId).sort())
    for (const task of tasks) {
      expect(task.stratum).toBeTruthy()
      expect(typeof task.promptPath).toBe('string')
      expect(typeof task.graderPath).toBe('string')
      // Descriptors carry paths only; never hidden content.
      const serialized = JSON.stringify(task)
      expect(serialized).not.toContain('hidden task prompt body')
      expect(serialized).not.toContain('withSecret')
      expect(serialized).not.toContain('graderSecret')
    }
    expect(dataset.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies the dataset commitment when expected and fails closed on mismatch', async () => {
    const corpus = await seedCorpus()
    const { dataset } = loadH2Corpus({ corpusDir: corpus })
    expect(() => loadH2Corpus({ corpusDir: corpus, expectedDatasetSha256: dataset.sha256 })).not.toThrow()
    expect(() => loadH2Corpus({ corpusDir: corpus, expectedDatasetSha256: '0'.repeat(64) }))
      .toThrow(/commitment/gi)
  })

  it('fails closed when a workspace file is tampered after the manifest was built', async () => {
    const corpus = await seedCorpus()
    await writeFile(join(corpus, 'workspaces', FIXTURE_TASKS[0]!.taskId, 'index.mjs'), '// tampered\n', 'utf8')
    expect(() => loadH2Corpus({ corpusDir: corpus })).toThrow(/hash|digest|mismatch/i)
  })

  it('rejects corpora with duplicate task ids or unknown strata', async () => {
    const corpus = await seedCorpus()
    const manifestPath = join(corpus, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.tasks[1].stratum = 'not-a-stratum'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    expect(() => loadH2Corpus({ corpusDir: corpus })).toThrow(/stratum/)
  })

  it('rejects workspaces that would break deterministic grading (node_modules)', async () => {
    const corpus = await seedCorpus()
    await mkdir(join(corpus, 'workspaces', FIXTURE_TASKS[0]!.taskId, 'node_modules'), { recursive: true })
    await writeFile(join(corpus, 'workspaces', FIXTURE_TASKS[0]!.taskId, 'node_modules', 'x.js'), '1', 'utf8')
    expect(() => loadH2Corpus({ corpusDir: corpus })).toThrow(/node_modules/)
  })

  it('rejects task ids that appear in any disclosed evaluation corpus', async () => {
    const corpus = await seedCorpus()
    const disclosed = join(tmpRoot, 'disclosed')
    await mkdir(disclosed, { recursive: true })
    await writeFile(join(disclosed, 'dev-corpus.json'), JSON.stringify({ tasks: [{ id: FIXTURE_TASKS[0]!.taskId }] }), 'utf8')
    expect(() => loadH2Corpus({ corpusDir: corpus, disclosedRoots: [disclosed] }))
      .toThrow(/disclosed/i)
  })

  it('computes a deterministic manifest that survives reload', async () => {
    const first = await seedCorpus()
    const second = await seedCorpus()
    const a = loadH2Corpus({ corpusDir: first })
    const b = loadH2Corpus({ corpusDir: second })
    expect(b.dataset.sha256).toBe(a.dataset.sha256)
    expect(b.dataset.sha256).toBe(buildDatasetCommitment(a.tasks.map(task => ({
      taskId: task.taskId,
      stratum: task.stratum,
      promptSha256: task.contentHashes.promptSha256,
      workspaceSha256: task.contentHashes.workspaceSha256,
      referenceFixSha256: task.contentHashes.referenceFixSha256,
      graderSha256: task.contentHashes.graderSha256,
    }))).sha256)
  })
})