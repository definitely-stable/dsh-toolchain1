#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
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
const P0_MAX_OUTPUT_TOKENS = '6000'
const RUNTIME_MAX_BUFFER = 4 * 1024 * 1024

function requireNonEmpty(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required P0 provider configuration: ${name}`)
  }
  return value
}

function normalizedBaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('DEEPSEEK_BASE_URL must be an absolute URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('DEEPSEEK_BASE_URL must use http or https')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('DEEPSEEK_BASE_URL must not contain credentials, query or fragment')
  }
  const pathname = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${pathname}`
}

export function parseArguments(args) {
  let output
  let overwriteInconclusive = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--output') {
      if (output !== undefined) throw new Error('P0 command accepts exactly one --output path')
      const value = args[index + 1]
      if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
        throw new Error('P0 command requires a non-empty value after --output')
      }
      output = value
      index += 1
      continue
    }
    if (argument === '--overwrite-inconclusive') {
      if (overwriteInconclusive) throw new Error('Duplicate --overwrite-inconclusive option')
      overwriteInconclusive = true
      continue
    }
    if (argument === '--phase') {
      const requested = args[index + 1]
      throw new Error(`This command is P0-only; H1/phase override is forbidden${requested === undefined ? '' : ` (${requested})`}`)
    }
    throw new Error(`Unknown P0 command argument: ${String(argument)}`)
  }
  if (output === undefined) throw new Error('P0 command requires --output <path>')
  return Object.freeze({ output, overwriteInconclusive })
}

export function readProviderConfiguration(environment) {
  // Check presence only. The secret is intentionally never returned or content-addressed.
  requireNonEmpty(environment, 'DEEPSEEK_API_KEY')
  const baseUrl = normalizedBaseUrl(requireNonEmpty(environment, 'DEEPSEEK_BASE_URL'))
  const requestModel = requireNonEmpty(environment, 'DEEPSEEK_REQUEST_MODEL')
  const reviewedSnapshot = requireNonEmpty(environment, 'DEEPSEEK_REVIEWED_SNAPSHOT')
  const expectedResponseModel = requireNonEmpty(environment, 'DEEPSEEK_EXPECTED_RESPONSE_MODEL')
  const expectedSystemFingerprint = requireNonEmpty(environment, 'DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT')
  const thinking = requireNonEmpty(environment, 'DEEPSEEK_THINKING')
  const reasoningEffort = requireNonEmpty(environment, 'DEEPSEEK_REASONING_EFFORT')

  if (thinking !== 'enabled' && thinking !== 'disabled') {
    throw new Error('DEEPSEEK_THINKING must be enabled or disabled')
  }
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high' && reasoningEffort !== 'max') {
    throw new Error('DEEPSEEK_REASONING_EFFORT must be low, high or max')
  }

  return Object.freeze({
    provider: 'deepseek',
    requestModel,
    reviewedSnapshot,
    expectedResponseModel,
    expectedSystemFingerprint,
    thinking,
    reasoningEffort,
    baseUrl,
    adapterVersion: 'deepseek-chat-v1',
  })
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function existingStatus(output) {
  let metadata
  try {
    metadata = await stat(output)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  if (!metadata.isFile()) throw new Error(`P0 output target exists but is not a regular file: ${output}`)

  let parsed
  try {
    parsed = JSON.parse(await readFile(output, 'utf8'))
  } catch {
    return 'UNREADABLE'
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.status !== 'string') {
    return 'UNREADABLE'
  }
  return parsed.status
}

export async function validateOutputTarget(output, options) {
  if (typeof output !== 'string' || output.trim().length === 0) throw new Error('P0 output path must be non-empty')
  const root = path.resolve(options.root)
  const resolved = path.resolve(output)
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.json') {
    throw new Error('P0 output path must use a .json extension')
  }
  if (isInside(path.join(root, 'src'), resolved) || isInside(path.join(root, 'lib'), resolved)) {
    throw new Error('P0 evidence must not be written inside distributable src/lib boundaries')
  }

  const status = await existingStatus(resolved)
  if (status === undefined) return resolved
  if (!options.overwriteInconclusive) throw new Error(`P0 output already exists: ${resolved}`)
  if (status !== 'INCONCLUSIVE') {
    throw new Error(`Only an existing INCONCLUSIVE P0 result may be overwritten; found ${status}`)
  }
  return resolved
}

function canonicalJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical P0 JSON forbids non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map(item => canonicalJsonValue(item))
  if (typeof value === 'object' && value !== null) {
    const result = {}
    for (const key of Object.keys(value).toSorted()) {
      const child = value[key]
      if (child === undefined) throw new Error(`Canonical P0 JSON forbids undefined at ${key}`)
      result[key] = canonicalJsonValue(child)
    }
    return result
  }
  throw new Error(`Canonical P0 JSON cannot encode ${typeof value}`)
}

