#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileEvaluationRuntime } from './prepare-m2-h1-preregistration.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const PUBLIC_PREREGISTRATION = 'docs/evaluation/m2/h1-preregistration-receipt-v2.json'
const PUBLIC_PROVIDER_RECEIPT = 'docs/evaluation/m2/h1-provider-identity-receipt-v1.json'
const CHILD_ADAPTER = 'scripts/m2-opencode-go-p0-child.mjs'
const execFileAsync = promisify(execFile)

const EXPECTED = Object.freeze({
  preregistrationReceiptSha256: 'dc12ccf907f507b5f6da08c790a1a84563160e984879724e5c18283e0404219b',
  definitionSha256: 'c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717',
  datasetCommitmentSha256: 'f81f97cfe3b7ccf615f6246ed6b355f730009c6fb66dc8cd170a90c9c9753095',
  providerIdentityReceiptSha256: 'ba594a928f7fde32b4ca2724dc57d1fef0a267f061ecdcfc5f87e909be5cb5b8',
  provider: 'opencode-go',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  requestModel: 'deepseek-v4-flash',
  responseModel: 'deepseek-v4-flash',
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  thinking: 'enabled',
  reasoningEffort: 'high',
  scheduleCount: 864,
  taskCount: 96,
  concurrency: 1,
})

function requireArgumentValue(args, index, option) {
  const value = args[index + 1]
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
    throw new Error(`${option} requires a non-empty value`)
  }
  return value
}

function parseBudget(value) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error('--max-committed-attempts must be an integer in 1..48')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 48) {
    throw new Error('--max-committed-attempts must be an integer in 1..48')
  }
  return parsed
}

export function parseArguments(args) {
  let dataset
  let runStore
  let sourceBoundPreregistration
  let execute = false
  let maxCommittedAttempts

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dataset') {
      if (dataset !== undefined) throw new Error('Duplicate --dataset option')
      dataset = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--run-store') {
      if (runStore !== undefined) throw new Error('Duplicate --run-store option')
      runStore = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--source-bound-preregistration') {
      if (sourceBoundPreregistration !== undefined) {
        throw new Error('Duplicate --source-bound-preregistration option')
      }
      sourceBoundPreregistration = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--execute') {
      if (execute) throw new Error('Duplicate --execute option')
      execute = true
      continue
    }
    if (argument === '--max-committed-attempts') {
      if (maxCommittedAttempts !== undefined) throw new Error('Duplicate --max-committed-attempts option')
      maxCommittedAttempts = parseBudget(requireArgumentValue(args, index, argument))
      index += 1
      continue
    }
    throw new Error(`Unknown H1 execution command argument: ${String(argument)}`)
  }

  if (dataset === undefined || runStore === undefined || sourceBoundPreregistration === undefined) {
    throw new Error('H1 execution command requires --dataset, --run-store and --source-bound-preregistration')
  }
  if (execute && maxCommittedAttempts === undefined) {
    throw new Error('--execute requires --max-committed-attempts in 1..48')
  }
  if (!execute && maxCommittedAttempts !== undefined) {
    throw new Error('--max-committed-attempts is meaningful only with --execute')
  }

  return Object.freeze({ dataset, runStore, sourceBoundPreregistration, execute, maxCommittedAttempts })
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function requireRegularJsonFile(filename, label) {
  const resolved = path.resolve(filename)
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.json') {
    throw new Error(`${label} must use a .json extension`)
  }
  let metadata
  try {
    metadata = await stat(resolved)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${label} does not exist: ${resolved}`)
    }
    throw error
  }
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file`)
  return resolved
}

async function validateExecutionPaths(datasetValue, runStoreValue, sourcePublicationValue, root) {
  const dataset = path.resolve(datasetValue)
  const runStore = path.resolve(runStoreValue)
  if (isInside(root, dataset)) throw new Error('H1 private dataset must remain outside the repository')
  if (isInside(root, runStore)) throw new Error('H1 durable run store must remain outside the repository')
  if (dataset === runStore || isInside(dataset, runStore)) throw new Error('H1 run store must not be nested inside the dataset path')
  return Object.freeze({
    dataset: await requireRegularJsonFile(dataset, 'H1 private dataset'),
    runStore,
    sourceBoundPreregistration: await requireRegularJsonFile(
      sourcePublicationValue,
      'H1 source-bound preregistration',
    ),
  })
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
    throw new Error(`${label} must contain valid JSON`, { cause: error })
  }
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function sameBinding(left, right) {
  return left.definitionSha256 === right.definitionSha256
    && left.datasetCommitmentSha256 === right.datasetCommitmentSha256
    && left.providerIdentityReceiptSha256 === right.providerIdentityReceiptSha256
    && left.expectedResponseModel === right.expectedResponseModel
}

