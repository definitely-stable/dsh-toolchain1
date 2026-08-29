import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'

const SECRET = 'sk-opencode-probe-secret-must-not-leak'

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

async function loadProbeModule(): Promise<Record<string, unknown>> {
  return import(`${new URL('../../scripts/probe-m2-opencode-go.mjs', import.meta.url).href}?test=${Math.random()}`) as Promise<Record<string, unknown>>
}

async function loadRunModule(): Promise<Record<string, unknown>> {
  return import(`${new URL('../../scripts/run-m2-p0-opencode-go.mjs', import.meta.url).href}?test=${Math.random()}`) as Promise<Record<string, unknown>>
}

describe('M2.3 OpenCode Go identity probe', () => {
  it('proves the exact Chat Completions function-tool path before P0 can be frozen', async () => {
    const probeModule = await loadProbeModule()
    const probeOpenCodeGoIdentity = probeModule.probeOpenCodeGoIdentity as (
      environment: NodeJS.ProcessEnv,
      options: { baseUrl: string },
    ) => Promise<Record<string, unknown>>

    let authorization: string | undefined
    let body: Record<string, unknown> | undefined
    const receipt = await withServer(async (request, response) => {
      authorization = request.headers.authorization
      body = await readRequestBody(request)
      responseJson(response, 200, {
        id: 'chatcmpl-opencode-probe-1',
        object: 'chat.completion',
        model: 'deepseek-v4-pro',
        system_fingerprint: 'fp_opencode_probe_fixture',
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: 'I will call the requested probe tool.',
            tool_calls: [{
              id: 'probe-call-1',
              type: 'function',
              function: { name: 'identity_probe', arguments: '{"value":"ok"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 25, completion_tokens: 8, total_tokens: 33 },
      })
    }, baseUrl => probeOpenCodeGoIdentity({ OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv, { baseUrl }))

    expect(authorization).toBe(`Bearer ${SECRET}`)
    expect(body).toMatchObject({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      tool_choice: 'required',
    })
    expect(receipt).toMatchObject({
      schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-pro',
      responseModel: 'deepseek-v4-pro',
      systemFingerprint: 'fp_opencode_probe_fixture',
      thinking: 'enabled',
      reasoningEffort: 'high',
      functionToolCall: 'verified',
      reasoningContinuation: 'observed',
      tokenMeasurement: 'verified',
    })
    expect(JSON.stringify(receipt)).not.toContain(SECRET)
  })

  it('records response-model-only identity honestly when the gateway omits system_fingerprint', async () => {
    const probeModule = await loadProbeModule()
    const probeOpenCodeGoIdentity = probeModule.probeOpenCodeGoIdentity as (
      environment: NodeJS.ProcessEnv,
      options: { baseUrl: string },
    ) => Promise<Record<string, unknown>>

    const receipt = await withServer(async (_request, response) => {
      responseJson(response, 200, {
        id: 'chatcmpl-opencode-probe-2',
        object: 'chat.completion',
        model: 'deepseek-v4-pro',
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'probe-call-2',
              type: 'function',
              function: { name: 'identity_probe', arguments: '{"value":"ok"}' },
            }],
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      })
    }, baseUrl => probeOpenCodeGoIdentity({ OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv, { baseUrl }))

    expect(receipt.responseModel).toBe('deepseek-v4-pro')
    expect(receipt).not.toHaveProperty('systemFingerprint')
    expect(receipt).toMatchObject({
      backendIdentityStrength: 'response-model-only',
      reasoningContinuation: 'not-observed',
    })
  })

  it('derives the frozen executor identity from the retained probe and never from the credential', async () => {
    const runModule = await loadRunModule()
    const readOpenCodeGoProviderConfiguration = runModule.readOpenCodeGoProviderConfiguration as (
      environment: NodeJS.ProcessEnv,
      probe: Record<string, unknown>,
      probeSha256: string,
    ) => Record<string, unknown>

    const probe = {
      schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      requestModel: 'deepseek-v4-pro',
      responseModel: 'deepseek-v4-pro',
      systemFingerprint: 'fp_opencode_probe_fixture',
      thinking: 'enabled',
      reasoningEffort: 'high',
      functionToolCall: 'verified',
      reasoningContinuation: 'observed',
      tokenMeasurement: 'verified',
      backendIdentityStrength: 'system-fingerprint',
    }
    const probeSha256 = createHash('sha256').update(JSON.stringify(probe)).digest('hex')

    expect(() => readOpenCodeGoProviderConfiguration({} as NodeJS.ProcessEnv, probe, probeSha256)).toThrow(/OPENCODE_API_KEY/u)

    const provider = readOpenCodeGoProviderConfiguration(
      { OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv,
      probe,
      probeSha256,
    )
    expect(provider).toEqual({
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-pro',
      reviewedSnapshot: `opencode-go-probe:${probeSha256}`,
      expectedResponseModel: 'deepseek-v4-pro',
      expectedSystemFingerprint: 'fp_opencode_probe_fixture',
      thinking: 'enabled',
      reasoningEffort: 'high',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      adapterVersion: 'opencode-go-deepseek-chat-v1',
      providerProbeSha256: probeSha256,
    })
    expect(JSON.stringify(provider)).not.toContain(SECRET)
  })
})
