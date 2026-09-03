import readline from 'node:readline'

import { appendStagedResultTool, routeStagedProviderToolCalls } from './eval/staged-provider-transport.mjs'

const MAX_PRODUCT_TOOL_CALLS = 31
const MAX_TOOL_RESULT_BYTES = 512 * 1024

const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const infrastructure = detail => emit({ type: 'infrastructure_error', reason: 'provider-transport', detail })

function env(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing required provider configuration: ${name}`)
  return value
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function text(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be a string`)
  return value
}

function configuration() {
  const requestModel = env('OPENCODE_GO_REQUEST_MODEL')
  const expectedResponseModel = env('OPENCODE_GO_EXPECTED_RESPONSE_MODEL')
  if (requestModel !== 'deepseek-v4-flash' || expectedResponseModel !== 'deepseek-v4-flash') {
    throw new Error('staged OpenCode Go evaluation is frozen to deepseek-v4-flash')
  }
  const thinking = env('OPENCODE_GO_THINKING')
  const reasoningEffort = env('OPENCODE_GO_REASONING_EFFORT')
  if (!['enabled', 'disabled'].includes(thinking)) throw new Error('invalid OPENCODE_GO_THINKING')
  if (!['low', 'high', 'max'].includes(reasoningEffort)) throw new Error('invalid OPENCODE_GO_REASONING_EFFORT')
  const maxOutputTokens = Number(env('OPENCODE_GO_MAX_OUTPUT_TOKENS'))
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) throw new Error('invalid OPENCODE_GO_MAX_OUTPUT_TOKENS')
  const base = new URL(env('OPENCODE_GO_BASE_URL'))
  if (!['http:', 'https:'].includes(base.protocol) || base.username !== '' || base.password !== '' || base.search !== '' || base.hash !== '') {
    throw new Error('invalid OPENCODE_GO_BASE_URL')
  }
  const expectedSystemFingerprint = process.env.OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT?.trim() || undefined
  return Object.freeze({
    apiKey: env('OPENCODE_API_KEY'),
    endpoint: new URL(`${base.href.replace(/\/+$/u, '')}/chat/completions`),
    requestModel,
    expectedResponseModel,
    expectedSystemFingerprint,
    thinking,
    reasoningEffort,
    maxOutputTokens,
  })
}

function envelope(value) {
  const result = record(value, 'ModelEnvelope')
  if (result.schema !== 'dsh-toolchain-m2-model-envelope-v1') throw new Error('unsupported ModelEnvelope schema')
  const task = record(result.task, 'ModelEnvelope task')
  text(result.systemPrompt, 'ModelEnvelope systemPrompt')
  text(task.id, 'ModelEnvelope task id')
  text(task.prompt, 'ModelEnvelope task prompt')
  if (!Array.isArray(result.staticContext) || result.staticContext.length !== 0) throw new Error('staged child requires empty staticContext')
  if (!Array.isArray(result.tools)) throw new Error('ModelEnvelope tools must be an array')
  return result
}

function providerTools(values) {
  return values.map((value, index) => {
    const tool = record(value, `ModelEnvelope tool[${index}]`)
    return {
      type: 'function',
      function: {
        name: text(tool.name, `ModelEnvelope tool[${index}].name`),
        description: text(tool.description, `ModelEnvelope tool[${index}].description`, true),
        parameters: tool.inputSchema,
      },
    }
  })
}

function usageInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

async function completion(cfg, messages, tools) {
  let response
  try {
    response = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.requestModel,
        messages,
        thinking: { type: cfg.thinking },
        reasoning_effort: cfg.reasoningEffort,
        max_tokens: cfg.maxOutputTokens,
        tools,
      }),
      signal: AbortSignal.timeout(180_000),
    })
  } catch {
    throw new Error('provider request failed')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`provider HTTP ${response.status}`)
  }
  let body
  try {
    body = record(await response.json(), 'provider completion')
  } catch {
    throw new Error('provider returned invalid JSON')
  }
  const responseModel = text(body.model, 'provider completion model')
  if (responseModel !== cfg.expectedResponseModel) throw new Error(`response model drift: ${responseModel}`)
  const fingerprint = body.system_fingerprint == null ? undefined : text(body.system_fingerprint, 'provider system_fingerprint', true)
  if (cfg.expectedSystemFingerprint !== undefined && fingerprint !== cfg.expectedSystemFingerprint) throw new Error('system fingerprint drift')
  if (!Array.isArray(body.choices) || body.choices.length !== 1) throw new Error('provider completion must contain one choice')
  const choice = record(body.choices[0], 'provider choice')
  const message = record(choice.message, 'provider assistant message')
  if (message.role !== 'assistant') throw new Error('provider message must be assistant')
  const providerUsage = body.usage === undefined ? undefined : record(body.usage, 'provider usage')
  return {
    id: text(body.id, 'provider completion id'),
    finishReason: text(choice.finish_reason, 'provider finish reason'),
    responseModel,
    ...(fingerprint === undefined ? {} : { systemFingerprint: fingerprint }),
    message,
    inputTokens: providerUsage === undefined ? undefined : usageInteger(providerUsage.prompt_tokens, 'provider prompt_tokens'),
    outputTokens: providerUsage === undefined ? undefined : usageInteger(providerUsage.completion_tokens, 'provider completion_tokens'),
  }
}