export function assertPublishedH1ExecutionBinding(publishedValue, frozenValue) {
  const published = record(publishedValue, 'published H1 preregistration')
  const frozen = record(frozenValue, 'frozen H1 execution')
  const hiddenDataset = record(published.hiddenDataset, 'published H1 hidden dataset')
  const provider = record(published.provider, 'published H1 provider')
  const execution = record(published.execution, 'published H1 execution')
  const publishedBinding = record(execution.ledgerBinding, 'published H1 ledger binding')
  const frozenBinding = record(frozen.ledgerBinding, 'frozen H1 ledger binding')
  const resourcePolicy = record(frozen.resourcePolicy, 'frozen H1 resource policy')

  if (published.status !== 'PREREGISTERED' || published.receiptSha256 !== EXPECTED.preregistrationReceiptSha256) {
    throw new Error('H1 published preregistration receipt identity drifted')
  }
  if (frozen.definitionSha256 !== EXPECTED.definitionSha256 || execution.definitionSha256 !== EXPECTED.definitionSha256) {
    throw new Error('H1 published/frozen definition binding drifted')
  }
  if (
    hiddenDataset.sha256 !== EXPECTED.datasetCommitmentSha256
    || hiddenDataset.taskCount !== EXPECTED.taskCount
    || frozenBinding.datasetCommitmentSha256 !== EXPECTED.datasetCommitmentSha256
  ) {
    throw new Error('H1 published/frozen dataset binding drifted')
  }
  if (
    provider.provider !== EXPECTED.provider
    || provider.requestModel !== EXPECTED.requestModel
    || provider.responseModel !== EXPECTED.responseModel
    || provider.identityMode !== 'managed-gateway'
    || provider.identityReceiptSha256 !== EXPECTED.providerIdentityReceiptSha256
    || frozenBinding.providerIdentityReceiptSha256 !== EXPECTED.providerIdentityReceiptSha256
    || frozenBinding.expectedResponseModel !== EXPECTED.responseModel
  ) {
    throw new Error('H1 published/frozen provider binding drifted')
  }
  if (
    execution.scheduleCount !== EXPECTED.scheduleCount
    || !Array.isArray(frozen.schedule)
    || frozen.schedule.length !== EXPECTED.scheduleCount
  ) {
    throw new Error('H1 published/frozen schedule binding drifted')
  }
  if (
    execution.concurrency !== EXPECTED.concurrency
    || resourcePolicy.concurrency !== EXPECTED.concurrency
    || !Array.isArray(frozen.modelTasks)
    || frozen.modelTasks.length !== EXPECTED.taskCount
  ) {
    throw new Error('H1 published/frozen execution cardinality drifted')
  }
  if (!sameBinding(publishedBinding, frozenBinding)) throw new Error('H1 published ledger binding drifted from frozen execution')
}

async function importExecutionRuntime(runtimeRoot) {
  const modules = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, 'src', 'acquisition', 'node-sha256.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-finalization-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-execution-definition-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-preregistration-receipt-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-execution-source-binding-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-source-bound-preregistration-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-source-bound-attempt-factory-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-run-store-v2.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-durable-schedule-runner-v2.js')).href),
  ])
  const [
    sha,
    finalization,
    definition,
    preregistration,
    sourceBinding,
    sourcePublication,
    sourceAttemptFactory,
    runStore,
    scheduleRunner,
  ] = modules
  return Object.freeze({
    createNodeSha256Port: sha.createNodeSha256Port,
    finalizeH1CommitmentV2: finalization.finalizeH1CommitmentV2,
    createFrozenH1ExecutionDefinitionV2: definition.createFrozenH1ExecutionDefinitionV2,
    validateH1PreregistrationReceiptV2: preregistration.validateH1PreregistrationReceiptV2,
    readH1ExecutionSourceIdentityV2: sourceBinding.readH1ExecutionSourceIdentityV2,
    validateH1SourceBoundPreregistrationV2: sourcePublication.validateH1SourceBoundPreregistrationV2,
    createSourceBoundH1AttemptInputFactoryV2: sourceAttemptFactory.createSourceBoundH1AttemptInputFactoryV2,
    createH1RunStoreV2: runStore.createH1RunStoreV2,
    openH1RunStoreV2: runStore.openH1RunStoreV2,
    closeH1RunStoreV2: runStore.closeH1RunStoreV2,
    runH1DurableScheduleV2: scheduleRunner.runH1DurableScheduleV2,
  })
}

