import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'

const SECRET = 'staged-probe-secret-must-not-leak'

function responseJson(response: ServerResponse, value: unknown): void {
  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>
}

async function loadProbeModule(): Promise<Record<string, unknown>> {
  return import(`${new URL('../../scripts/probe-m2-opencode-go.mjs', import.meta.url).href}?staged=${Math.random()}`) as Promise<Record<string, unknown>>
}

describe('M2 staged provider capability probe', () => {
  it('probes the exact claim-only strict finalizer without exposing experiment identity to the model', async () => {
    const requests: Record<string, any>[] = []
    const server = createServer((request, response) => {
      void readBody(request).then(body => {
        requests.push(body)
        const ordinal = requests.length
        if (ordinal === 1) {
          responseJson(response, {
            id: 'probe-identity-tool',
            model: 'deepseek-v4-flash',
            system_fingerprint: 'fp-staged-probe',
            choices: [{
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'identity-call',
                  type: 'function',
                  function: { name: 'identity_probe', arguments: '{"value":"ok"}' },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 3 },
          })
          return
        }
        if (ordinal === 2) {
          responseJson(response, {
            id: 'probe-identity-final',
            model: 'deepseek-v4-flash',
            system_fingerprint: 'fp-staged-probe',
            choices: [{
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'probe-ok' },
            }],
            usage: { prompt_tokens: 13, completion_tokens: 2 },
          })
          return
        }
        responseJson(response, {
          id: 'probe-staged-finalizer',
          model: 'deepseek-v4-flash',
          system_fingerprint: 'fp-staged-probe',
          choices: [{
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'staged-call',
                type: 'function',
                function: {
                  name: 'submit_staged_result',
                  arguments: JSON.stringify({
                    claim: { package: '*', symbol: 'TransportProbe', assertion: 'absent' },
                  }),
                },
              }],
            },
          }],
          usage: { prompt_tokens: 15, completion_tokens: 4 },
        })
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('fixture server did not bind')
      const probeModule = await loadProbeModule()
      const probeOpenCodeGoIdentity = probeModule.probeOpenCodeGoIdentity as (
        environment: NodeJS.ProcessEnv,
        options: { baseUrl: string; stagedTransport: true },
      ) => Promise<Record<string, unknown>>

      const receipt = await probeOpenCodeGoIdentity(
        { OPENCODE_API_KEY: SECRET } as NodeJS.ProcessEnv,
        { baseUrl: `http://127.0.0.1:${address.port}`, stagedTransport: true },
      )

      expect(requests).toHaveLength(3)
      const staged = requests[2]!
      expect(staged.tools).toHaveLength(1)
      expect(staged.tools[0]).toMatchObject({
        type: 'function',
        function: {
          name: 'submit_staged_result',
          strict: true,
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['claim'],
          },
        },
      })
      expect(staged.tool_choice).toEqual({
        type: 'function',
        function: { name: 'submit_staged_result' },
      })
      expect(JSON.stringify(staged.tools[0].function.parameters)).not.toContain('taskId')
      expect(JSON.stringify(staged.messages)).not.toContain('transport-probe')
      expect(JSON.stringify(staged.messages)).not.toContain('taskId')
      expect(receipt).toMatchObject({
        stagedNamedToolChoice: 'verified',
        stagedStrictResultSchema: 'verified',
      })
      expect(JSON.stringify(receipt)).not.toContain(SECRET)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })
})
