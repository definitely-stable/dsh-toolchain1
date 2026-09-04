#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStagedResultToolDefinition, STAGED_RESULT_TOOL_NAME } from './eval/staged-provider-transport.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1'
const DEFAULT_REQUEST_MODEL = 'deepseek-v4-flash'
const THINKING = 'enabled'
const REASONING_EFFORT = 'high'
const MAX_OUTPUT_TOKENS = 256
const MAX_PROVIDER_ERROR_BYTES = 4_096
const MAX_PROVIDER_ERROR_FIELD_CHARACTERS = 240
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u
const STAGED_TRANSPORT_TASK_ID = 'transport-probe'
const PROBE_USAGE = 'Usage: node scripts/probe-m2-opencode-go.mjs [--model <model-id>] [--staged-transport] --output <new-json-path>'

function requireEnvironment(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required OpenCode Go probe configuration: ${name}`)
  return value
}

function normalizedBaseUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('OpenCode Go probe baseUrl must be an absolute URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OpenCode Go probe baseUrl must use http or https')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('OpenCode Go probe baseUrl must not contain credentials, query or fragment')
  }
  const pathname = url.pathname.replace(/\/+$/u, '')
  return `${url.origin}${pathname}`
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be a string`)
  return value
}

function selectedModel(value) {
  if (value === undefined) return DEFAULT_REQUEST_MODEL
  const model = requireString(value, 'OpenCode Go probe model')
  if (!MODEL_PATTERN.test(model)) throw new Error('OpenCode Go probe model must be a safe non-empty model id')
  return model
}

function optionalString(value, label) {
  if (value === null || value === undefined) return undefined
  return requireString(value, label, { allowEmpty: true })
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function providerTools() {
  return [{
    type: 'function',
    function: {
      name: 'identity_probe',
      description: 'Return the exact value supplied so the transport can verify function-tool continuation.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { value: { type: 'string', const: 'ok' } },
        required: ['value'],
      },
    },
  }]
}

function initialMessages() {
  return [
    {
      role: 'system',
      content: 'This is a transport identity probe. Call identity_probe with {"value":"ok"}. After the tool result, reply with probe-ok.',
    },
    { role: 'user', content: 'Run the identity probe now.' },
  ]
}

function stagedTransportMessages() {
  return [
    {
      role: 'system',
      content: `This is a structured transport capability probe. Call ${STAGED_RESULT_TOOL_NAME} exactly once with taskId ${STAGED_TRANSPORT_TASK_ID}.`,
    },
    {
      role: 'user',
      content: 'Submit one schema-valid measurement claim now. Use package "*", symbol "TransportProbe", assertion "absent".',
    },
  ]
}

function requestBody(messages, requestModel, options = {}) {
  return {
    model: requestModel,
    messages,
    thinking: { type: THINKING },
    reasoning_effort: REASONING_EFFORT,
    max_tokens: MAX_OUTPUT_TOKENS,
    tools: options.tools ?? providerTools(),
    ...(options.toolChoice === undefined ? {} : { tool_choice: options.toolChoice }),
  }
}

function safeProviderErrorField(value, apiKey) {
  let text
  if (typeof value === 'string') text = value
  else if (Number.isInteger(value)) text = String(value)
  else return undefined

  const redacted = apiKey.length === 0 ? text : text.replaceAll(apiKey, '[redacted]')
  const withoutControls = Array.from(redacted, character => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f) ? ' ' : character
  }).join('')
  const normalized = withoutControls.replace(/\s+/gu, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.slice(0, MAX_PROVIDER_ERROR_FIELD_CHARACTERS)
}

