#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  compileEvaluationRuntime,
  importRuntime,
  validateOutputTarget,
  writeCanonicalResult,
} from './run-m2-p0.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url))
const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'
const OPENCODE_GO_REQUEST_MODEL = 'deepseek-v4-flash'
const P0_MAX_OUTPUT_TOKENS = '12000'

function requireNonEmpty(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required P0 provider configuration: ${name}`)
  }
  return value
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireSha256(value, label) {
  const text = requireString(value, label)
  if (!/^[0-9a-f]{64}$/u.test(text)) throw new Error(`${label} must be 64 lowercase hex characters`)
  return text
}

export function readOpenCodeGoProviderConfiguration(environment, probeValue, probeSha256Value) {
  // Presence only. The credential is intentionally never returned, retained or content-addressed.
  requireNonEmpty(environment, 'OPENCODE_API_KEY')
  const probeSha256 = requireSha256(probeSha256Value, 'OpenCode Go provider probe sha256')
  const probe = requireRecord(probeValue, 'OpenCode Go provider probe')

  if (probe.schema !== 'dsh-toolchain-m2-opencode-go-probe-v1') throw new Error('Unsupported OpenCode Go provider probe schema')
  if (probe.provider !== 'opencode-go') throw new Error('OpenCode Go provider probe provenance is invalid')
  if (probe.baseUrl !== OPENCODE_GO_BASE_URL) throw new Error('OpenCode Go provider probe baseUrl is not the frozen Go endpoint')
  if (probe.requestModel !== OPENCODE_GO_REQUEST_MODEL || probe.responseModel !== OPENCODE_GO_REQUEST_MODEL) {
    throw new Error('OpenCode Go provider probe model is not deepseek-v4-flash')
  }
  if (probe.thinking !== 'enabled' || probe.reasoningEffort !== 'high') {
    throw new Error('OpenCode Go provider probe reasoning mode is not the frozen P0 mode')
  }
  if (probe.functionToolCall !== 'verified') throw new Error('OpenCode Go provider probe did not verify function tool calls')
  if (probe.tokenMeasurement !== 'verified') throw new Error('OpenCode Go provider probe did not verify token measurement')
  if (probe.reasoningContinuation !== 'verified' && probe.reasoningContinuation !== 'not-observed') {
    throw new Error('OpenCode Go provider probe did not complete the reasoning/tool continuation path')
  }

  const backendIdentityStrength = requireString(probe.backendIdentityStrength, 'OpenCode Go backend identity strength')
  let expectedSystemFingerprint
  if (backendIdentityStrength === 'system-fingerprint') {
    expectedSystemFingerprint = requireString(probe.systemFingerprint, 'OpenCode Go system fingerprint')
  } else if (backendIdentityStrength === 'response-model-only') {
    if (probe.systemFingerprint !== undefined) throw new Error('Response-model-only OpenCode Go probe must not retain systemFingerprint')
  } else {
    throw new Error('Unsupported OpenCode Go backend identity strength')
  }

  return Object.freeze({
    provider: 'opencode-go',
    requestModel: OPENCODE_GO_REQUEST_MODEL,
    reviewedSnapshot: `opencode-go-probe:${probeSha256}`,
    expectedResponseModel: OPENCODE_GO_REQUEST_MODEL,
    ...(expectedSystemFingerprint === undefined ? {} : { expectedSystemFingerprint }),
    thinking: 'enabled',
    reasoningEffort: 'high',
    baseUrl: OPENCODE_GO_BASE_URL,
    adapterVersion: 'opencode-go-deepseek-chat-v1',
    providerProbeSha256: probeSha256,
  })
}

export function parseArguments(args) {
  let probe
  let output
  let overwriteInconclusive = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--probe' || argument === '--output') {
      const current = argument === '--probe' ? probe : output
      if (current !== undefined) throw new Error(`Duplicate ${argument} option`)
      const value = args[index + 1]
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        throw new Error(`${argument} requires a non-empty path`)
      }
      if (argument === '--probe') probe = value
      else output = value
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
    throw new Error(`Unknown OpenCode Go P0 command argument: ${String(argument)}`)
  }
  if (probe === undefined) throw new Error('OpenCode Go P0 command requires --probe <path>')
  if (output === undefined) throw new Error('OpenCode Go P0 command requires --output <path>')
  return Object.freeze({ probe, output, overwriteInconclusive })
}

async function readProbe(pathValue) {
  const resolved = path.resolve(pathValue)
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.json') throw new Error('OpenCode Go probe path must use .json')
  const bytes = await readFile(resolved)
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('OpenCode Go probe file is not valid JSON')
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return Object.freeze({ resolved, value, sha256 })
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
  result.OPENCODE_GO_MAX_OUTPUT_TOKENS = P0_MAX_OUTPUT_TOKENS
  return result
}

function safeSummary(provider, probe, output) {
  return [
    'M2.3 P0 calibration via OpenCode Go',
    'target=@deepseek-ai/dsh@0.1.1-rc.2 profile=web',
    `model=${provider.requestModel}`,
    `snapshot=${provider.reviewedSnapshot}`,
    `backend=${provider.expectedSystemFingerprint === undefined ? 'response-model-only' : provider.expectedSystemFingerprint}`,
    `probe=${probe}`,
    `output=${output}`,
  ].join(' ')
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  if (environment.M2_AGENT_PHASE !== undefined && environment.M2_AGENT_PHASE !== 'P0') {
    throw new Error(`run-m2-p0-opencode-go is P0-only; M2_AGENT_PHASE=${environment.M2_AGENT_PHASE} is forbidden`)
  }
  const parsed = parseArguments(args)
  // Fail on missing credential before compiling or spawning any model process.
  requireNonEmpty(environment, 'OPENCODE_API_KEY')
  const probe = await readProbe(parsed.probe)
  const provider = readOpenCodeGoProviderConfiguration(environment, probe.value, probe.sha256)
  const output = await validateOutputTarget(parsed.output, {
    root: REPOSITORY_ROOT,
    overwriteInconclusive: parsed.overwriteInconclusive,
  })

  console.log(safeSummary(provider, probe.resolved, output))
  const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
  try {
    const runtime = await importRuntime(runtimeRoot)
    if (
      typeof runtime.createFrozenP0Inputs !== 'function'
      || typeof runtime.executeFrozenP0 !== 'function'
      || typeof runtime.validateAgentV2ResultAgainstDefinition !== 'function'
    ) {
      throw new Error('Compiled OpenCode Go P0 evaluation runtime is incomplete')
    }

    const frozen = await runtime.createFrozenP0Inputs(provider)
    const child = fileURLToPath(new URL('./m2-opencode-go-p0-child.mjs', import.meta.url))
    const execution = await runtime.executeFrozenP0(frozen, {
      command: process.execPath,
      args: [child],
      cwd: REPOSITORY_ROOT,
      environment: childEnvironment(environment, provider),
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
      providerProbeSha256: probe.sha256,
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
    console.error(`OpenCode Go P0 calibration failed: ${message}`)
    process.exitCode = 1
  })
}
