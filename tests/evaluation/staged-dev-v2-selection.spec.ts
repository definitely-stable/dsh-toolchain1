import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { loadDevelopmentCorpus, selectEvaluationTasks } from '../../scripts/eval/development-corpus.mjs'

const RECEIPT_PATH = 'docs/evaluation/m2/staged-dev-v2-selection.json'
const MANIFEST_PATH = 'docs/evaluation/m2/h1-dev-corpus-v1/manifest.json'

function successKind(task: { successRule?: { kind?: unknown } }): string | undefined {
  return typeof task.successRule?.kind === 'string' ? task.successRule.kind : undefined
}

function counts(values: readonly string[]) {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return result
}

describe('staged dev v2 frozen development selection', () => {
  it('binds the exact 20-task domain × oracle-kind selection and source corpus bytes before any model outcome', async () => {
    const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8')) as {
      schema: string
      status: string
      selectorVersion: string
      sourceCorpus: {
        manifest: string
        taskCount: number
        futureHoldoutAllowed: boolean
        shards: Array<{ path: string; taskCount: number; sha256: string }>
      }
      candidateCommit: string
      taskCount: number
      kindCounts: Record<string, number>
      domainCounts: Record<string, number>
      selectedTaskIds: string[]
      selectionCommitmentSha256: string
    }
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as {
      shards: Array<{ path: string; taskCount: number; sha256: string }>
    }
    const corpus = await loadDevelopmentCorpus(MANIFEST_PATH)
    const selected = selectEvaluationTasks(corpus.tasks, receipt.taskCount)
    const selectedTaskIds = selected.map(task => task.id)

    expect(receipt.schema).toBe('dsh-toolchain-staged-dev-selection-v1')
    expect(receipt.status).toBe('FROZEN-DEVELOPMENT-ONLY')
    expect(receipt.selectorVersion).toBe('domain-kind-stratified-v1')
    expect(receipt.sourceCorpus).toMatchObject({
      manifest: MANIFEST_PATH,
      taskCount: 96,
      futureHoldoutAllowed: false,
      shards: manifest.shards,
    })
    expect(receipt.candidateCommit).toBe('8eba7eccba77bb3e047868dbad8ea9c9ced3b033')
    expect(selectedTaskIds).toEqual(receipt.selectedTaskIds)
    expect(receipt.kindCounts).toEqual(counts(selected.map(task => successKind(task) ?? 'unknown')))
    expect(receipt.domainCounts).toEqual(counts(selected.map(task => task.domain)))

    const commitmentIdentity = {
      selectorVersion: receipt.selectorVersion,
      candidateCommit: receipt.candidateCommit,
      sourceCorpusShards: receipt.sourceCorpus.shards,
      selectedTaskIds,
    }
    const commitment = createHash('sha256')
      .update(`${JSON.stringify(commitmentIdentity)}\n`, 'utf8')
      .digest('hex')
    expect(commitment).toBe(receipt.selectionCommitmentSha256)
    expect(receipt.selectionCommitmentSha256).toBe('7c3aa0c23cf150c5ba78258d7d051e8c357d0aa6d102652b1c65b88e6e5310fe')
  })
})
