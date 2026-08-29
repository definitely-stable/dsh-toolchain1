import readline from 'node:readline'

const MAX_TOOL_ROUNDS = 11
const MAX_TOOL_RESULT_BYTES = 512 * 1024

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function emitInfrastructure(detail) {
  emit({ type: 'infrastructure_error', reason: 'provider-transport', detail })
}

function requireEnvironment(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`missing required provider configuration: ${name}`)
  return value
}

function parsePositiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${name} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`)
  return parsed
}

function providerConfiguration() {
  const apiKey = requireEnvironment('DEEPSEEK_API_KEY')
  const baseUrlValue = requireEnvironment('DEEPSEEK_BASE_URL')
  const requestModel = requireEnvironment('DEEPSEEK_REQUEST_MODEL')
  const reviewedSnapshot = requireEnvironment('DEEPSEEK_REVIEWED_SNAPSHOT')
  const expectedResponseModel = requireEnvironment('DEEPSEEK_EXPECTED_RESPONSE_MODEL')
  const expectedSystemFingerprint = requireEnvironment('DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT')
  const thinking = requireEnvironment('DEEPSEEK_THINKING')
  const reasoningEffort = requireEnvironment('DEEPSEEK_REASONING_EFFORT')
  const maxOutputTokens = parsePositiveInteger(
    requireEnvironment('DEEPSEEK_MAX_OUTPUT_TOKENS'),
    'DEEPSEEK_MAX_OUTPUT_TOKENS',
  )

  if (thinking !== 'enabled' && thinking !== 'disabled') {
    throw new Error('DEEPSEEK_THINKING must be enabled or disabled')
  }
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high' && reasoningEffort !== 'max') {
    throw new Error('DEEPSEEK_REASONING_EFFORT must be low, high or max')
  }

  const baseUrl = new URL(baseUrlValue)
  if (baseUrl.protocol !== 'https:' && baseUrl.protocol !== 'http:') {
    throw new Error('DEEPSEEK_BASE_URL must use http or https')
  }
  if (baseUrl.username !== '' || baseUrl.password !== '' || baseUrl.search !== '' || baseUrl.hash !== '') {
    throw new Error('DEEPSEEK_BASE_URL must not contain credentials, query or fragment')
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/u, '')

  return Object.freeze({
    apiKey,
    endpoint: new URL(`${baseUrl.href.replace(/\/+$/u, '')}/chat/completions`),
    requestModel,
    reviewedSnapshot,
    expectedResponseModel,
    expectedSystemFingerprint,
    thinking,
    reasoningEffort,
    maxOutputTokens,
  })
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be a string`)
  return value
}