async function readBoundedProviderErrorBody(response) {
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > MAX_PROVIDER_ERROR_BYTES) {
        await reader.cancel().catch(() => undefined)
        return undefined
      }
      chunks.push(Buffer.from(next.value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function boundedProviderErrorDetails(response, apiKey) {
  let text
  try {
    text = await readBoundedProviderErrorBody(response)
  } catch {
    return ''
  }
  if (text === undefined || text.trim() === '') return ''

  let value
  try {
    value = JSON.parse(text)
  } catch {
    return ''
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
  const error = value.error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return ''

  const fields = [
    ['type', safeProviderErrorField(error.type, apiKey)],
    ['code', safeProviderErrorField(error.code, apiKey)],
    ['message', safeProviderErrorField(error.message, apiKey)],
  ]
  return fields
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .map(([name, fieldValue]) => `${name}=${fieldValue}`)
    .join(' ')
}

async function requestCompletion(configuration, messages, requestModel, options = {}) {
  let response
  try {
    response = await fetch(configuration.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody(messages, requestModel, options)),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error('OpenCode Go probe request failed')
  }
  if (!response.ok) {
    const details = await boundedProviderErrorDetails(response, configuration.apiKey)
    throw new Error(`OpenCode Go probe provider HTTP ${response.status}${details === '' ? '' : ` ${details}`}`)
  }

  let value
  try {
    value = await response.json()
  } catch {
    throw new Error('OpenCode Go probe provider returned invalid JSON')
  }
  const completion = requireRecord(value, 'OpenCode Go probe completion')
  const responseModel = requireString(completion.model, 'OpenCode Go probe response model')
  if (responseModel !== requestModel) {
    throw new Error(`OpenCode Go probe response model drift: expected ${requestModel}, got ${responseModel}`)
  }
  const systemFingerprint = optionalString(completion.system_fingerprint, 'OpenCode Go probe system_fingerprint')
  const choices = completion.choices
  if (!Array.isArray(choices) || choices.length !== 1) throw new Error('OpenCode Go probe completion must contain exactly one choice')
  const choice = requireRecord(choices[0], 'OpenCode Go probe choice')
  const message = requireRecord(choice.message, 'OpenCode Go probe assistant message')
  if (message.role !== 'assistant') throw new Error('OpenCode Go probe response must use assistant role')
  const finishReason = requireString(choice.finish_reason, 'OpenCode Go probe finish reason')
  const id = requireString(completion.id, 'OpenCode Go probe completion id')
  const usage = requireRecord(completion.usage, 'OpenCode Go probe usage')
  const inputTokens = nonNegativeInteger(usage.prompt_tokens, 'OpenCode Go probe prompt_tokens')
  const outputTokens = nonNegativeInteger(usage.completion_tokens, 'OpenCode Go probe completion_tokens')

  return { id, responseModel, systemFingerprint, finishReason, message, inputTokens, outputTokens }
}

function parseProbeToolCall(message) {
  const calls = message.tool_calls
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error('OpenCode Go probe must return exactly one function tool call')
  const call = requireRecord(calls[0], 'OpenCode Go probe tool call')
  if (call.type !== 'function') throw new Error('OpenCode Go probe tool call must be a function')
  const fn = requireRecord(call.function, 'OpenCode Go probe tool function')
  if (requireString(fn.name, 'OpenCode Go probe tool name') !== 'identity_probe') {
    throw new Error('OpenCode Go probe called an unexpected tool')
  }
  const id = requireString(call.id, 'OpenCode Go probe tool call id')
  const argumentsText = requireString(fn.arguments, 'OpenCode Go probe tool arguments')
  let input
  try {
    input = JSON.parse(argumentsText)
  } catch {
    throw new Error('OpenCode Go probe tool arguments are not valid JSON')
  }
  const record = requireRecord(input, 'OpenCode Go probe tool input')
  if (record.value !== 'ok' || Object.keys(record).length !== 1) {
    throw new Error('OpenCode Go probe tool input does not match the frozen probe value')
  }
  return { id, raw: call }
}

function parseStagedTransportToolCall(message) {
  const calls = message.tool_calls
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error('OpenCode Go staged transport probe must return exactly one function tool call')
  const call = requireRecord(calls[0], 'OpenCode Go staged transport probe tool call')
  if (call.type !== 'function') throw new Error('OpenCode Go staged transport probe tool call must be a function')
  const fn = requireRecord(call.function, 'OpenCode Go staged transport probe tool function')
  if (requireString(fn.name, 'OpenCode Go staged transport probe tool name') !== STAGED_RESULT_TOOL_NAME) {
    throw new Error('OpenCode Go staged transport probe called an unexpected tool')
  }
  const argumentsText = requireString(fn.arguments, 'OpenCode Go staged transport probe tool arguments')
  let input
  try {
    input = JSON.parse(argumentsText)
  } catch {
    throw new Error('OpenCode Go staged transport probe tool arguments are not valid JSON')
  }
  const record = requireRecord(input, 'OpenCode Go staged transport probe tool input')
  if (record.schema !== 'dsh-toolchain-staged-eval-result-v1' || record.taskId !== STAGED_TRANSPORT_TASK_ID) {
    throw new Error('OpenCode Go staged transport probe result identity does not match the frozen probe')
  }
  if (!Array.isArray(record.claims) || record.claims.length !== 1) {
    throw new Error('OpenCode Go staged transport probe must return exactly one claim')
  }
  const claim = requireRecord(record.claims[0], 'OpenCode Go staged transport probe claim')
  if (typeof claim.package !== 'string' || typeof claim.symbol !== 'string' || !['exists', 'absent'].includes(claim.assertion)) {
    throw new Error('OpenCode Go staged transport probe claim does not match the staged schema')
  }
}

function assistantToolMessage(message) {
  const content = optionalString(message.content, 'OpenCode Go probe assistant content') ?? ''
  const reasoningContent = optionalString(message.reasoning_content, 'OpenCode Go probe reasoning_content')
  return {
    role: 'assistant',
    content,
    ...(reasoningContent === undefined ? {} : { reasoning_content: reasoningContent }),
    tool_calls: message.tool_calls,
  }
}

export async function probeOpenCodeGoIdentity(environment = process.env, options = {}) {
  const apiKey = requireEnvironment(environment, 'OPENCODE_API_KEY')
  const baseUrl = normalizedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL)
  const requestModel = selectedModel(options.model)
  const configuration = {
    apiKey,
    endpoint: new URL(`${baseUrl}/chat/completions`),
  }

  const messages = initialMessages()
  const first = await requestCompletion(configuration, messages, requestModel)
  if (first.finishReason !== 'tool_calls') throw new Error('OpenCode Go probe did not finish the first response with tool_calls')
  const call = parseProbeToolCall(first.message)
  const firstReasoning = optionalString(first.message.reasoning_content, 'OpenCode Go probe reasoning_content')

  messages.push(assistantToolMessage(first.message))
  messages.push({ role: 'tool', tool_call_id: call.id, content: '{"value":"ok"}' })
  const second = await requestCompletion(configuration, messages, requestModel)
  if (Array.isArray(second.message.tool_calls) && second.message.tool_calls.length > 0) {
    throw new Error('OpenCode Go probe continuation unexpectedly requested another tool')
  }
  const finalContent = optionalString(second.message.content, 'OpenCode Go probe final content')
  if (finalContent === undefined || finalContent.trim() === '') {
    throw new Error('OpenCode Go probe continuation omitted final assistant content')
  }
  if (first.systemFingerprint !== second.systemFingerprint) {
    throw new Error('OpenCode Go probe system fingerprint changed during the two-step probe')
  }

  let staged
  if (options.stagedTransport === true) {
    staged = await requestCompletion(
      configuration,
      stagedTransportMessages(),
      requestModel,
      {
        tools: [createStagedResultToolDefinition()],
        toolChoice: { type: 'function', function: { name: STAGED_RESULT_TOOL_NAME } },
      },
    )
    if (staged.finishReason !== 'tool_calls') {
      throw new Error('OpenCode Go staged transport probe did not finish with tool_calls')
    }
    parseStagedTransportToolCall(staged.message)
    if (staged.systemFingerprint !== second.systemFingerprint) {
      throw new Error('OpenCode Go staged transport probe system fingerprint changed after identity probe')
    }
  }

  return Object.freeze({
    schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
    provider: 'opencode-go',
    baseUrl,
    requestModel,
    responseModel: second.responseModel,
    ...(second.systemFingerprint === undefined ? {} : { systemFingerprint: second.systemFingerprint }),
    thinking: THINKING,
    reasoningEffort: REASONING_EFFORT,
    functionToolCall: 'verified',
    reasoningContinuation: firstReasoning === undefined || firstReasoning.length === 0 ? 'not-observed' : 'verified',
    tokenMeasurement: 'verified',
    ...(staged === undefined ? {} : {
      stagedNamedToolChoice: 'verified',
      stagedStrictResultSchema: 'verified',
    }),
    backendIdentityStrength: second.systemFingerprint === undefined ? 'response-model-only' : 'system-fingerprint',
    inputTokens: first.inputTokens + second.inputTokens + (staged?.inputTokens ?? 0),
    outputTokens: first.outputTokens + second.outputTokens + (staged?.outputTokens ?? 0),
  })
}

function canonicalJsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical probe JSON forbids non-finite numbers')
    return value
  }
  if (Array.isArray(value)) return value.map(item => canonicalJsonValue(item))
  if (typeof value === 'object' && value !== null) {
    const result = {}
    for (const key of Object.keys(value).toSorted()) {
      const child = value[key]
      if (child === undefined) throw new Error(`Canonical probe JSON forbids undefined at ${key}`)
      result[key] = canonicalJsonValue(child)
    }
    return result
  }
  throw new Error(`Canonical probe JSON cannot encode ${typeof value}`)
}

