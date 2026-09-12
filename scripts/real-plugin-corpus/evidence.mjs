import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const MAX_CORPUS_FAILURE_MESSAGE_CHARS = 512

const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu

export function boundedCorpusFailureMessage(error) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(ANSI_ESCAPE, '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CORPUS_FAILURE_MESSAGE_CHARS)
}

export async function initializeCorpusEvidence(outputDir, environment) {
  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(join(outputDir, 'environment.json'), `${JSON.stringify(environment, undefined, 2)}\n`),
    writeFile(join(outputDir, 'results.jsonl'), ''),
  ])
}

export async function appendCorpusEvidenceRecord(outputDir, record) {
  await appendFile(join(outputDir, 'results.jsonl'), `${JSON.stringify(record)}\n`)
}