function optionalString(value, label) {
  if (value === null || value === undefined) return null
  return requireString(value, label, { allowEmpty: true })
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function validateEnvelope(value) {
  const envelope = requireRecord(value, 'ModelEnvelope')
  if (envelope.schema !== 'dsh-toolchain-m2-model-envelope-v1') throw new Error('unsupported ModelEnvelope schema')
  const task = requireRecord(envelope.task, 'ModelEnvelope task')
  requireString(envelope.systemPrompt, 'ModelEnvelope systemPrompt')
  requireString(task.id, 'ModelEnvelope task id')
  requireString(task.prompt, 'ModelEnvelope task prompt')
  if (!Array.isArray(envelope.staticContext) || envelope.staticContext.length !== 0) {
    throw new Error('DeepSeek P0 child requires empty staticContext; exact-target evidence must remain tool-mediated')
  }
  if (!Array.isArray(envelope.tools)) throw new Error('ModelEnvelope tools must be an array')
  return envelope
}

function providerTools(tools) {
  return tools.map((value, index) => {
    const tool = requireRecord(value, `ModelEnvelope tool[${index}]`)
    return {
      type: 'function',
      function: {
        name: requireString(tool.name, `ModelEnvelope tool[${index}].name`),
        description: requireString(tool.description, `ModelEnvelope tool[${index}].description`, { allowEmpty: true }),
        parameters: tool.inputSchema,
      },
    }
  })
}

function initialMessages(envelope) {
  return [
    { role: 'system', content: envelope.systemPrompt },
    { role: 'user', content: envelope.task.prompt },
  ]
}

function providerRequestBody(configuration, messages, tools) {
  return {
    model: configuration.requestModel,
    messages,
    thinking: { type: configuration.thinking },
    reasoning_effort: configuration.reasoningEffort,
    max_tokens: configuration.maxOutputTokens,
    ...(tools.length === 0 ? {} : { tools, tool_choice: 'auto' }),
  }
}

async function requestCompletion(configuration, messages, tools) {
  let response
  try {
    response = await fetch(configuration.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(providerRequestBody(configuration, messages, tools)),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error('provider request failed')
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`provider HTTP ${response.status}`)
  }

  let value
  try {
    value = await response.json()
  } catch {
    throw new Error('provider returned invalid JSON')
  }
  const completion = requireRecord(value, 'provider completion')
  const responseModel = requireString(completion.model, 'provider completion model')
  if (responseModel !== configuration.expectedResponseModel) {
    throw new Error(`response model drift: expected ${configuration.expectedResponseModel}, got ${responseModel}`)
  }
  const systemFingerprint = requireString(completion.system_fingerprint, 'provider system_fingerprint')
  if (systemFingerprint !== configuration.expectedSystemFingerprint) {
    throw new Error('system fingerprint drift')
  }

  const choices = completion.choices
  if (!Array.isArray(choices) || choices.length !== 1) throw new Error('provider completion must contain exactly one choice')
  const choice = requireRecord(choices[0], 'provider choice')
  const message = requireRecord(choice.message, 'provider assistant message')
  if (message.role !== 'assistant') throw new Error('provider completion message must use assistant role')
  const finishReason = requireString(choice.finish_reason, 'provider finish reason')
  const id = requireString(completion.id, 'provider completion id')

  const usage = completion.usage === undefined ? undefined : requireRecord(completion.usage, 'provider usage')
  const inputTokens = usage === undefined ? undefined : nonNegativeInteger(usage.prompt_tokens, 'provider prompt_tokens')
  const outputTokens = usage === undefined ? undefined : nonNegativeInteger(usage.completion_tokens, 'provider completion_tokens')
  return {
    id,
    finishReason,
    message,
    inputTokens,
    outputTokens,
  }
}

function assistantMessage(message) {
  const content = optionalString(message.content, 'provider assistant content')
  const reasoningContent = optionalString(message.reasoning_content, 'provider assistant reasoning_content')
  const toolCalls = message.tool_calls
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) throw new Error('provider tool_calls must be a non-empty array')
  return {
    role: 'assistant',
    content,
    ...(reasoningContent === null ? {} : { reasoning_content: reasoningContent }),
    tool_calls: toolCalls,
  }
}

function parseToolCalls(message) {
  const raw = message.tool_calls
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('provider tool_calls must be a non-empty array')
  return raw.map((value, index) => {
    const call = requireRecord(value, `provider tool_call[${index}]`)
    if (call.type !== 'function') throw new Error(`provider tool_call[${index}] must be a function`)
    const fn = requireRecord(call.function, `provider tool_call[${index}].function`)
    const id = requireString(call.id, `provider tool_call[${index}].id`)
    const name = requireString(fn.name, `provider tool_call[${index}].function.name`)
    const argumentsText = requireString(fn.arguments, `provider tool_call[${index}].function.arguments`, { allowEmpty: true })
    let input
    try {
      input = JSON.parse(argumentsText)
    } catch {
      return { kind: 'invalid-arguments', id, name }
    }
    return { kind: 'call', id, name, input }
  })
}

function boundedToolResult(value) {
  const content = JSON.stringify(value ?? null)
  if (Buffer.byteLength(content, 'utf8') > MAX_TOOL_RESULT_BYTES) {
    throw new Error(`tool result exceeds ${MAX_TOOL_RESULT_BYTES} bytes`)
  }
  return content
}

