import { describe, expect, it, vi } from 'vitest'

import {
  createStagedProviderExecutor,
  STAGED_DEVELOPMENT_SYSTEM_PROMPT,
} from '../../scripts/eval/staged-provider-executor.mjs'
import { encodeStagedToolResult } from '../../scripts/eval/staged-provider-transport.mjs'

const call = Object.freeze({ ordinal: 1, taskId: 'task-01', arm: 'B' as const, repetition: 1 as const })
const task = Object.freeze({
  id: 'task-01',
  domain: 'scope-lifecycle',
  prompt: 'Which public API should I use?',
  successRule: Object.freeze({ kind: 'api-exists-any', package: '@deepseek-ai/dsh-scope', symbols: ['Scope'] }),
})

const manifestB = Object.freeze({
  schema: 'dsh-toolchain-m2-capability-manifest-v1',
  arm: 'B' as const,
  ordinaryEvidence: Object.freeze({ marker: 'exact-workspace' }),
  tools: Object.freeze([{ family: 'ordinary', name: 'ordinary_read', description: 'read', inputSchema: { type: 'object' } }]),
})
const manifestC = Object.freeze({
  ...manifestB,
  arm: 'C' as const,
  tools: Object.freeze([
    ...manifestB.tools,
    { family: 'toolchain', name: 'toolchain_contract_search', description: 'search', inputSchema: { type: 'object' } },
    { family: 'toolchain', name: 'toolchain_contract_inspect', description: 'inspect', inputSchema: { type: 'object' } },
  ]),
})

function frozen() {
  return {
    workspace: Object.freeze({ workspaceSnapshotSha256: 'workspace', documentationSha256: 'docs' }),
    capabilityManifests: Object.freeze({ B: manifestB, C: manifestC }),
  }
}

function providerOutcome(taskId = task.id) {
  return {
    kind: 'model-outcome' as const,
    finalAnswer: encodeStagedToolResult({
      schema: 'dsh-toolchain-staged-eval-result-v1',
      taskId,
      claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
    }),
    providerMetadata: {
      completionId: 'completion-1',
      finishReason: 'tool_calls',
      responseModel: 'deepseek-v4-flash',
      inputTokens: 120,
      outputTokens: 30,
    },
  }
}

function runtimeWith(results: Array<Record<string, unknown>>) {
  const executeProcessModelAttempt = vi.fn(async () => {
    const next = results.shift()
    if (next === undefined) throw new Error('unexpected extra process attempt')
    return next
  })
  const createFrozenP0ToolRuntime = vi.fn(async () => ({
    dispatchToolCall: vi.fn(async () => ({ ok: true })),
    traceReceipt: vi.fn(async () => ({ entries: [{ name: 'ordinary_read' }] })),
  }))
  const createModelEnvelope = vi.fn((input: Record<string, any>) => ({
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: input.systemPrompt,
    task: input.task,
    staticContext: input.staticContext,
    tools: input.capabilityManifest.tools,
  }))
  return { executeProcessModelAttempt, createFrozenP0ToolRuntime, createModelEnvelope }
}

function executor(runtime: ReturnType<typeof runtimeWith>) {
  return createStagedProviderExecutor({
    frozen: frozen(),
    runtime,
    processConfiguration: {
      command: process.execPath,
      args: ['staged-child.mjs'],
      cwd: process.cwd(),
      environment: { OPENCODE_API_KEY: 'test-only' },
      timeoutMs: 300_000,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 64 * 1024,
    },
    sha256Utf8: async value => `sha:${value}`,
  })
}

describe('staged real provider executor adapter', () => {
  it('uses the exact B/C capability manifest and decodes the explicit structured-result transport', async () => {
    const runtime = runtimeWith([providerOutcome()])
    const execute = executor(runtime)

    const result = await execute(call, task)

    expect(result).toMatchObject({
      transportStatus: 'ok',
      attempts: 1,
      infrastructureFailures: 0,
      usage: { inputTokens: 120, outputTokens: 30, turns: 2 },
      toolUsage: { calls: 1, structuredTransportCalls: 1 },
    })
    expect(result.structuredContent).toMatchObject({ taskId: 'task-01' })
    expect(runtime.createModelEnvelope).toHaveBeenCalledWith({
      systemPrompt: STAGED_DEVELOPMENT_SYSTEM_PROMPT,
      task: { id: 'task-01', prompt: task.prompt },
      staticContext: [],
      capabilityManifest: manifestB,
    })
    expect(runtime.createFrozenP0ToolRuntime).toHaveBeenCalledTimes(1)
    expect(runtime.createFrozenP0ToolRuntime.mock.calls[0]?.[1]).toBe(frozen().workspace)
  })

  it('retries one quality-independent infrastructure failure and reports it as cost', async () => {
    const runtime = runtimeWith([
      { kind: 'infrastructure-failure', reason: 'provider-transport', detail: 'temporary' },
      providerOutcome(),
    ])
    const execute = executor(runtime)

    const result = await execute(call, task)

    expect(result).toMatchObject({
      transportStatus: 'ok',
      attempts: 2,
      infrastructureFailures: 1,
      usage: { inputTokens: 120, outputTokens: 30, turns: 2 },
    })
    expect(runtime.executeProcessModelAttempt).toHaveBeenCalledTimes(2)
    expect(runtime.createFrozenP0ToolRuntime).toHaveBeenCalledTimes(2)
    expect(runtime.createFrozenP0ToolRuntime.mock.calls[0]?.[0]).not.toBe(runtime.createFrozenP0ToolRuntime.mock.calls[1]?.[0])
  })

  it('fails closed after the one authorized infrastructure retry', async () => {
    const runtime = runtimeWith([
      { kind: 'infrastructure-failure', reason: 'provider-transport', detail: 'temporary-1' },
      { kind: 'infrastructure-failure', reason: 'timeout', detail: 'temporary-2' },
    ])
    const execute = executor(runtime)

    await expect(execute(call, task)).resolves.toMatchObject({
      transportStatus: 'infrastructure-failure',
      attempts: 2,
      infrastructureFailures: 2,
    })
    expect(runtime.executeProcessModelAttempt).toHaveBeenCalledTimes(2)
  })

  it('rejects arm A instead of silently broadening the experiment', async () => {
    const runtime = runtimeWith([providerOutcome()])
    const execute = executor(runtime)

    await expect(execute({ ...call, arm: 'A' } as never, task)).rejects.toThrow(/B\/C only/i)
    expect(runtime.executeProcessModelAttempt).not.toHaveBeenCalled()
  })
})
