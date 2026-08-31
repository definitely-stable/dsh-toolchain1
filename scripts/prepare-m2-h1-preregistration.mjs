#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const RUNTIME_MAX_BUFFER = 4 * 1024 * 1024

function requireArgumentValue(args, index, option) {
  const value = args[index + 1]
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
    throw new Error(`H1 preregistration command requires a non-empty value after ${option}`)
  }
  return value
}

export function parseArguments(args) {
  let dataset
  let providerReceipt
  let output

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--dataset') {
      if (dataset !== undefined) throw new Error('H1 preregistration command accepts exactly one --dataset path')
      dataset = requireArgumentValue(args, index, '--dataset')
      index += 1
      continue
    }
    if (argument === '--provider-receipt') {
      if (providerReceipt !== undefined) {
        throw new Error('H1 preregistration command accepts exactly one --provider-receipt path')
      }
      providerReceipt = requireArgumentValue(args, index, '--provider-receipt')
      index += 1
      continue
    }
    if (argument === '--output') {
      if (output !== undefined) throw new Error('H1 preregistration command accepts exactly one --output path')
      output = requireArgumentValue(args, index, '--output')
      index += 1
      continue
    }
    throw new Error(`Unknown H1 preregistration command argument: ${String(argument)}; execution/run flags are forbidden`)
  }

  if (dataset === undefined || providerReceipt === undefined || output === undefined) {
    throw new Error('H1 preregistration command requires --dataset, --provider-receipt and --output')
  }
  return Object.freeze({ dataset, providerReceipt, output })
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function requireRegularJsonFile(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} path must be non-empty`)
  }
  const resolved = path.resolve(value)
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.json') {
    throw new Error(`${label} path must use a .json extension`)
  }
  let metadata
  try {
    metadata = await stat(resolved)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`${label} file does not exist: ${resolved}`)
    }
    throw error
  }
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file: ${resolved}`)
  return resolved
}

export async function validatePrivateDatasetPath(datasetPath, options) {
  if (typeof datasetPath !== 'string' || datasetPath.trim().length === 0) {
    throw new Error('H1 private dataset path must be non-empty')
  }
  const root = path.resolve(options.root)
  const resolved = path.resolve(datasetPath)
  if (isInside(root, resolved)) {
    throw new Error('H1 private dataset must remain outside the repository until terminal H1 disclosure')
  }
  return requireRegularJsonFile(resolved, 'H1 private dataset')
}

export async function validateProviderReceiptPath(providerReceiptPath) {
  return requireRegularJsonFile(providerReceiptPath, 'H1 provider receipt')
}

async function existingPathType(resolved) {
  try {
    const metadata = await stat(resolved)
    return metadata.isFile() ? 'file' : 'other'
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

export async function validateOutputTarget(output, options) {
  if (typeof output !== 'string' || output.trim().length === 0) {
    throw new Error('H1 public preregistration output path must be non-empty')
  }
  const root = path.resolve(options.root)
  const resolved = path.resolve(output)
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.json') {
    throw new Error('H1 public preregistration output path must use a .json extension')
  }
  if (isInside(path.join(root, 'src'), resolved) || isInside(path.join(root, 'lib'), resolved)) {
    throw new Error('H1 public preregistration evidence must not be written inside distributable src/lib boundaries')
  }
  const existing = await existingPathType(resolved)
  if (existing !== undefined) {
    throw new Error(`H1 public preregistration output already exists; overwrite is forbidden: ${resolved}`)
  }
  return resolved
}

async function readJsonFile(filename, label) {
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

function compilerEnvironment(environment) {
  const allow = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME']
  return Object.fromEntries(allow.flatMap(name => {
    const value = environment[name]
    return typeof value === 'string' ? [[name, value]] : []
  }))
}

export async function compileEvaluationRuntime(root) {
  const tempParent = path.join(root, '.tmp')
  await mkdir(tempParent, { recursive: true })
  const runtimeRoot = await mkdtemp(path.join(tempParent, 'm2-h1-preregister-runtime-'))
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  try {
    await execFile(process.execPath, [
      tsc,
      '-p', path.join(root, 'tsconfig.test.json'),
      '--noEmit', 'false',
      '--outDir', runtimeRoot,
      '--rootDir', root,
      '--declaration', 'false',
      '--sourceMap', 'false',
      '--inlineSourceMap', 'false',
    ], {
      cwd: root,
      env: compilerEnvironment(process.env),
      maxBuffer: RUNTIME_MAX_BUFFER,
    })

    await Promise.all([
      cp(path.join(root, 'docs', 'evaluation', 'm2'), path.join(runtimeRoot, 'docs', 'evaluation', 'm2'), { recursive: true }),
      cp(path.join(root, 'tests', 'evaluation', 'fixtures', 'm2'), path.join(runtimeRoot, 'tests', 'evaluation', 'fixtures', 'm2'), { recursive: true }),
    ])
    return runtimeRoot
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true })
    throw error
  }
}

