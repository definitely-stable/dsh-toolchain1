import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compileEvaluationRuntime } from '../run-m2-p0.mjs'
import { readOpenCodeGoProviderConfiguration } from '../run-m2-p0-opencode-go.mjs'
import { createStagedProviderExecutor } from './staged-provider-executor.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const STAGED_CHILD = fileURLToPath(new URL('../m2-opencode-go-staged-child.mjs', import.meta.url))
const MAX_OUTPUT_TOKENS = '12000'

function requireNonEmpty(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required staged provider configuration: ${name}`)
  }
  return value
}

function compilerEnvironment(environment) {
  const allow = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME']
  return Object.fromEntries(allow.flatMap(name => {
    const value = environment[name]
    return typeof value === 'string' ? [[name, value]] : []
  }))
}

function childEnvironment(environment, provider) {
  const result = compilerEnvironment(environment)
  result.OPENCODE_API_KEY = requireNonEmpty(environment, 'OPENCODE_API_KEY')
  result.OPENCODE_GO_BASE_URL = provider.baseUrl
  result.OPENCODE_GO_REQUEST_MODEL = provider.requestModel
  result.OPENCODE_GO_EXPECTED_RESPONSE_MODEL = provider.expectedResponseModel
  result.OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT = provider.expectedSystemFingerprint ?? ''
  result.OPENCODE_GO_THINKING = provider.thinking
  result.OPENCODE_GO_REASONING_EFFORT = provider.reasoningEffort
  result.OPENCODE_GO_MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS
  return result
}

async function importEvaluationRuntime(runtimeRoot) {
  const files = [
    ['definition', 'm2-agent-p0-definition.js'],
    ['evidence', 'm2-agent-execution-evidence.js'],
    ['toolRuntime', 'm2-agent-p0-tool-runtime.js'],
    ['processExecutor', 'm2-agent-process-executor.js'],
  ]
  const modules = await Promise.all(files.map(([, file]) => import(pathToFileURL(
    path.join(runtimeRoot, 'tests', 'evaluation', file),
  ).href)))
  return {
    createFrozenP0Inputs: modules[0].createFrozenP0Inputs,
    createModelEnvelope: modules[1].createModelEnvelope,
    createFrozenP0ToolRuntime: modules[2].createFrozenP0ToolRuntime,
    executeProcessModelAttempt: modules[3].executeProcessModelAttempt,
  }
}

const DEFAULT_SERVICES = Object.freeze({
  readProbe: pathValue => readFile(pathValue),
  compileEvaluationRuntime,
  importEvaluationRuntime,
  removeRuntime: runtimeRoot => rm(runtimeRoot, { recursive: true, force: true }),
})

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`)
  return value
}

function resolvedServices(services = {}) {
  const merged = { ...DEFAULT_SERVICES, ...services }
  return Object.freeze({
    readProbe: requireFunction(merged.readProbe, 'services.readProbe'),
    compileEvaluationRuntime: requireFunction(merged.compileEvaluationRuntime, 'services.compileEvaluationRuntime'),
    importEvaluationRuntime: requireFunction(merged.importEvaluationRuntime, 'services.importEvaluationRuntime'),
    removeRuntime: requireFunction(merged.removeRuntime, 'services.removeRuntime'),
  })
}

function parseProbe(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  let value
  try {
    value = JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error('Staged OpenCode Go provider probe is not valid JSON')
  }
  return Object.freeze({
    value,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  })
}

function validateRuntime(runtime) {
  if (runtime === null || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error('Compiled staged evaluation runtime is invalid')
  }
  for (const name of [
    'createFrozenP0Inputs',
    'createModelEnvelope',
    'createFrozenP0ToolRuntime',
    'executeProcessModelAttempt',
  ]) {
    if (typeof runtime[name] !== 'function') throw new Error(`Compiled staged evaluation runtime is missing ${name}`)
  }
  return runtime
}

/**
 * Creates the owned OpenCode Go executor used by one-dispatch development runs.
 * Historical H1 storage is intentionally outside this composition: the factory
 * only reuses the exact P0 workspace/capability/tool substrate and a fresh
 * process attempt per staged call/retry.
 *
 * @param {{
 *   environment?: Record<string, string | undefined>;
 *   services?: {
 *     readProbe?: Function;
 *     compileEvaluationRuntime?: Function;
 *     importEvaluationRuntime?: Function;
 *     removeRuntime?: Function;
 *   };
 * }} [input]
 */
export async function createDevelopmentExecutor(input = {}) {
  const environment = input.environment ?? process.env
  const probePath = path.resolve(requireNonEmpty(environment, 'M2_STAGED_PROVIDER_PROBE'))
  requireNonEmpty(environment, 'OPENCODE_API_KEY')
  const services = resolvedServices(input.services)
  const probe = parseProbe(await services.readProbe(probePath))
  const provider = readOpenCodeGoProviderConfiguration(environment, probe.value, probe.sha256)

  const runtimeRoot = await services.compileEvaluationRuntime(REPOSITORY_ROOT)
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await services.removeRuntime(runtimeRoot)
  }

  try {
    const runtime = validateRuntime(await services.importEvaluationRuntime(runtimeRoot))
    const frozen = await runtime.createFrozenP0Inputs(provider)
    const execute = createStagedProviderExecutor({
      frozen,
      runtime,
      processConfiguration: {
        command: process.execPath,
        args: [STAGED_CHILD],
        cwd: REPOSITORY_ROOT,
        environment: childEnvironment(environment, provider),
        timeoutMs: 300_000,
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 64 * 1024,
      },
      sha256Utf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
    })
    return Object.freeze({ execute, dispose })
  } catch (error) {
    await dispose()
    throw error
  }
}
