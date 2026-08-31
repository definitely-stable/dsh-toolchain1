#!/usr/bin/env node

import { readFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileEvaluationRuntime } from './prepare-m2-h1-preregistration.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const SOURCE_COMMITMENT = 'docs/evaluation/m2/agent-holdout-h1-v2.commitment.json'
const PROVIDER_RECEIPT = 'docs/evaluation/m2/h1-provider-identity-receipt-v1.json'
const WORKSPACE = 'tests/evaluation/fixtures/m2/rc2-web-v1/ordinary-workspace.json'

function requireArgumentValue(args, index, option) {
  const value = args[index + 1]
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
    throw new Error(`${option} requires a non-empty value`)
  }
  return value
}

export function parseArguments(args) {
  let dataset
  let runStore
  let outputDir

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dataset') {
      if (dataset !== undefined) throw new Error('H1 terminal finalizer accepts exactly one --dataset path')
      dataset = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--run-store') {
      if (runStore !== undefined) throw new Error('H1 terminal finalizer accepts exactly one --run-store path')
      runStore = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--output-dir') {
      if (outputDir !== undefined) throw new Error('H1 terminal finalizer accepts exactly one --output-dir path')
      outputDir = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    throw new Error(`Unknown or forbidden H1 terminal finalizer argument: ${String(argument)}`)
  }

  if (dataset === undefined || runStore === undefined || outputDir === undefined) {
    throw new Error('H1 terminal finalizer requires --dataset, --run-store and --output-dir')
  }
  return Object.freeze({ dataset, runStore, outputDir })
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function requireFile(value, label) {
  const resolved = path.resolve(value)
  let metadata
  try {
    metadata = await stat(resolved)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${resolved}`)
    }
    throw error
  }
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file: ${resolved}`)
  return resolved
}

async function requireDirectory(value, label) {
  const resolved = path.resolve(value)
  let metadata
  try {
    metadata = await stat(resolved)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${resolved}`)
    }
    throw error
  }
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory: ${resolved}`)
  return resolved
}

async function validatePaths(options) {
  const root = path.resolve(options.root)
  const dataset = await requireFile(options.dataset, 'H1 terminal private dataset')
  const runStore = await requireDirectory(options.runStore, 'H1 terminal run-store')
  const outputDir = path.resolve(options.outputDir)
  if (isInside(root, dataset) || isInside(root, runStore) || isInside(root, outputDir)) {
    throw new Error('H1 terminal private inputs and result output must remain outside the repository')
  }
  if (dataset === runStore || isInside(runStore, dataset) || isInside(dataset, runStore)) {
    throw new Error('H1 terminal dataset and run-store paths must be independent')
  }
  if (outputDir === runStore || isInside(runStore, outputDir) || isInside(outputDir, runStore)) {
    throw new Error('H1 terminal output directory must not overlap the durable run-store')
  }
  return Object.freeze({ dataset, runStore, outputDir })
}

async function readJson(filename, label) {
  let text
  try {
    text = await readFile(filename, 'utf8')
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${filename}`, { cause: error })
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${filename}`, { cause: error })
  }
}

async function importTerminalRuntime(runtimeRoot) {
  const modulePath = relative => pathToFileURL(path.join(runtimeRoot, relative)).href
  const [sha, integrity, finalization, definition, truth, terminal] = await Promise.all([
    import(modulePath('src/acquisition/node-sha256.js')),
    import(modulePath('tests/evaluation/m2-agent-eval-integrity.js')),
    import(modulePath('tests/evaluation/m2-h1-finalization-v2.js')),
    import(modulePath('tests/evaluation/m2-h1-execution-definition-v2.js')),
    import(modulePath('tests/evaluation/m2-api-truth-v2.js')),
    import(modulePath('tests/evaluation/m2-h1-terminal-result-v2.js')),
  ])
  const runtime = Object.freeze({
    createNodeSha256Port: sha.createNodeSha256Port,
    canonicalizeEvaluationJson: integrity.canonicalizeEvaluationJson,
    finalizeH1CommitmentV2: finalization.finalizeH1CommitmentV2,
    createFrozenH1ExecutionDefinitionV2: definition.createFrozenH1ExecutionDefinitionV2,
    buildApiTruthUniverseV2: truth.buildApiTruthUniverseV2,
    readCompletedH1RunStoreV2: terminal.readCompletedH1RunStoreV2,
    buildH1TerminalResultV2: terminal.buildH1TerminalResultV2,
  })
  for (const [name, value] of Object.entries(runtime)) {
    if (typeof value !== 'function') throw new Error(`Compiled H1 terminal runtime is incomplete: ${name}`)
  }
  return runtime
}

