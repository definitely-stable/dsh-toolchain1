import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { decodeStagedFinalAnswer, STAGED_RESULT_TOOL_NAME } from '../../scripts/eval/staged-provider-transport.mjs'
import type { ModelEnvelope } from './m2-agent-execution-evidence.js'
import { executeProcessModelAttempt } from './m2-agent-process-executor.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const stagedChild = fileURLToPath(new URL('../../scripts/m2-opencode-go-staged-child.mjs', import.meta.url))

function completion(id: string, toolName: string, toolArguments: unknown, promptTokens: number, completionTokens: number) {
  return {
    id,
    model: 'deepseek-v4-flash',
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `${id}-tool`,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(toolArguments) },
        }],
      },
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

function proseCompletion(id: string, content: string, promptTokens: number, completionTokens: number) {
  return {
    id,
    model: 'deepseek-v4-flash',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return address.port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}

function modelEnvelope(): ModelEnvelope {
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: 'Use exact-target evidence and submit the structured result.',
    task: { id: 'task-01', prompt: 'Which public API should I use?' },
    staticContext: [],
    tools: [{
      family: 'ordinary',
      name: 'ordinary_read',
      description: 'Read exact-target evidence.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string' } },
      },
    }],
  }
}

function processEnvironment(port: number) {
  return {
    OPENCODE_API_KEY: 'test-only',
    OPENCODE_GO_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENCODE_GO_REQUEST_MODEL: 'deepseek-v4-flash',
    OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-flash',
    OPENCODE_GO_THINKING: 'enabled',
    OPENCODE_GO_REASONING_EFFORT: 'high',
    OPENCODE_GO_MAX_OUTPUT_TOKENS: '6000',
  }
}

describe('staged OpenCode Go child process boundary', () => {
  it('keeps the result function common to B/C and intercepts it before the product dispatcher', async () => {
    const requests: Array<Record<string, any>> = []
    const resultPayload = {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: 'task-01',
      claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
    }
    const responses = [
      completion('completion-1', 'ordinary_read', { path: 'README.md' }, 10, 3),
      completion('completion-2', STAGED_RESULT_TOOL_NAME, resultPayload, 12, 4),
    ]
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += String(chunk) })
      request.on('end', () => {
        requests.push(JSON.parse(body) as Record<string, any>)
        const next = responses.shift()
        if (next === undefined) {
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'unexpected request' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(next))
      })
    })
    const port = await listen(server)
    const dispatchToolCall = vi.fn(async () => ({ text: 'exact evidence' }))

    try {
      const result = await executeProcessModelAttempt({
        command: process.execPath,
        args: [stagedChild],
        cwd: repositoryRoot,
        environment: processEnvironment(port),
        envelope: modelEnvelope(),
        timeoutMs: 10_000,
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 64 * 1024,
        dispatchToolCall,
      })

      expect(result.kind).toBe('model-outcome')
      if (result.kind !== 'model-outcome') throw new Error(`expected model outcome, got ${result.reason}`)
      expect(decodeStagedFinalAnswer(result.finalAnswer)).toEqual({
        transportStatus: 'ok',
        structuredContent: resultPayload,
      })
      expect(result.providerMetadata).toMatchObject({
        completionId: 'completion-2',
        finishReason: 'tool_calls',
        responseModel: 'deepseek-v4-flash',
        inputTokens: 22,
        outputTokens: 7,
      })
      expect(dispatchToolCall).toHaveBeenCalledTimes(1)
      expect(dispatchToolCall).toHaveBeenCalledWith({
        id: 'completion-1-tool',
        name: 'ordinary_read',
        input: { path: 'README.md' },
      })
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        expect(request.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual([
          'ordinary_read',
          STAGED_RESULT_TOOL_NAME,
        ])
        expect(request.tools[1].function.strict).toBe(true)
      }
      const secondRequest = requests[1]
      if (secondRequest === undefined) throw new Error('expected second provider request')
      expect(secondRequest.messages).toContainEqual({
        role: 'tool',
        tool_call_id: 'completion-1-tool',
        content: JSON.stringify({ text: 'exact evidence' }),
      })
    } finally {
      await close(server)
    }
  })

  it('recovers one prose final through a single measurement-only named-tool finalization turn without prose parsing', async () => {
    const requests: Array<Record<string, any>> = []
    const resultPayload = {
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId: 'task-01',
      claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
    }
    const responses = [
      completion('completion-1', 'ordinary_read', { path: 'README.md' }, 10, 3),
      proseCompletion('completion-2', 'The exact target exposes Scope.', 12, 4),
      completion('completion-3', STAGED_RESULT_TOOL_NAME, resultPayload, 14, 5),
    ]
    const server = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += String(chunk) })
      request.on('end', () => {
        requests.push(JSON.parse(body) as Record<string, any>)
        const next = responses.shift()
        if (next === undefined) {
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'unexpected request' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(next))
      })
    })
    const port = await listen(server)
    const dispatchToolCall = vi.fn(async () => ({ text: 'exact evidence' }))

    try {
      const result = await executeProcessModelAttempt({
        command: process.execPath,
        args: [stagedChild],
        cwd: repositoryRoot,
        environment: processEnvironment(port),
        envelope: modelEnvelope(),
        timeoutMs: 10_000,
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 64 * 1024,
        dispatchToolCall,
      })

      expect(result.kind).toBe('model-outcome')
      if (result.kind !== 'model-outcome') throw new Error(`expected model outcome, got ${result.reason}`)
      expect(decodeStagedFinalAnswer(result.finalAnswer)).toEqual({
        transportStatus: 'ok',
        structuredContent: resultPayload,
      })
      expect(result.providerMetadata).toMatchObject({
        completionId: 'completion-3',
        finishReason: 'structured_measurement_forced',
        responseModel: 'deepseek-v4-flash',
        inputTokens: 36,
        outputTokens: 12,
      })
      expect(dispatchToolCall).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(3)

      const forcedRequest = requests[2]
      if (forcedRequest === undefined) throw new Error('expected forced finalization request')
      expect(forcedRequest.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual([STAGED_RESULT_TOOL_NAME])
      expect(forcedRequest.tools[0].function.strict).toBe(true)
      expect(forcedRequest.tool_choice).toEqual({
        type: 'function',
        function: { name: STAGED_RESULT_TOOL_NAME },
      })
      expect(forcedRequest.messages).toContainEqual({ role: 'assistant', content: 'The exact target exposes Scope.' })
      expect(forcedRequest.messages.at(-1)).toMatchObject({
        role: 'user',
        content: expect.stringContaining(STAGED_RESULT_TOOL_NAME),
      })
    } finally {
      await close(server)
    }
  })
})
