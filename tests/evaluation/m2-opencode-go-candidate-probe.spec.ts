import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SECRET = 'sk-opencode-candidate-probe-secret'

function responseJson(response: ServerResponse, value: unknown): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function withServer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => {
      response.statusCode = 500
      response.end(String(error))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server did not bind TCP')
    return await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
  }
}

describe('M2.3 OpenCode Go candidate identity probe', () => {
  it('can probe a selected Go model without changing the default identity probe', async () => {
    const module = await import(`${new URL('../../scripts/probe-m2-opencode-go.mjs', import.meta.url).href}?candidate=${Math.random()}`) as Record<string, unknown>
    const probeOpenCodeGoIdentity = module.probeOpenCodeGoIdentity as (
      environment: NodeJS.ProcessEnv,
      options: { baseUrl: string; model: string },
    ) => Promise<Record<string, unknown>>

    const requestedModels: string[] = []
    let requestCount = 0
    const receipt = await withServer(async (request, response) => {
      requestCount += 1
      const body = await readBody(request)
      const model = String(body.model)
      requestedModels.push(model)

      if (requestCount === 1) {
        responseJson(response, {
          id: 'candidate-tool',
          object: 'chat.completion',
          model,
          system_fingerprint: 'fp_candidate_fixture',
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: '',
              reasoning_content: 'probe reasoning',
              tool_calls: [{
                id: 'candidate-call',
                type: 'function',
                function: { name: 'identity_probe', arguments: '{"value":"ok"}' },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        return
      }

      responseJson(response, {
        id: 'candidate-final',
        object: 'chat.completion',
        model,
        system_fingerprint: 'fp_candidate_fixture',
        choices: [{
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'probe-ok', reasoning_content: 'done' },
        }],
        usage: { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 },
      })
    }, baseUrl => probeOpenCodeGoIdentity(
      { OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv,
      { baseUrl, model: 'deepseek-v4-pro' },
    ))

    expect(requestedModels).toEqual(['deepseek-v4-pro', 'deepseek-v4-pro'])
    expect(receipt).toMatchObject({
      requestModel: 'deepseek-v4-pro',
      responseModel: 'deepseek-v4-pro',
      backendIdentityStrength: 'system-fingerprint',
      systemFingerprint: 'fp_candidate_fixture',
    })
  })

  it('parses an explicit candidate model for provider-only CLI discovery', async () => {
    const module = await import(`${new URL('../../scripts/probe-m2-opencode-go.mjs', import.meta.url).href}?args=${Math.random()}`) as Record<string, unknown>
    const parseProbeArguments = module.parseProbeArguments as (
      args: readonly string[],
    ) => { readonly output: string; readonly model?: string }

    expect(parseProbeArguments([
      '--model',
      'glm-5.3-flash',
      '--output',
      'candidate-receipt.json',
    ])).toEqual({
      model: 'glm-5.3-flash',
      output: path.resolve('candidate-receipt.json'),
    })
  })
})