function requireRuntime(runtime) {
  for (const name of [
    'createNodeSha256Port',
    'finalizeH1CommitmentV2',
    'createFrozenH1ExecutionDefinitionV2',
    'validateH1PreregistrationReceiptV2',
    'readH1ExecutionSourceIdentityV2',
    'validateH1SourceBoundPreregistrationV2',
    'createSourceBoundH1AttemptInputFactoryV2',
    'createH1RunStoreV2',
    'openH1RunStoreV2',
    'closeH1RunStoreV2',
    'runH1DurableScheduleV2',
  ]) {
    if (typeof runtime[name] !== 'function') throw new Error(`Compiled H1 execution runtime is incomplete: ${name}`)
  }
  return runtime
}

function requireCredential(environment) {
  const value = environment.OPENCODE_API_KEY
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('H1 execution requires OPENCODE_API_KEY')
  return value
}

function childEnvironment(environment, apiKey) {
  const result = {}
  if (typeof environment.PATH === 'string') result.PATH = environment.PATH
  result.OPENCODE_API_KEY = apiKey
  result.OPENCODE_GO_BASE_URL = EXPECTED.baseUrl
  result.OPENCODE_GO_REQUEST_MODEL = EXPECTED.requestModel
  result.OPENCODE_GO_EXPECTED_RESPONSE_MODEL = EXPECTED.responseModel
  result.OPENCODE_GO_THINKING = EXPECTED.thinking
  result.OPENCODE_GO_REASONING_EFFORT = EXPECTED.reasoningEffort
  result.OPENCODE_GO_MAX_OUTPUT_TOKENS = '12000'
  return result
}

async function resolveCheckedOutSourceCommit(root) {
  let stdout
  try {
    ;({ stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    }))
  } catch (error) {
    throw new Error('Unable to resolve checked-out H1 Git source commit', { cause: error })
  }
  const commit = stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error('Checked-out H1 Git source commit is not an exact lowercase 40-hex commit id')
  }
  return commit
}

function assertCheckedOutSourceIdentity(identity, checkedOutSourceCommit) {
  if (identity.sourceCommitSha !== checkedOutSourceCommit) {
    throw new Error('Checked-out H1 source commit drifted from source-bound preregistration')
  }
  if (identity.entrypoint !== CHILD_ADAPTER) {
    throw new Error('H1 source-bound child entrypoint drifted from the canonical OpenCode Go adapter')
  }
  if (identity.runtime !== 'node' || identity.runtimeVersion !== process.versions.node) {
    throw new Error('H1 Node runtime drifted from source-bound preregistration')
  }
  if (identity.protocol !== 'closed-ndjson-v1') {
    throw new Error('H1 execution protocol drifted from source-bound preregistration')
  }
}