export async function importRuntime(runtimeRoot) {
  const shaUrl = pathToFileURL(path.join(runtimeRoot, 'src', 'acquisition', 'node-sha256.js')).href
  const integrityUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-agent-eval-integrity.js')).href
  const finalizationUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-finalization-v2.js')).href
  const definitionUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-execution-definition-v2.js')).href
  const receiptUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-h1-preregistration-receipt-v2.js')).href

  const [shaModule, integrity, finalization, definition, receipt] = await Promise.all([
    import(shaUrl),
    import(integrityUrl),
    import(finalizationUrl),
    import(definitionUrl),
    import(receiptUrl),
  ])
  return Object.freeze({
    createNodeSha256Port: shaModule.createNodeSha256Port,
    canonicalizeEvaluationJson: integrity.canonicalizeEvaluationJson,
    finalizeH1CommitmentV2: finalization.finalizeH1CommitmentV2,
    createFrozenH1ExecutionDefinitionV2: definition.createFrozenH1ExecutionDefinitionV2,
    createH1PreregistrationReceiptV2: receipt.createH1PreregistrationReceiptV2,
    validateH1PreregistrationReceiptV2: receipt.validateH1PreregistrationReceiptV2,
  })
}

function requireRuntime(runtime) {
  const required = [
    'createNodeSha256Port',
    'canonicalizeEvaluationJson',
    'finalizeH1CommitmentV2',
    'createFrozenH1ExecutionDefinitionV2',
    'createH1PreregistrationReceiptV2',
    'validateH1PreregistrationReceiptV2',
  ]
  for (const name of required) {
    if (typeof runtime?.[name] !== 'function') {
      throw new Error(`Compiled H1 preregistration runtime is incomplete: ${name}`)
    }
  }
  return runtime
}

async function writeExclusiveReceipt(output, content) {
  const parent = path.dirname(output)
  await mkdir(parent, { recursive: true })
  const temporary = path.join(parent, `.${path.basename(output)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    try {
      await link(temporary, output)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        throw new Error(`H1 public preregistration output already exists; overwrite is forbidden: ${output}`)
      }
      throw error
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function prepareH1Preregistration(options) {
  const root = path.resolve(options.root)
  const [dataset, providerReceipt, output] = await Promise.all([
    validatePrivateDatasetPath(options.dataset, { root }),
    validateProviderReceiptPath(options.providerReceipt),
    validateOutputTarget(options.output, { root }),
  ])
  const runtime = requireRuntime(options.runtime)

  const [sourceCommitment, hiddenDataset, providerIdentityReceipt, workspace] = await Promise.all([
    readJsonFile(
      path.join(root, 'docs', 'evaluation', 'm2', 'agent-holdout-h1-v2.commitment.json'),
      'pristine H1 BLOCKED commitment',
    ),
    readJsonFile(dataset, 'private H1 dataset'),
    readJsonFile(providerReceipt, 'H1 provider identity receipt'),
    readJsonFile(
      path.join(root, 'tests', 'evaluation', 'fixtures', 'm2', 'rc2-web-v1', 'ordinary-workspace.json'),
      'frozen ordinary workspace',
    ),
  ])

  const sha256 = runtime.createNodeSha256Port()
  const finalization = await runtime.finalizeH1CommitmentV2(
    sourceCommitment,
    hiddenDataset,
    providerIdentityReceipt,
    sha256,
  )
  const frozen = await runtime.createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  const receipt = await runtime.createH1PreregistrationReceiptV2(finalization, frozen, sha256)
  const validated = await runtime.validateH1PreregistrationReceiptV2(receipt, sha256)

  if (
    validated.status !== 'PREREGISTERED'
    || validated.hiddenDataset?.taskCount !== 96
    || validated.execution?.scheduleCount !== 864
    || validated.execution?.concurrency !== 1
    || frozen.schedule?.length !== 864
  ) {
    throw new Error('H1 preregistration output failed exact 96-task / 864-entry / concurrency-1 publication invariants')
  }

  const content = `${runtime.canonicalizeEvaluationJson(validated)}\n`
  await writeExclusiveReceipt(output, content)

  return Object.freeze({
    receiptSha256: validated.receiptSha256,
    definitionSha256: frozen.definitionSha256,
    scheduleCount: frozen.schedule.length,
    output,
  })
}

function safeSummary(summary) {
  return [
    'M2.3 H1 preregistration prepared',
    'status=PREREGISTERED',
    `definitionSha256=${summary.definitionSha256}`,
    `receiptSha256=${summary.receiptSha256}`,
    `scheduleCount=${summary.scheduleCount}`,
    `output=${summary.output}`,
    'runAllowedByCommand=false',
  ].join(' ')
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args)
  const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
  try {
    const runtime = await importRuntime(runtimeRoot)
    const summary = await prepareH1Preregistration({
      root: REPOSITORY_ROOT,
      ...parsed,
      runtime,
    })
    console.log(safeSummary(summary))
    return summary
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`H1 preregistration preparation failed: ${message}`)
    process.exitCode = 1
  })
}
