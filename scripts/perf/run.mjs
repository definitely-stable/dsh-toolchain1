#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { measureSample } from './measure.mjs'
import { getPerfProfile, listPerfProfiles } from './suites.mjs'
import { summarizeNumbers } from './statistics.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const SUMMARY_SCHEMA = 'dsh-perf-v1'
const BASE_CONTRACT_COUNT = 184
const SEARCH_QUERIES = Object.freeze([
  'PluginService7',
  '@dsh/perf/plugin-31.PluginService31',
  'lifecycle capability plugin profile 43',
  'configuration channel profile 61',
  'PluginService97',
  'lifecycle capability plugin profile 127',
  'configuration channel profile 151',
  'PluginService173',
])

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareCodePoints(left, right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function fingerprintValue(value) {
  const serialized = JSON.stringify(canonicalize(value)) ?? 'undefined'
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}

function createSyntheticContractIndex(scale) {
  const contractCount = BASE_CONTRACT_COUNT * scale
  const evidence = []
  const contracts = []

  for (let index = 0; index < contractCount; index += 1) {
    const evidenceId = `perf-evidence-${index}`
    const profile = index % 32
    evidence.push(Object.freeze({
      id: evidenceId,
      kind: 'source',
      strength: 'observed',
      source: `synthetic/perf/plugin-${index}.ts`,
      contentHash: createHash('sha256').update(`perf-evidence:${index}`, 'utf8').digest('hex'),
    }))
    contracts.push(Object.freeze({
      id: `perf-contract-${index}`,
      kind: index % 5 === 0 ? 'package' : 'service',
      name: `PluginService${index}`,
      qualifiedName: `@dsh/perf/plugin-${index}.PluginService${index}`,
      availability: 'available',
      summary: `Lifecycle capability plugin profile ${index} configuration channel ${profile}`,
      facts: Object.freeze([
        Object.freeze({ key: 'lifecycle', value: `profile-${index}`, evidenceIds: Object.freeze([evidenceId]) }),
        Object.freeze({ key: 'configuration-channel', value: `channel-${profile}`, evidenceIds: Object.freeze([evidenceId]) }),
        Object.freeze({ key: 'declaration-export', value: `PluginService${index}`, evidenceIds: Object.freeze([evidenceId]) }),
      ]),
      evidenceIds: Object.freeze([evidenceId]),
    }))
  }

  return Object.freeze({
    targetFingerprint: `perf-target-v1-${contractCount}`,
    fingerprint: `perf-contract-index-v1-${contractCount}`,
    evidence: Object.freeze(evidence),
    contracts: Object.freeze(contracts),
  })
}

async function createDefaultCases(profile) {
  const contractModuleUrl = new URL('../../lib/model/contract.js', import.meta.url).href
  const searchIndexModuleUrl = new URL('../../lib/model/contract-search-index.js', import.meta.url).href
  const compactModuleUrl = new URL('../../lib/model/contract-inspect-compact.js', import.meta.url).href
  const contractModule = await import(contractModuleUrl)
  const searchIndexModule = await import(searchIndexModuleUrl)
  const compactModule = await import(compactModuleUrl)
  const index = createSyntheticContractIndex(profile.scale)
  const derived = searchIndexModule.createContractSearchIndex(index)

  const search = searchDerived => SEARCH_QUERIES.map(query => {
    const selection = contractModule.searchContractIndex(index, query, undefined, 5, searchDerived)
    return selection.matches.map(match => `${match.id}:${match.score}`)
  })
  const coldReference = search(undefined)
  const inspectIds = [0, 7, 31, 61, 97, 127, 151, 173]
    .map(value => `perf-contract-${Math.min(value, index.contracts.length - 1)}`)
  const controlPayload = 'dsh-perf-control:'.repeat(4096 * profile.scale)

  return Object.freeze([
    Object.freeze({
      name: 'contract-index-build',
      run: async () => {
        const built = searchIndexModule.createContractSearchIndex(index)
        return {
          documentCount: built.documentCount,
          postingCount: built.postingCount,
          retainedTokenCount: built.retainedTokenCount,
          fingerprint: built.contractIndexFingerprint,
        }
      },
    }),
    Object.freeze({
      name: 'contract-search-cold',
      run: async () => search(undefined),
    }),
    Object.freeze({
      name: 'contract-search-warm',
      run: async () => {
        const warm = search(derived)
        if (JSON.stringify(warm) !== JSON.stringify(coldReference)) {
          throw new Error('Warm Contract Search selection drifted from the cold deterministic reference')
        }
        return warm
      },
    }),
    Object.freeze({
      name: 'contract-inspect-serialize',
      run: async () => inspectIds.map((contractId, offset) => {
        const selection = contractModule.inspectContractIndex(index, contractId)
        if (selection === undefined) throw new Error(`Synthetic contract ${contractId} was not inspectable`)
        const response = {
          protocolVersion: '1',
          requestId: `perf-inspect-${offset}`,
          snapshotFingerprint: index.targetFingerprint,
          status: 'ok',
          data: {
            contractIndexFingerprint: index.fingerprint,
            contract: selection.contract,
            evidence: selection.evidence,
          },
          diagnostics: [],
        }
        const serialized = compactModule.serializeContractInspectModelResponse(response)
        return new TextEncoder().encode(serialized).byteLength
      }),
    }),
    Object.freeze({
      name: 'sha256-control',
      run: async () => createHash('sha256').update(controlPayload, 'utf8').digest('hex'),
    }),
  ])
}

function boundedEnvironment(environmentOverrides = {}) {
  const cpus = os.cpus()
  return Object.freeze({
    schema: 'dsh-perf-environment-v1',
    suiteSchema: SUMMARY_SCHEMA,
    capturedAt: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: Object.freeze({
      model: cpus[0]?.model ?? 'unknown',
      logicalCpus: cpus.length,
    }),
    totalMemoryBytes: os.totalmem(),
    gitSha: environmentOverrides.gitSha ?? process.env.GITHUB_SHA ?? null,
    gitRef: environmentOverrides.gitRef ?? process.env.GITHUB_REF ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    runnerImage: process.env.ImageOS ?? null,
  })
}

function concurrentOperation(perfCase, profile, concurrency) {
  return async () => Promise.all(
    Array.from({ length: concurrency }, () => perfCase.run({ scale: profile.scale, concurrency })),
  )
}

function assertStableFingerprint(fingerprints, key, value) {
  const fingerprint = fingerprintValue(value)
  const expected = fingerprints.get(key)
  if (expected === undefined) {
    fingerprints.set(key, fingerprint)
    return fingerprint
  }
  if (expected !== fingerprint) {
    throw new Error(`Deterministic output drift for ${key}: expected ${expected}, received ${fingerprint}`)
  }
  return fingerprint
}

function summarizeCase(caseName, samples) {
  const selected = samples.filter(sample => sample.caseName === caseName && sample.outcome === 'ok')
  if (selected.length === 0) throw new Error(`Performance case ${caseName} produced no successful measured samples`)
  const elapsed = selected.map(sample => sample.elapsedMs)
  const totalElapsedMs = elapsed.reduce((sum, value) => sum + value, 0)
  const totalOperations = selected.reduce((sum, sample) => sum + sample.concurrency, 0)
  const userMicros = selected.reduce((sum, sample) => sum + sample.cpu.userMicros, 0)
  const systemMicros = selected.reduce((sum, sample) => sum + sample.cpu.systemMicros, 0)
  return Object.freeze({
    caseName,
    outcome: 'ok',
    samples: selected.length,
    operations: totalOperations,
    latencyMs: summarizeNumbers(elapsed),
    throughputOpsPerSecond: totalElapsedMs === 0 ? null : (totalOperations * 1000) / totalElapsedMs,
    cpu: Object.freeze({ userMicros, systemMicros }),
    memory: Object.freeze({
      peakRssBytes: Math.max(...selected.map(sample => sample.memory.rssBytes)),
      peakHeapUsedBytes: Math.max(...selected.map(sample => sample.memory.heapUsedBytes)),
      peakMaxRssKiB: Math.max(...selected.map(sample => sample.memory.maxRssKiB)),
    }),
    eventLoopUtilization: summarizeNumbers(selected.map(sample => sample.eventLoop.utilization)),
  })
}

function markdownSummary(summary) {
  const lines = [
    '# DSH Toolchain performance',
    '',
    `Profile: \`${summary.profile}\` · samples: **${summary.sampleCount}** · cases: **${summary.cases.length}**`,
    '',
    '| Case | p50 ms | p95 ms | p99 ms | ops/s | peak RSS MiB |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const item of summary.cases) {
    const throughput = item.throughputOpsPerSecond === null ? 'n/a' : item.throughputOpsPerSecond.toFixed(2)
    lines.push(`| ${item.caseName} | ${item.latencyMs.p50.toFixed(3)} | ${item.latencyMs.p95.toFixed(3)} | ${item.latencyMs.p99.toFixed(3)} | ${throughput} | ${(item.memory.peakRssBytes / (1024 * 1024)).toFixed(2)} |`)
  }
  return `${lines.join('\n')}\n`
}

async function writeEvidence(outputDir, environment, samples, summary) {
  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(path.join(outputDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'samples.jsonl'), `${samples.map(sample => JSON.stringify(sample)).join('\n')}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8'),
    writeFile(path.join(outputDir, 'summary.md'), markdownSummary(summary), 'utf8'),
  ])
}

/**
 * @typedef {object} PerfCase
 * @property {string} name
 * @property {(context: { scale: number; concurrency: number }) => unknown | Promise<unknown>} run
 */

/**
 * @typedef {object} RunPerfSuiteOptions
 * @property {string} [profileName]
 * @property {string} [outputDir]
 * @property {readonly PerfCase[]} [cases]
 * @property {{ gitSha?: string; gitRef?: string }} [environmentOverrides]
 */

/** @param {RunPerfSuiteOptions} [options] */
export async function runPerfSuite({ profileName, outputDir, cases, environmentOverrides } = {}) {
  const profile = getPerfProfile(profileName ?? 'smoke')
  if (typeof outputDir !== 'string' || outputDir === '') throw new Error('Performance outputDir is required')
  const selectedCases = cases ?? await createDefaultCases(profile)
  if (!Array.isArray(selectedCases) || selectedCases.length === 0) throw new Error('Performance suite requires at least one case')

  const environment = boundedEnvironment(environmentOverrides)
  const fingerprints = new Map()
  const samples = []

  for (const perfCase of selectedCases) {
    if (typeof perfCase?.name !== 'string' || perfCase.name === '' || typeof perfCase.run !== 'function') {
      throw new Error('Each performance case requires a name and run function')
    }
    for (const concurrency of profile.concurrency) {
      const operation = concurrentOperation(perfCase, profile, concurrency)
      const fingerprintKey = `${perfCase.name}@${concurrency}`
      for (let warmup = 1; warmup <= profile.warmups; warmup += 1) {
        const value = await operation()
        assertStableFingerprint(fingerprints, fingerprintKey, value)
      }
      for (let iteration = 1; iteration <= profile.iterations; iteration += 1) {
        const measured = await measureSample({
          caseName: perfCase.name,
          phase: 'measure',
          iteration,
          concurrency,
          operation,
        })
        const outputFingerprint = assertStableFingerprint(fingerprints, fingerprintKey, measured.value)
        samples.push(Object.freeze({ ...measured.sample, outputFingerprint }))
      }
    }
  }

  const summary = Object.freeze({
    schema: SUMMARY_SCHEMA,
    profile: profile.name,
    scale: profile.scale,
    warmups: profile.warmups,
    iterations: profile.iterations,
    concurrency: profile.concurrency,
    sampleCount: samples.length,
    cases: Object.freeze(selectedCases.map(perfCase => summarizeCase(perfCase.name, samples))),
  })

  await writeEvidence(outputDir, environment, samples, summary)
  process.stdout.write(`DSH_PERF_SUMMARY ${JSON.stringify({ schema: summary.schema, profile: summary.profile, sampleCount: summary.sampleCount, cases: summary.cases })}\n`)
  return Object.freeze({ environment, samples: Object.freeze([...samples]), summary })
}

function parseArguments(args) {
  let profileName = 'smoke'
  let outputDir = '.artifacts/perf'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--profile') {
      profileName = args[index + 1]
      index += 1
      continue
    }
    if (argument === '--output-dir') {
      outputDir = args[index + 1]
      index += 1
      continue
    }
    if (argument === '--help') {
      process.stdout.write(`Usage: node scripts/perf/run.mjs --profile <${listPerfProfiles().join('|')}> --output-dir <directory>\n`)
      return null
    }
    throw new Error(`Unknown performance argument: ${String(argument)}`)
  }
  return { profileName, outputDir }
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args)
  if (parsed === null) return null
  return runPerfSuite(parsed)
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  try {
    await main()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`DSH performance validation failed: ${message}`)
    process.exitCode = 1
  }
}