async function ledgerExists(runStore) {
  try {
    await access(path.join(runStore, 'ledger.json'))
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

export async function prepareH1Execution(options) {
  const root = path.resolve(options.root)
  const paths = await validateExecutionPaths(
    options.dataset,
    options.runStore,
    options.sourceBoundPreregistration,
    root,
  )
  const runtime = requireRuntime(options.runtime)
  const sha256 = runtime.createNodeSha256Port()
  const [sourceCommitment, hiddenDataset, providerReceipt, workspace, publishedReceipt, sourcePublication] = await Promise.all([
    readJson(path.join(root, 'docs', 'evaluation', 'm2', 'agent-holdout-h1-v2.commitment.json'), 'pristine H1 commitment'),
    readJson(paths.dataset, 'private H1 dataset'),
    readJson(path.join(root, PUBLIC_PROVIDER_RECEIPT), 'published H1 provider receipt'),
    readJson(path.join(root, 'tests', 'evaluation', 'fixtures', 'm2', 'rc2-web-v1', 'ordinary-workspace.json'), 'frozen ordinary workspace'),
    readJson(path.join(root, PUBLIC_PREREGISTRATION), 'published H1 preregistration receipt'),
    readJson(paths.sourceBoundPreregistration, 'H1 source-bound preregistration'),
  ])

  const finalization = await runtime.finalizeH1CommitmentV2(sourceCommitment, hiddenDataset, providerReceipt, sha256)
  const frozen = await runtime.createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  const [validatedPublication, validatedSourcePublication] = await Promise.all([
    runtime.validateH1PreregistrationReceiptV2(publishedReceipt, sha256),
    runtime.validateH1SourceBoundPreregistrationV2(sourcePublication, sha256),
  ])
  assertPublishedH1ExecutionBinding(validatedPublication, frozen)
  assertPublishedH1ExecutionBinding(validatedSourcePublication.receipt, frozen)
  if (validatedSourcePublication.receipt.receiptSha256 !== validatedPublication.receiptSha256) {
    throw new Error('H1 source-bound preregistration embeds a different scientific preregistration receipt')
  }

  const sourceIdentity = await runtime.readH1ExecutionSourceIdentityV2(
    validatedSourcePublication.sourceBinding,
    frozen,
    sha256,
  )
  const checkedOutSourceCommit = await resolveCheckedOutSourceCommit(root)
  assertCheckedOutSourceIdentity(sourceIdentity, checkedOutSourceCommit)

  return Object.freeze({
    paths,
    sha256,
    workspace,
    frozen,
    validatedPublication,
    validatedSourcePublication,
    sourceIdentity,
    checkedOutSourceCommit,
  })
}

export async function executeH1Operator(options) {
  const prepared = await prepareH1Execution(options)
  const common = {
    definitionSha256: prepared.frozen.definitionSha256,
    datasetCommitmentSha256: prepared.frozen.ledgerBinding.datasetCommitmentSha256,
    providerIdentityReceiptSha256: prepared.frozen.ledgerBinding.providerIdentityReceiptSha256,
    sourceBindingSha256: prepared.validatedSourcePublication.sourceBinding.sourceBindingSha256,
    sourceCommitSha: prepared.checkedOutSourceCommit,
    scheduleCount: prepared.frozen.schedule.length,
    runStore: prepared.paths.runStore,
  }
  if (!options.execute) {
    return Object.freeze({
      status: 'PREFLIGHT_READY',
      ...common,
    })
  }

  const apiKey = requireCredential(options.environment)
  const child = path.join(path.resolve(options.root), CHILD_ADAPTER)
  const factory = await options.runtime.createSourceBoundH1AttemptInputFactoryV2(
    prepared.frozen,
    prepared.validatedSourcePublication.sourceBinding,
    prepared.workspace,
    {
      command: process.execPath,
      args: [child],
      cwd: path.resolve(options.root),
      environment: childEnvironment(options.environment, apiKey),
    },
    prepared.checkedOutSourceCommit,
    prepared.sha256,
  )

  const taskIds = prepared.frozen.modelTasks.map(task => task.id)
  const open = await (await ledgerExists(prepared.paths.runStore)
    ? options.runtime.openH1RunStoreV2(
        prepared.paths.runStore,
        prepared.frozen.ledgerBinding,
        prepared.frozen.schedule,
        taskIds,
        prepared.frozen.retryPolicy,
        prepared.sha256,
      )
    : options.runtime.createH1RunStoreV2(
        prepared.paths.runStore,
        prepared.frozen.ledgerBinding,
        prepared.frozen.schedule,
        taskIds,
        prepared.frozen.retryPolicy,
        prepared.sha256,
      ))

  try {
    const result = await options.runtime.runH1DurableScheduleV2({
      store: open.store,
      binding: prepared.frozen.ledgerBinding,
      sha256: prepared.sha256,
      buildAttemptInput: resume => factory.buildAttemptInput(resume),
      maxCommittedAttempts: options.maxCommittedAttempts,
    })
    return Object.freeze({
      status: result.status,
      committedAttempts: result.committedAttempts,
      ...common,
      next: result.status === 'PAUSED' ? result.state.resume : undefined,
    })
  } finally {
    await options.runtime.closeH1RunStoreV2(open.store)
  }
}

function safeSummary(result) {
  const fields = [
    'M2.3 H1 OpenCode Go operator',
    `status=${result.status}`,
    `definitionSha256=${result.definitionSha256}`,
    `datasetCommitmentSha256=${result.datasetCommitmentSha256}`,
    `providerIdentityReceiptSha256=${result.providerIdentityReceiptSha256}`,
    `sourceBindingSha256=${result.sourceBindingSha256}`,
    `sourceCommitSha=${result.sourceCommitSha}`,
    `scheduleCount=${result.scheduleCount}`,
    `runStore=${result.runStore}`,
  ]
  if (typeof result.committedAttempts === 'number') fields.push(`committedAttempts=${result.committedAttempts}`)
  if (result.next !== undefined) fields.push(`next=${result.next.scheduleIndex}:${result.next.taskId}:${result.next.arm}:${result.next.trial}:${result.next.attempt}`)
  return fields.join(' ')
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const parsed = parseArguments(args)
  if (parsed.execute) requireCredential(environment)
  const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
  try {
    const runtime = await importExecutionRuntime(runtimeRoot)
    const result = await executeH1Operator({
      root: REPOSITORY_ROOT,
      ...parsed,
      environment,
      runtime,
    })
    console.log(safeSummary(result))
    return result
  } finally {
    const { rm } = await import('node:fs/promises')
    await rm(runtimeRoot, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`H1 OpenCode Go execution failed: ${message}`)
    process.exitCode = 1
  })
}