export async function writeCanonicalResult(output, value) {
  const resolved = path.resolve(output)
  const parent = path.dirname(resolved)
  await mkdir(parent, { recursive: true })
  const content = `${JSON.stringify(canonicalJsonValue(value))}\n`
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex')
  const temporary = path.join(parent, `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    try {
      await rename(temporary, resolved)
    } catch (error) {
      // Windows cannot replace an existing destination with rename(). The overwrite
      // path is only permitted for a previously validated INCONCLUSIVE result.
      if (error && typeof error === 'object' && 'code' in error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        await rm(resolved, { force: true })
        await rename(temporary, resolved)
      } else {
        throw error
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
  return Object.freeze({ sha256, byteLength: Buffer.byteLength(content, 'utf8') })
}

function compilerEnvironment(environment) {
  const allow = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME']
  return Object.fromEntries(allow.flatMap(name => {
    const value = environment[name]
    return typeof value === 'string' ? [[name, value]] : []
  }))
}

async function compileEvaluationRuntime(root) {
  const tempParent = path.join(root, '.tmp')
  await mkdir(tempParent, { recursive: true })
  const runtimeRoot = await mkdtemp(path.join(tempParent, 'm2-p0-runtime-'))
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

function childEnvironment(environment) {
  const names = [
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_BASE_URL',
    'DEEPSEEK_REQUEST_MODEL',
    'DEEPSEEK_REVIEWED_SNAPSHOT',
    'DEEPSEEK_EXPECTED_RESPONSE_MODEL',
    'DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT',
    'DEEPSEEK_THINKING',
    'DEEPSEEK_REASONING_EFFORT',
  ]
  const result = compilerEnvironment(environment)
  for (const name of names) result[name] = requireNonEmpty(environment, name)
  result.DEEPSEEK_MAX_OUTPUT_TOKENS = P0_MAX_OUTPUT_TOKENS
  return result
}

async function importRuntime(runtimeRoot) {
  const definitionUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-agent-p0-definition.js')).href
  const runnerUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-agent-p0-runner.js')).href
  const integrityUrl = pathToFileURL(path.join(runtimeRoot, 'tests', 'evaluation', 'm2-agent-eval-v2-integrity.js')).href
  const [definition, runner, integrity] = await Promise.all([
    import(definitionUrl),
    import(runnerUrl),
    import(integrityUrl),
  ])
  return {
    createFrozenP0Inputs: definition.createFrozenP0Inputs,
    executeFrozenP0: runner.executeFrozenP0,
    validateAgentV2ResultAgainstDefinition: integrity.validateAgentV2ResultAgainstDefinition,
  }
}

export { compileEvaluationRuntime, importRuntime }

function safeSummary(provider, output) {
  return [
    'M2.3 P0 calibration',
    'target=@deepseek-ai/dsh@0.1.1-rc.2 profile=web',
    `model=${provider.requestModel}`,
    `snapshot=${provider.reviewedSnapshot}`,
    `expectedResponseModel=${provider.expectedResponseModel}`,
    `expectedSystemFingerprint=${provider.expectedSystemFingerprint}`,
    `output=${output}`,
  ].join(' ')
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const parsed = parseArguments(args)
  if (environment.M2_AGENT_PHASE !== undefined && environment.M2_AGENT_PHASE !== 'P0') {
    throw new Error(`run-m2-p0 is P0-only; M2_AGENT_PHASE=${environment.M2_AGENT_PHASE} is forbidden`)
  }
  const provider = readProviderConfiguration(environment)
  const output = await validateOutputTarget(parsed.output, {
    root: REPOSITORY_ROOT,
    overwriteInconclusive: parsed.overwriteInconclusive,
  })

  console.log(safeSummary(provider, output))
  const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
  try {
    const runtime = await importRuntime(runtimeRoot)
    if (
      typeof runtime.createFrozenP0Inputs !== 'function'
      || typeof runtime.executeFrozenP0 !== 'function'
      || typeof runtime.validateAgentV2ResultAgainstDefinition !== 'function'
    ) {
      throw new Error('Compiled P0 evaluation runtime is incomplete')
    }

    const frozen = await runtime.createFrozenP0Inputs(provider)
    const child = fileURLToPath(new URL('./m2-deepseek-p0-child.mjs', import.meta.url))
    const execution = await runtime.executeFrozenP0(frozen, {
      command: process.execPath,
      args: [child],
      cwd: REPOSITORY_ROOT,
      environment: childEnvironment(environment),
      timeoutMs: 300_000,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 64 * 1024,
    })
    await runtime.validateAgentV2ResultAgainstDefinition(execution.definition, execution.result, {
      sha256Utf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
    })

    const receipt = await writeCanonicalResult(output, execution.result)
    console.log(`P0 status=${execution.result.status} definitionSha256=${frozen.definitionSha256} resultSha256=${receipt.sha256}`)
    return Object.freeze({
      status: execution.result.status,
      definitionSha256: frozen.definitionSha256,
      resultSha256: receipt.sha256,
      output,
    })
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true })
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`P0 calibration failed: ${message}`)
    process.exitCode = 1
  })
}
