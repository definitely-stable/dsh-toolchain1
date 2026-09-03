#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadDevelopmentCorpus } from './development-corpus.mjs'
import { buildStagedEvaluationReport } from './staged-report.mjs'
import { runStagedEvaluation } from './staged-runner.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ALLOWED_MODES = Object.freeze(['canary', 'dev', 'release', 'research'])
const ALLOWED_OPTIONS = Object.freeze(new Set(['--mode', '--manifest', '--output']))

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

export function parseStagedRunArguments(args) {
  if (!Array.isArray(args)) throw new Error('staged evaluation arguments must be an array')
  if (args.length % 2 !== 0) throw new Error('staged evaluation options require explicit values')

  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (typeof option !== 'string' || !option.startsWith('--')) throw new Error(`invalid staged evaluation option ${String(option)}`)
    if (!ALLOWED_OPTIONS.has(option)) throw new Error(`unknown staged evaluation option ${option}`)
    if (values.has(option)) throw new Error(`duplicate staged evaluation option ${option}`)
    values.set(option, requireNonEmpty(value, `${option} value`))
  }

  for (const required of ALLOWED_OPTIONS) {
    if (!values.has(required)) throw new Error(`staged evaluation requires ${required}`)
  }

  const mode = values.get('--mode')
  if (!ALLOWED_MODES.includes(mode)) throw new Error('mode must be one of canary, dev, release, research')

  return Object.freeze({
    mode,
    manifestPath: values.get('--manifest'),
    outputPath: values.get('--output'),
  })
}

/**
 * @param {{ args?: string[]; execute?: Function }} [input]
 */
export async function runStagedCommand(input = {}) {
  const parsed = parseStagedRunArguments(input.args ?? process.argv.slice(2))
  if (typeof input.execute !== 'function') throw new Error('development executor is not configured')

  const corpus = await loadDevelopmentCorpus(parsed.manifestPath)
  const run = await runStagedEvaluation({
    mode: parsed.mode,
    tasks: [...corpus.tasks],
    execute: input.execute,
  })
  const report = buildStagedEvaluationReport(run)

  const resolvedOutput = path.resolve(parsed.outputPath)
  await mkdir(path.dirname(resolvedOutput), { recursive: true })
  await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

async function main() {
  const report = await runStagedCommand()
  process.stdout.write(`${JSON.stringify({ status: report.measurement.status, mode: report.mode }, null, 2)}\n`)
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