async function nextNdjson(iterator, label) {
  const next = await iterator.next()
  if (next.done === true) throw new Error(`${label} missing from runner input`)
  let value
  try {
    value = JSON.parse(next.value)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  return requireRecord(value, label)
}

async function execute() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  const iterator = input[Symbol.asyncIterator]()
  const start = await nextNdjson(iterator, 'start message')
  if (start.type !== 'start') throw new Error('first runner message must be start')

  let configuration
  try {
    configuration = providerConfiguration()
  } catch (error) {
    emitInfrastructure(error instanceof Error ? error.message : 'invalid provider configuration')
    return
  }

  let envelope
  try {
    envelope = validateEnvelope(start.envelope)
  } catch (error) {
    emitInfrastructure(error instanceof Error ? error.message : 'invalid model envelope')
    return
  }

  const tools = providerTools(envelope.tools)
  const messages = initialMessages(envelope)
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let tokenMeasurementComplete = true
  let toolRounds = 0

  while (true) {
    let completion
    try {
      completion = await requestCompletion(configuration, messages, tools)
    } catch (error) {
      emitInfrastructure(error instanceof Error ? error.message : 'provider request failed')
      return
    }

    if (completion.inputTokens === undefined || completion.outputTokens === undefined) {
      tokenMeasurementComplete = false
    } else {
      totalInputTokens += completion.inputTokens
      totalOutputTokens += completion.outputTokens
    }

    const rawToolCalls = completion.message.tool_calls
    if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      toolRounds += rawToolCalls.length
      if (toolRounds > MAX_TOOL_ROUNDS) {
        emit({
          type: 'final',
          finalAnswer: optionalString(completion.message.content, 'provider assistant content') ?? '',
          providerMetadata: {
            completionId: completion.id,
            finishReason: 'tool_call_limit',
            ...(tokenMeasurementComplete ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : {}),
          },
        })
        return
      }

      let calls
      try {
        calls = parseToolCalls(completion.message)
      } catch (error) {
        emitInfrastructure(error instanceof Error ? error.message : 'invalid provider tool call')
        return
      }
      const invalid = calls.find(call => call.kind === 'invalid-arguments')
      if (invalid !== undefined) {
        emit({
          type: 'final',
          finalAnswer: optionalString(completion.message.content, 'provider assistant content') ?? '',
          providerMetadata: {
            completionId: completion.id,
            finishReason: 'invalid_tool_arguments',
            ...(tokenMeasurementComplete ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : {}),
          },
        })
        return
      }

      messages.push(assistantMessage(completion.message))
      for (const call of calls) {
        emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input })
        let resultMessage
        try {
          resultMessage = await nextNdjson(iterator, `tool_result ${call.id}`)
        } catch (error) {
          emitInfrastructure(error instanceof Error ? error.message : 'tool result transport failed')
          return
        }
        if (resultMessage.type !== 'tool_result' || resultMessage.id !== call.id) {
          emitInfrastructure(`tool result transport mismatch for ${call.id}`)
          return
        }
        let resultContent
        try {
          resultContent = boundedToolResult(resultMessage.result)
        } catch (error) {
          emitInfrastructure(error instanceof Error ? error.message : 'tool result serialization failed')
          return
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: resultContent })
      }
      continue
    }

    const finalAnswer = optionalString(completion.message.content, 'provider assistant content')
    if (finalAnswer === null) {
      emitInfrastructure('provider final response omitted assistant content')
      return
    }
    emit({
      type: 'final',
      finalAnswer,
      providerMetadata: {
        completionId: completion.id,
        finishReason: completion.finishReason,
        ...(tokenMeasurementComplete ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : {}),
      },
    })
    return
  }
}

execute().catch(() => {
  emitInfrastructure('DeepSeek child failed before producing a terminal provider result')
})