async function writeExclusive(filename, content) {
  await writeFile(filename, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

function metricText(metric) {
  if (metric.estimate === null || metric.lowerBound === null || metric.upperBound === null) return 'unresolved'
  return `estimate=${metric.estimate.toFixed(6)} 95% CI=[${metric.lowerBound.toFixed(6)}, ${metric.upperBound.toFixed(6)}] threshold=${metric.threshold.toFixed(6)} pass=${String(metric.decisionPass)}`
}

function summaryMarkdown(input) {
  return [
    '# M2.3 H1 terminal adjudication',
    '',
    `Status: **${input.analysis.status}**`,
    '',
    `- Definition SHA-256: \`${input.definitionSha256}\``,
    `- Truth fingerprint: \`${input.truthFingerprint}\``,
    `- Result SHA-256: \`${input.resultSha256}\``,
    `- Analysis SHA-256: \`${input.analysisSha256}\``,
    `- Tasks: ${input.analysis.taskCount}`,
    `- Unresolved B/C decision runs: ${input.analysis.unresolvedDecisionRuns}`,
    `- Infrastructure inconclusive: ${String(input.analysis.infrastructureInconclusive)}`,
    `- Primary C-vs-B invalid API reduction: ${metricText(input.analysis.primary)}`,
    `- Task-success guardrail C-vs-B: ${metricText(input.analysis.guardrail)}`,
    '',
    'The terminal path re-adjudicates retained raw answers with frozen Truth v2/H1 rules and performs no provider/model call.',
    '',
  ].join('\n')
}

export async function finalizeH1Terminal(options) {
  const paths = await validatePaths(options)
  const runtime = options.runtime
  const sha256 = runtime.createNodeSha256Port()
  const [sourceCommitment, hiddenDataset, providerReceipt, workspace] = await Promise.all([
    readJson(path.join(options.root, SOURCE_COMMITMENT), 'H1 pristine commitment'),
    readJson(paths.dataset, 'H1 private dataset'),
    readJson(path.join(options.root, PROVIDER_RECEIPT), 'H1 provider identity receipt'),
    readJson(path.join(options.root, WORKSPACE), 'H1 frozen ordinary workspace'),
  ])

  const finalization = await runtime.finalizeH1CommitmentV2(
    sourceCommitment,
    hiddenDataset,
    providerReceipt,
    sha256,
  )
  const frozen = await runtime.createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  const truth = await runtime.buildApiTruthUniverseV2(workspace, sha256)
  const snapshot = await runtime.readCompletedH1RunStoreV2({
    rootDir: paths.runStore,
    binding: frozen.ledgerBinding,
    schedule: frozen.schedule,
    taskIds: frozen.modelTasks.map(task => task.id),
    retryPolicy: frozen.retryPolicy,
    sha256,
  })
  const executedAt = (options.now ?? (() => new Date()))().toISOString()
  const built = await runtime.buildH1TerminalResultV2({
    frozen,
    hiddenDataset,
    truth,
    snapshot,
    executedAt,
    sha256,
  })

  const canonicalResult = runtime.canonicalizeEvaluationJson(built.result)
  const resultSha256 = await sha256.sha256Utf8(canonicalResult)
  const analysisWithoutHash = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-terminal-analysis-artifact-v2',
    version: 'h1-terminal-analysis-artifact-v2',
    definitionSha256: frozen.definitionSha256,
    truthFingerprint: truth.fingerprint,
    resultSha256,
    analysis: built.analysis,
  })
  const analysisSha256 = await sha256.sha256Utf8(runtime.canonicalizeEvaluationJson(analysisWithoutHash))
  const analysisArtifact = Object.freeze({ ...analysisWithoutHash, analysisSha256 })

  await mkdir(paths.outputDir, { recursive: true, mode: 0o700 })
  const resultPath = path.join(paths.outputDir, 'h1-result-v2.json')
  const analysisPath = path.join(paths.outputDir, 'h1-analysis-v2.json')
  const summaryPath = path.join(paths.outputDir, 'h1-summary.md')
  await Promise.all([
    writeExclusive(resultPath, canonicalResult),
    writeExclusive(analysisPath, runtime.canonicalizeEvaluationJson(analysisArtifact)),
    writeExclusive(summaryPath, summaryMarkdown({
      analysis: built.analysis,
      definitionSha256: frozen.definitionSha256,
      truthFingerprint: truth.fingerprint,
      resultSha256,
      analysisSha256,
    })),
  ])

  return Object.freeze({
    status: built.analysis.status,
    definitionSha256: frozen.definitionSha256,
    truthFingerprint: truth.fingerprint,
    resultSha256,
    analysisSha256,
    outputDir: paths.outputDir,
  })
}

function safeSummary(result) {
  return [
    'M2.3 H1 terminal adjudication',
    `status=${result.status}`,
    `definitionSha256=${result.definitionSha256}`,
    `truthFingerprint=${result.truthFingerprint}`,
    `resultSha256=${result.resultSha256}`,
    `analysisSha256=${result.analysisSha256}`,
    `outputDir=${result.outputDir}`,
  ].join(' ')
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args)
  const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
  try {
    const runtime = await importTerminalRuntime(runtimeRoot)
    const result = await finalizeH1Terminal({
      root: REPOSITORY_ROOT,
      ...parsed,
      runtime,
    })
    console.log(safeSummary(result))
    return result
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`H1 terminal adjudication failed: ${message}`)
    process.exitCode = 1
  })
}