function calls(message) {
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) throw new Error('provider tool_calls must be non-empty')
  return message.tool_calls.map((value, index) => {
    const call = record(value, `provider tool_call[${index}]`)
    if (call.type !== 'function') throw new Error('provider tool call must be a function')
    const fn = record(call.function, `provider tool_call[${index}].function`)
    const id = text(call.id, `provider tool_call[${index}].id`)
    const name = text(fn.name, `provider tool_call[${index}].name`)
    const argumentsText = text(fn.arguments, `provider tool_call[${index}].arguments`, true)
    try {
      return { kind: 'call', id, name, input: JSON.parse(argumentsText) }
    } catch {
      return { kind: 'invalid-arguments', id, name }
    }
  })
}

function assistant(message) {
  return {
    role: 'assistant',
    content: message.content == null ? null : text(message.content, 'provider assistant content', true),
    ...(message.reasoning_content == null ? {} : { reasoning_content: text(message.reasoning_content, 'provider reasoning content', true) }),
    tool_calls: message.tool_calls,
  }
}

async function next(iterator, label) {
  const item = await iterator.next()
  if (item.done) throw new Error(`${label} missing from runner input`)
  return record(JSON.parse(item.value), label)
}

function metadata(value, inputTokens, outputTokens, complete, finishReason = value.finishReason) {
  return {
    completionId: value.id,
    finishReason,
    responseModel: value.responseModel,
    ...(value.systemFingerprint === undefined ? {} : { systemFingerprint: value.systemFingerprint }),
    ...(complete ? { inputTokens, outputTokens } : {}),
  }
}

function unsupported(value, inputTokens, outputTokens, complete, reason) {
  emit({ type: 'final', finalAnswer: '', providerMetadata: metadata(value, inputTokens, outputTokens, complete, reason) })
}

async function execute() {
  const iterator = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]()
  const start = await next(iterator, 'start message')
  if (start.type !== 'start') throw new Error('first runner message must be start')
  const cfg = configuration()
  const modelEnvelope = envelope(start.envelope)
  const tools = appendStagedResultTool(providerTools(modelEnvelope.tools))
  const messages = [
    { role: 'system', content: modelEnvelope.systemPrompt },
    { role: 'user', content: modelEnvelope.task.prompt },
  ]
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let tokenMeasurementComplete = true
  let productToolCalls = 0

  while (true) {
    const result = await completion(cfg, messages, tools)
    if (result.inputTokens === undefined || result.outputTokens === undefined) tokenMeasurementComplete = false
    else {
      totalInputTokens += result.inputTokens
      totalOutputTokens += result.outputTokens
    }

    if (!Array.isArray(result.message.tool_calls) || result.message.tool_calls.length === 0) {
      unsupported(result, totalInputTokens, totalOutputTokens, tokenMeasurementComplete, 'structured_transport_unsupported')
      return
    }

    const routed = routeStagedProviderToolCalls(calls(result.message))
    if (routed.kind === 'final') {
      emit({ type: 'final', finalAnswer: routed.finalAnswer, providerMetadata: metadata(result, totalInputTokens, totalOutputTokens, tokenMeasurementComplete) })
      return
    }
    if (routed.kind === 'unsupported') {
      unsupported(result, totalInputTokens, totalOutputTokens, tokenMeasurementComplete, 'structured_transport_unsupported')
      return
    }
    if (routed.calls.some(call => call.kind === 'invalid-arguments')) {
      unsupported(result, totalInputTokens, totalOutputTokens, tokenMeasurementComplete, 'invalid_tool_arguments')
      return
    }

    productToolCalls += routed.calls.length
    if (productToolCalls > MAX_PRODUCT_TOOL_CALLS) {
      unsupported(result, totalInputTokens, totalOutputTokens, tokenMeasurementComplete, 'tool_call_limit')
      return
    }
    messages.push(assistant(result.message))
    for (const call of routed.calls) {
      emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input })
      const toolResult = await next(iterator, `tool_result ${call.id}`)
      if (toolResult.type !== 'tool_result' || toolResult.id !== call.id) throw new Error(`tool result mismatch for ${call.id}`)
      const content = JSON.stringify(toolResult.result ?? null)
      if (Buffer.byteLength(content, 'utf8') > MAX_TOOL_RESULT_BYTES) throw new Error('tool result exceeds bounded size')
      messages.push({ role: 'tool', tool_call_id: call.id, content })
    }
  }
}

execute().catch(error => infrastructure(error instanceof Error ? error.message : 'staged child failed'))
