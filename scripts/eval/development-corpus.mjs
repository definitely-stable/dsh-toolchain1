#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(new URL(import.meta.url))
const MANIFEST_SCHEMA = 'dsh-toolchain-m2-h1-development-corpus-manifest-v1'
const SHARD_SCHEMA = 'dsh-toolchain-m2-h1-development-corpus-shard-v1'
const SELECTION_KINDS = Object.freeze(['api-exists-any', 'api-absent'])

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return /** @type {Record<string, unknown>} */ (value)
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return Number(value)
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function readJsonText(filename, label) {
  const text = await readFile(filename, 'utf8')
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error })
  }
  return { text, value }
}

function validateTask(value, label) {
  const task = requireRecord(value, label)
  return Object.freeze({
    ...task,
    id: requireString(task.id, `${label}.id`),
    domain: requireString(task.domain, `${label}.domain`),
    prompt: requireString(task.prompt, `${label}.prompt`),
  })
}

function selectionKind(task, label) {
  const rule = requireRecord(task.successRule, `${label}.successRule`)
  const kind = requireString(rule.kind, `${label}.successRule.kind`)
  if (!SELECTION_KINDS.includes(kind)) {
    throw new Error(`${label}.successRule.kind must be api-exists-any or api-absent`)
  }
  return kind
}

export async function loadDevelopmentCorpus(manifestPath) {
  const resolvedManifest = path.resolve(manifestPath)
  const { value } = await readJsonText(resolvedManifest, 'development corpus manifest')
  const manifest = requireRecord(value, 'development corpus manifest')
  if (manifest.schema !== MANIFEST_SCHEMA) throw new Error('development corpus manifest schema is invalid')
  if (manifest.status !== 'DEVELOPMENT_ONLY') throw new Error('development corpus must be DEVELOPMENT_ONLY')
  if (manifest.futureHoldoutAllowed !== false) throw new Error('development corpus must forbid future holdout use')
  const expectedTaskCount = requireInteger(manifest.taskCount, 'development corpus taskCount')
  if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) throw new Error('development corpus manifest requires shards')

  const base = path.dirname(resolvedManifest)
  const tasks = []
  for (let index = 0; index < manifest.shards.length; index += 1) {
    const entry = requireRecord(manifest.shards[index], `development corpus shard manifest[${index}]`)
    const relativePath = requireString(entry.path, `development corpus shard manifest[${index}].path`)
    if (path.isAbsolute(relativePath) || relativePath.includes('..')) throw new Error('development corpus shard path must remain relative to manifest')
    const expectedSha = requireString(entry.sha256, `development corpus shard manifest[${index}].sha256`)
    const expectedShardCount = requireInteger(entry.taskCount, `development corpus shard manifest[${index}].taskCount`)
    const filename = path.join(base, relativePath)
    const shardRead = await readJsonText(filename, `development corpus shard ${relativePath}`)
    if (sha256(shardRead.text) !== expectedSha) throw new Error(`development corpus shard hash mismatch: ${relativePath}`)
    const shard = requireRecord(shardRead.value, `development corpus shard ${relativePath}`)
    if (shard.schema !== SHARD_SCHEMA || shard.status !== 'DEVELOPMENT_ONLY') {
      throw new Error(`development corpus shard identity is invalid: ${relativePath}`)
    }
    if (!Array.isArray(shard.tasks) || shard.tasks.length !== expectedShardCount || shard.taskCount !== expectedShardCount) {
      throw new Error(`development corpus shard task count mismatch: ${relativePath}`)
    }
    shard.tasks.forEach((task, taskIndex) => tasks.push(validateTask(task, `${relativePath}.tasks[${taskIndex}]`)))
  }

  if (tasks.length !== expectedTaskCount) throw new Error('development corpus total task count mismatch')
  const ids = new Set(tasks.map(task => task.id))
  if (ids.size !== tasks.length) throw new Error('development corpus contains duplicate task ids')
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    status: 'DEVELOPMENT_ONLY',
    futureHoldoutAllowed: false,
    source: manifest.source,
    tasks: Object.freeze(tasks),
  })
}

function selectionStrata(tasks) {
  const byDomain = new Map()
  for (const value of tasks) {
    const task = validateTask(value, 'selection task')
    const kind = selectionKind(task, `selection task ${task.id}`)
    const domain = byDomain.get(task.domain) ?? new Map(SELECTION_KINDS.map(candidate => [candidate, []]))
    domain.get(kind).push(task)
    byDomain.set(task.domain, domain)
  }

  const domains = [...byDomain.keys()].toSorted((left, right) => left.localeCompare(right, 'en-US'))
  for (const domainName of domains) {
    const domain = byDomain.get(domainName)
    for (const kind of SELECTION_KINDS) {
      const stratum = domain.get(kind)
      if (stratum.length === 0) throw new Error(`development corpus domain ${domainName} requires ${kind} tasks`)
      domain.set(kind, stratum.toSorted((left, right) => left.id.localeCompare(right.id, 'en-US')))
    }
  }
  return Object.freeze({ byDomain, domains: Object.freeze(domains) })
}

/**
 * Deterministic staged selection stratified by domain × oracle kind.
 *
 * Round 0 keeps an eight-task canary broad across domains while alternating
 * discovery/existence-check kinds. Round 1 adds the opposite kind for every
 * domain so the first 16 selected tasks cover every domain × kind stratum.
 * Additional capacity is consumed by depth with discovery tasks first, then
 * absence checks. For the 20-task dev budget this yields 12 discovery-positive
 * and 8 negative tasks without inferring semantics from task ids.
 */
export function selectEvaluationTasks(tasks, taskCount) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('task selection requires a non-empty corpus')
  if (!Number.isSafeInteger(taskCount) || taskCount < 1 || taskCount > tasks.length) {
    throw new Error('task selection count must be within the corpus size')
  }

  const { byDomain, domains } = selectionStrata(tasks)
  const selected = []

  for (let domainIndex = 0; domainIndex < domains.length && selected.length < taskCount; domainIndex += 1) {
    const domain = byDomain.get(domains[domainIndex])
    const kind = SELECTION_KINDS[domainIndex % SELECTION_KINDS.length]
    selected.push(domain.get(kind)[0])
  }

  for (let domainIndex = 0; domainIndex < domains.length && selected.length < taskCount; domainIndex += 1) {
    const domain = byDomain.get(domains[domainIndex])
    const kind = SELECTION_KINDS[(domainIndex + 1) % SELECTION_KINDS.length]
    selected.push(domain.get(kind)[0])
  }

  let depth = 1
  while (selected.length < taskCount) {
    let added = false
    for (const kind of SELECTION_KINDS) {
      for (const domainName of domains) {
        const task = byDomain.get(domainName).get(kind)[depth]
        if (task !== undefined) {
          selected.push(task)
          added = true
          if (selected.length === taskCount) break
        }
      }
      if (selected.length === taskCount) break
    }
    if (!added) break
    depth += 1
  }

  if (selected.length !== taskCount) throw new Error('development corpus could not satisfy deterministic stratified selection')
  if (new Set(selected.map(task => task.id)).size !== selected.length) throw new Error('stratified selection produced duplicate task ids')
  return Object.freeze(selected)
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--tasks') {
    throw new Error('development corpus selector requires --manifest <path> --tasks <count>')
  }
  const corpus = await loadDevelopmentCorpus(args[1])
  const selected = selectEvaluationTasks(corpus.tasks, Number(args[3]))
  process.stdout.write(`${JSON.stringify({ status: corpus.status, taskCount: selected.length, tasks: selected }, null, 2)}\n`)
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
