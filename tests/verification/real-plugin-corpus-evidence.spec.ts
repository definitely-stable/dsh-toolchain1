import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_CORPUS_FAILURE_MESSAGE_CHARS,
  appendCorpusEvidenceRecord,
  boundedCorpusFailureMessage,
  initializeCorpusEvidence,
} from '../../scripts/real-plugin-corpus/evidence.mjs'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('real plugin corpus evidence persistence', () => {
  it('initializes durable evidence and appends records immediately', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-corpus-evidence-test-'))
    roots.push(root)
    const environment = { schemaVersion: 1, mode: 'smoke' }

    await initializeCorpusEvidence(root, environment)
    expect(await readFile(join(root, 'environment.json'), 'utf8')).toBe(`${JSON.stringify(environment, undefined, 2)}\n`)
    expect(await readFile(join(root, 'results.jsonl'), 'utf8')).toBe('')

    const first = { pluginId: 'one', operation: 'plugin.check', semanticOutcome: 'unproven' }
    const second = { pluginId: 'two', operation: 'plugin.check', semanticOutcome: 'compatible-in-scope' }
    await appendCorpusEvidenceRecord(root, first)
    expect(await readFile(join(root, 'results.jsonl'), 'utf8')).toBe(`${JSON.stringify(first)}\n`)

    await appendCorpusEvidenceRecord(root, second)
    expect(await readFile(join(root, 'results.jsonl'), 'utf8')).toBe(
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    )
  })

  it('bounds and sanitizes failure text before persistence', () => {
    const noisy = `\u001B[31mboom\u001B[0m\u0000${'x'.repeat(MAX_CORPUS_FAILURE_MESSAGE_CHARS * 2)}`
    const message = boundedCorpusFailureMessage(new Error(noisy))

    expect(message).not.toContain('\u001B')
    expect(message).not.toContain('\u0000')
    expect(message.length).toBeLessThanOrEqual(MAX_CORPUS_FAILURE_MESSAGE_CHARS)
    expect(message).toContain('boom')
  })
})
