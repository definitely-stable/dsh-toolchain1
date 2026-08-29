import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'

const SECRET = 'sk-opencode-error-secret-must-not-leak'

function responseJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

async function drainRequest(request: IncomingMessage): Promise<void> {
  for await (const chunk of request) {
    void chunk
  }
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

describe('M2.3 OpenCode Go provider-error diagnostics', () => {
  it('retains only bounded safe provider error metadata for a non-2xx probe response', async () => {
    const probeModule = await loadProbeModule()
    const probeOpenCodeGoIdentity = probeModule.probeOpenCodeGoIdentity as (
      environment: NodeJS.ProcessEnv,
      options: { baseUrl: string },
    ) => Promise<Record<string, unknown>>

    const error = await withServer(async (request, response) => {
      await drainRequest(request)
      responseJson(response, 400, {
        error: {
          type: 'invalid_request_error',
          code: 'invalid_request_error',
          message: 'Error from provider (Console Go): Upstream request failed',
          secretEcho: SECRET,
          requestDump: { authorization: `Bearer ${SECRET}` },
        },
        unrelated: SECRET,
      })
    }, async baseUrl => {
      try {
        await probeOpenCodeGoIdentity({ OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv, { baseUrl })
      } catch (caught) {
        return caught
      }
      throw new Error('expected OpenCode Go probe to reject fixture HTTP 400')
    })

    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('OpenCode Go probe provider HTTP 400')
    expect(message).toContain('type=invalid_request_error')
    expect(message).toContain('code=invalid_request_error')
    expect(message).toContain('message=Error from provider (Console Go): Upstream request failed')
    expect(message).not.toContain(SECRET)
    expect(message).not.toContain('secretEcho')
    expect(message).not.toContain('requestDump')
    expect(message.length).toBeLessThan(700)
  })
})
