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
  return (server.address() as AddressInfo).port
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}

function modelEnvelope(): ModelEnvelope {
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: 'Use exact-target evidence. Conclude with one concrete API existence or absence claim.',
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

function serve(responses: unknown[], requests: Array<Record<string, any>>) {
  return createServer((request, response) => {
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
}

describe('staged OpenCode Go child process boundary', () => {
  it('keeps product exploration and strict measurement finalization in separate provider requests', async () => {
    const requests: Array<Record<string, any>> = []
    const measurementInput = {
      claim: { package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' },
    }
    const server = serve([
      completion('completion-1', 'ordinary_read', { path: 'README.md' }, 10, 3),
      proseCompletion('completion-2', 'The exact target exposes Scope.', 12, 4),
      completion('completion-3', STAGED_RESULT_TOOL_NAME, measurementInput, 14, 5),
    ], requests)
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
      if (result.kind !== 'model-outcome') throw new Error(`expected model outcome, got ${result.reason}: ${result.detail}`)
      expect(decodeStagedFinalAnswer(result.finalAnswer)).toEqual({
        transportStatus: 'ok',
        structuredContent: {
          schema: 'dsh-toolchain-staged-eval-result-v1',
          taskId: 'task-01',
          claims: [measurementInput.claim],
        },
        transportMetrics: {
          providerCompletions: 3,
          measurementToolCalls: 1,
        },
      })
      expect(result.providerMetadata).toMatchObject({
        completionId: 'completion-3',
        finishReason: 'structured_measurement_finalized',
        responseModel: 'deepseek-v4-flash',
        inputTokens: 36,
        outputTokens: 12,
      })
      expect(result.providerMetadata).not.toHaveProperty('providerCompletions')
      expect(result.providerMetadata).not.toHaveProperty('measurementToolCalls')
      expect(dispatchToolCall).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(3)

      for (const request of requests.slice(0, 2)) {
        expect(request.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual(['ordinary_read'])
        expect(request.tools.some((tool: Record<string, any>) => tool.function.name === STAGED_RESULT_TOOL_NAME)).toBe(false)
        expect(request.tool_choice).toBeUndefined()
      }

      const finalization = requests[2]
      if (finalization === undefined) throw new Error('expected finalization request')
      expect(finalization.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual([STAGED_RESULT_TOOL_NAME])
      expect(finalization.tools[0].function.strict).toBe(true)
      expect(finalization.tool_choice).toEqual({
        type: 'function',
        function: { name: STAGED_RESULT_TOOL_NAME },
      })
      expect(finalization.messages).toContainEqual({ role: 'assistant', content: 'The exact target exposes Scope.' })
      expect(finalization.messages.at(-1)).toMatchObject({
        role: 'user',
        content: expect.stringContaining(STAGED_RESULT_TOOL_NAME),
      })
      expect(JSON.stringify(finalization.tools[0].function.parameters)).not.toContain('taskId')
      expect(JSON.stringify(finalization.messages)).not.toContain('task-01')
    } finally {
      await close(server)
    }
  })

  it('finalizes an immediate product conclusion through the same measurement-only path', async () => {
    const requests: Array<Record<string, any>> = []
    const server = serve([
      proseCompletion('completion-1', 'Scope is absent on this target.', 8, 3),
      completion('completion-2', STAGED_RESULT_TOOL_NAME, {
        claim: { package: '*', symbol: 'Scope', assertion: 'absent' },
      }, 9, 4),
    ], requests)
    const port = await listen(server)

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
        dispatchToolCall: vi.fn(async () => ({ text: 'unused' })),
      })

      expect(result.kind).toBe('model-outcome')
      if (result.kind !== 'model-outcome') throw new Error(`expected model outcome, got ${result.reason}: ${result.detail}`)
      expect(decodeStagedFinalAnswer(result.finalAnswer)).toEqual({
        transportStatus: 'ok',
        structuredContent: {
          schema: 'dsh-toolchain-staged-eval-result-v1',
          taskId: 'task-01',
          claims: [{ package: '*', symbol: 'Scope', assertion: 'absent' }],
        },
        transportMetrics: {
          providerCompletions: 2,
          measurementToolCalls: 1,
        },
      })
      expect(requests).toHaveLength(2)
      expect(requests[0]?.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual(['ordinary_read'])
      expect(requests[1]?.tools.map((tool: Record<string, any>) => tool.function.name)).toEqual([STAGED_RESULT_TOOL_NAME])
    } finally {
      await close(server)
    }
  })
})
