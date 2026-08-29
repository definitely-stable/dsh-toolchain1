import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { ModelEnvelope } from './m2-agent-execution-evidence.js'
import { executeProcessModelAttempt } from './m2-agent-process-executor.js'

const CHILD = fileURLToPath(new URL('../../scripts/m2-deepseek-p0-child.mjs', import.meta.url))
const SECRET = 'sk-p0-secret-must-not-leak'
const SYSTEM_FINGERPRINT = 'fp_p0_v4_0813_fixture'

interface CapturedRequest {
  readonly authorization: string | undefined
  readonly body: Record<string, unknown>
}

function envelope(): ModelEnvelope {
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: 'Use only evidence available in this run.',
    task: {
      id: 'p0-01',
      prompt: 'Identify the typed-tool API on this exact target.',
    },
    staticContext: [],
    tools: [{
      family: 'ordinary',
      name: 'search_text',
      description: 'Search the frozen exact-target workspace.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    }],
  }
}

function responseJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function withServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(error => {
      responseJson(response, 500, { error: String(error) })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server did not bind TCP')
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  }
}

function childEnvironment(baseUrl: string, overrides: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    DEEPSEEK_API_KEY: SECRET,
    DEEPSEEK_BASE_URL: baseUrl,
    DEEPSEEK_REQUEST_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_REVIEWED_SNAPSHOT: 'DeepSeek-V4-Pro-0813',
    DEEPSEEK_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT: SYSTEM_FINGERPRINT,
    DEEPSEEK_THINKING: 'enabled',
    DEEPSEEK_REASONING_EFFORT: 'high',
    DEEPSEEK_MAX_OUTPUT_TOKENS: '6000',
    ...overrides,
  }
}

async function executeChild(baseUrl: string, environment: Readonly<Record<string, string>> = {}) {
  return executeProcessModelAttempt({
    command: process.execPath,
    args: [CHILD],
    cwd: process.cwd(),
    environment: childEnvironment(baseUrl, environment),
    envelope: envelope(),
    timeoutMs: 10_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 16 * 1024,
    dispatchToolCall: async request => {
      expect(request).toEqual({
        id: 'call-1',
        name: 'search_text',
        input: { query: 'defineTool' },
      })
      return { query: 'defineTool', matches: [{ path: '/exact-target/dsh-tools.d.ts' }] }
    },
  })
}

describe('M2.3 DeepSeek P0 process child', () => {
  it('uses Chat Completions tool calls and preserves reasoning_content across the tool round-trip', async () => {
    const requests: CapturedRequest[] = []
    const result = await withServer(async (request, response) => {
      const body = await readRequestBody(request)
      requests.push({ authorization: request.headers.authorization, body })
      if (requests.length === 1) {
        responseJson(response, 200, {
          id: 'chatcmpl-tool-1',
          object: 'chat.completion',
          model: 'deepseek-v4-pro',
          system_fingerprint: SYSTEM_FINGERPRINT,
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: 'I should inspect exact-target evidence before answering.',
              tool_calls: [{
                id: 'call-1',
                type: 'function',
                function: { name: 'search_text', arguments: '{"query":"defineTool"}' },
              }],
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        })
        return
      }
      responseJson(response, 200, {
        id: 'chatcmpl-final-1',
        object: 'chat.completion',
        model: 'deepseek-v4-pro',
        system_fingerprint: SYSTEM_FINGERPRINT,
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists\nUse defineTool.',
            reasoning_content: 'The search result supports the exact symbol.',
          },
        }],
        usage: { prompt_tokens: 140, completion_tokens: 30, total_tokens: 170 },
      })
    }, baseUrl => executeChild(baseUrl))

    expect(result).toEqual({
      kind: 'model-outcome',
      finalAnswer: 'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists\nUse defineTool.',
      providerMetadata: {
        completionId: 'chatcmpl-final-1',
        finishReason: 'stop',
        inputTokens: 240,
        outputTokens: 50,
      },
    })
    expect(requests).toHaveLength(2)
    expect(requests.every(item => item.authorization === `Bearer ${SECRET}`)).toBe(true)

    const first = requests[0]!.body
    expect(first).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      max_tokens: 6000,
      tool_choice: 'auto',
    })
    expect(first.tools).toEqual([{
      type: 'function',
      function: {
        name: 'search_text',
        description: 'Search the frozen exact-target workspace.',
        parameters: envelope().tools[0]!.inputSchema,
      },
    }])

    const secondMessages = requests[1]!.body.messages as Array<Record<string, unknown>>
    expect(secondMessages.at(-2)).toMatchObject({
      role: 'assistant',
      reasoning_content: 'I should inspect exact-target evidence before answering.',
      tool_calls: [{ id: 'call-1', type: 'function' }],
    })
    expect(secondMessages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
    expect(String(secondMessages.at(-1)?.content)).toContain('defineTool')
    expect(JSON.stringify(requests)).not.toContain(SECRET)
  })

  it('fails closed on response-model or backend-fingerprint drift', async () => {
    const result = await withServer(async (_request, response) => {
      responseJson(response, 200, {
        id: 'chatcmpl-drift-1',
        object: 'chat.completion',
        model: 'deepseek-v4-pro-next',
        system_fingerprint: 'fp_unexpected',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'should not be accepted' },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      })
    }, baseUrl => executeChild(baseUrl))

    expect(result.kind).toBe('infrastructure-failure')
    if (result.kind !== 'infrastructure-failure') throw new Error('expected infrastructure failure')
    expect(result.reason).toBe('provider-transport')
    expect(result.detail).toMatch(/response model drift|system fingerprint drift/u)
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('redacts provider error bodies and credentials from the closed NDJSON boundary', async () => {
    const result = await withServer(async (_request, response) => {
      responseJson(response, 401, {
        error: { message: `invalid credential ${SECRET}` },
      })
    }, baseUrl => executeChild(baseUrl))

    expect(result.kind).toBe('infrastructure-failure')
    if (result.kind !== 'infrastructure-failure') throw new Error('expected infrastructure failure')
    expect(result.reason).toBe('provider-transport')
    expect(result.detail).toContain('HTTP 401')
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
