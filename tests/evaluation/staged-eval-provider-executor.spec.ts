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
  tools: Object.freeze([
    { family: 'ordinary', name: 'read_file', description: 'read', inputSchema: { type: 'object' } },
    { family: 'ordinary', name: 'search_text', description: 'search', inputSchema: { type: 'object' } },
  ]),
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
const exactWorkspace = Object.freeze({ workspaceSnapshotSha256: 'workspace', documentationSha256: 'docs' })
const frozenRuntime = Object.freeze({
  workspace: exactWorkspace,
  capabilityManifests: Object.freeze({ B: manifestB, C: manifestC }),
})

type ProcessResult =
  | ReturnType<typeof providerOutcome>
  | { kind: 'infrastructure-failure'; reason: string; detail: string }

type ProcessInput = {
  dispatchToolCall(request: { id: string; name: string; input: unknown }): Promise<unknown>
}

type EnvelopeInput = {
  systemPrompt: string
  task: { id: string; prompt: string }
  staticContext: readonly unknown[]
  capabilityManifest: typeof manifestB | typeof manifestC
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

function familyOf(name: string): 'ordinary' | 'toolchain' {
  return name.startsWith('toolchain_') ? 'toolchain' : 'ordinary'
}

function runtimeWith(sourceResults: ProcessResult[], productToolNames: string[] = ['read_file']) {
  const results = [...sourceResults]
  const runtimeSeeds: string[] = []
  const runtimeWorkspaces: unknown[] = []
  const envelopes: EnvelopeInput[] = []

  const executeProcessModelAttempt = vi.fn(async (input: ProcessInput) => {
    const next = results.shift()
    if (next === undefined) throw new Error('unexpected extra process attempt')
    if (next.kind === 'model-outcome') {
      for (const [index, name] of productToolNames.entries()) {
        await input.dispatchToolCall({ id: `tool-${index + 1}`, name, input: {} })
      }
    }
    return next
  })
  const createFrozenP0ToolRuntime = vi.fn(async (seed: string, workspace: unknown) => {
    runtimeSeeds.push(seed)
    runtimeWorkspaces.push(workspace)
    const entries: Array<{ family: 'ordinary' | 'toolchain'; name: string }> = []
    return {
      dispatchToolCall: async (request: { name: string }) => {
        entries.push({ family: familyOf(request.name), name: request.name })
        return { ok: true }
      },
      traceReceipt: async () => ({ entries: [...entries] }),
    }
  })
  const createModelEnvelope = vi.fn((input: EnvelopeInput) => {
    envelopes.push(input)
    return {
      schema: 'dsh-toolchain-m2-model-envelope-v1',
      systemPrompt: input.systemPrompt,
      task: input.task,
      staticContext: input.staticContext,
      tools: input.capabilityManifest.tools,
    }
  })
  return {
    executeProcessModelAttempt,
    createFrozenP0ToolRuntime,
    createModelEnvelope,
    runtimeSeeds,
    runtimeWorkspaces,
    envelopes,
  }
}

function executor(runtime: ReturnType<typeof runtimeWith>) {
  return createStagedProviderExecutor({
    frozen: frozenRuntime,
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
    sha256Utf8: async (value: string) => `sha:${value}`,
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
      toolUsage: {
        calls: 1,
        structuredTransportCalls: 1,
        ordinaryCalls: 1,
        toolchainCalls: 0,
        byTool: {
          read_file: 1,
          search_text: 0,
          toolchain_contract_search: 0,
          toolchain_contract_inspect: 0,
        },
      },
    })
    if (result.transportStatus !== 'ok') throw new Error('expected structured transport success')
    expect(result.structuredContent).toMatchObject({ taskId: 'task-01' })
    expect(runtime.envelopes).toEqual([{
      systemPrompt: STAGED_DEVELOPMENT_SYSTEM_PROMPT,
      task: { id: 'task-01', prompt: task.prompt },
      staticContext: [],
      capabilityManifest: manifestB,
    }])
    expect(runtime.runtimeWorkspaces).toEqual([exactWorkspace])
  })

  it('preserves exact C-arm ordinary and Toolchain usage from the execution trace', async () => {
    const runtime = runtimeWith([providerOutcome()], [
      'search_text',
      'toolchain_contract_search',
      'toolchain_contract_inspect',
      'read_file',
      'toolchain_contract_search',
    ])
    const execute = executor(runtime)

    await expect(execute({ ...call, arm: 'C' }, task)).resolves.toMatchObject({
      transportStatus: 'ok',
      toolUsage: {
        calls: 5,
        ordinaryCalls: 2,
        toolchainCalls: 3,
        byTool: {
          read_file: 1,
          search_text: 1,
          toolchain_contract_search: 2,
          toolchain_contract_inspect: 1,
        },
      },
    })
  })

  it('preserves the closed terminal reason when a model outcome misses the structured measurement channel', async () => {
    const runtime = runtimeWith([{
      kind: 'model-outcome',
      finalAnswer: '',
      providerMetadata: {
        completionId: 'completion-unsupported',
        finishReason: 'structured_transport_unsupported',
        responseModel: 'deepseek-v4-flash',
        inputTokens: 140,
        outputTokens: 24,
      },
    }])
    const execute = executor(runtime)

    await expect(execute(call, task)).resolves.toMatchObject({
      transportStatus: 'unsupported',
      terminalTransportReason: 'structured_transport_unsupported',
      attempts: 1,
      infrastructureFailures: 0,
    })
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
    expect(runtime.runtimeSeeds).toHaveLength(2)
    expect(runtime.runtimeSeeds[0]).not.toBe(runtime.runtimeSeeds[1])
    expect(runtime.runtimeWorkspaces).toEqual([exactWorkspace, exactWorkspace])
  })

  it('fails closed after the one authorized infrastructure retry', async () => {
    const runtime = runtimeWith([
      { kind: 'infrastructure-failure', reason: 'provider-transport', detail: 'temporary-1' },
      { kind: 'infrastructure-failure', reason: 'tool-transport', detail: 'temporary-2' },
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