export function parseProbeArguments(args) {
  if (!Array.isArray(args) || args.length < 2) throw new Error(PROBE_USAGE)

  let outputValue
  let modelValue
  let stagedTransport = false

  for (let index = 0; index < args.length;) {
    const flag = args[index]
    if (flag === '--staged-transport') {
      if (stagedTransport) throw new Error('OpenCode Go probe --staged-transport may be specified only once')
      stagedTransport = true
      index += 1
      continue
    }

    if (flag !== '--output' && flag !== '--model') {
      throw new Error(`Unknown OpenCode Go probe argument: ${String(flag)}`)
    }
    const value = args[index + 1]
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
      throw new Error('OpenCode Go probe CLI values must be non-empty strings')
    }

    if (flag === '--output') {
      if (outputValue !== undefined) throw new Error('OpenCode Go probe --output may be specified only once')
      outputValue = value
    } else {
      if (modelValue !== undefined) throw new Error('OpenCode Go probe --model may be specified only once')
      modelValue = selectedModel(value)
    }
    index += 2
  }

  if (outputValue === undefined) throw new Error(PROBE_USAGE)
  const output = path.resolve(outputValue)
  if (path.extname(output).toLocaleLowerCase('en-US') !== '.json') throw new Error('OpenCode Go probe output must use .json')
  return Object.freeze({
    ...(modelValue === undefined ? {} : { model: modelValue }),
    ...(stagedTransport ? { stagedTransport: true } : {}),
    output,
  })
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const parsed = parseProbeArguments(args)
  const receipt = await probeOpenCodeGoIdentity(environment, {
    ...(parsed.model === undefined ? {} : { model: parsed.model }),
    ...(parsed.stagedTransport === true ? { stagedTransport: true } : {}),
  })
  await mkdir(path.dirname(parsed.output), { recursive: true })
  await writeFile(parsed.output, `${JSON.stringify(canonicalJsonValue(receipt))}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`OpenCode Go P0 identity probe verified model=${receipt.responseModel} backend=${receipt.backendIdentityStrength} output=${parsed.output}`)
  return Object.freeze({ output: parsed.output, receipt })
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`OpenCode Go P0 identity probe failed: ${message}`)
    process.exitCode = 1
  })
}
