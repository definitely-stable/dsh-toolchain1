import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentExecutor } from '../../scripts/eval/m2-development-executor.mjs'
import { encodeStagedToolResult } from '../../scripts/eval/staged-provider-transport.mjs'

const PROBE = Object.freeze({
  schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
  provider: 'opencode-go',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  requestModel: 'deepseek-v4-flash',
  responseModel: 'deepseek-v4-flash',
  systemFingerprint: 'fp_staged_fixture',
  thinking: 'enabled',
  reasoningEffort: 'high',
  functionToolCall: 'verified',
  reasoningContinuation: 'verified',
  tokenMeasurement: 'verified',
  backendIdentityStrength: 'system-fingerprint',
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
const frozen = Object.freeze({
  workspace: Object.freeze({ workspaceSnapshotSha256: 'workspace' }),
  capabilityManifests: Object.freeze({ A: { arm: 'A' }, B: manifestB, C: manifestC }),
})

function fakeRuntime(captured: Array<Record<string, unknown>>) {
  return {
    createFrozenP0Inputs: vi.fn(async () => frozen),
    createModelEnvelope: vi.fn((input: Record<string, any>) => ({
      schema: 'dsh-toolchain-m2-model-envelope-v1',
      systemPrompt: input.systemPrompt,
      task: input.task,
      staticContext: input.staticContext,
      tools: input.capabilityManifest.tools,
    })),
    createFrozenP0ToolRuntime: vi.fn(async () => ({
      dispatchToolCall: async () => ({ ok: true }),
      traceReceipt: async () => ({ entries: [] }),
    })),
    executeProcessModelAttempt: vi.fn(async (input: Record<string, unknown>) => {
      captured.push(input)
      return {
        kind: 'model-outcome' as const,
        finalAnswer: encodeStagedToolResult({
          schema: 'dsh-toolchain-staged-eval-result-v1',
          taskId: 'task-01',
          claims: [{ package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists' }],
        }),
        providerMetadata: {
          completionId: 'completion-1',
          finishReason: 'tool_calls',
          responseModel: 'deepseek-v4-flash',
          inputTokens: 20,
          outputTokens: 5,
        },
      }
    }),
  }
}

describe('staged development executor factory', () => {
  it('contains no historical H1 run-store write dependency', async () => {
    const source = await readFile(path.resolve(import.meta.dirname, '../../scripts/eval/m2-development-executor.mjs'), 'utf8')
    expect(source).not.toMatch(/m2-h1-run-store|run-m2-h1|m2:h1:run|finalize-m2-h1/u)
    expect(source).toContain('staged-provider-executor.mjs')
    expect(source).toContain('m2-opencode-go-staged-child.mjs')
  })

  it('binds the verified OpenCode Go probe to the exact B/C runtime and disposes compiled state', async () => {
    const captured: Array<Record<string, unknown>> = []
    const runtime = fakeRuntime(captured)
    const removeRuntime = vi.fn(async () => undefined)
    const compileEvaluationRuntime = vi.fn(async () => '/tmp/staged-runtime')
    const importEvaluationRuntime = vi.fn(async () => runtime)
    const readProbe = vi.fn(async () => Buffer.from(JSON.stringify(PROBE), 'utf8'))

    const owned = await createDevelopmentExecutor({
      environment: {
        OPENCODE_API_KEY: 'test-only',
        M2_STAGED_PROVIDER_PROBE: 'probe.json',
      },
      services: { readProbe, compileEvaluationRuntime, importEvaluationRuntime, removeRuntime },
    })

    const result = await owned.execute(
      { ordinal: 1, taskId: 'task-01', arm: 'C', repetition: 1 },
      { id: 'task-01', prompt: 'Which public API should I use?' },
    )
    expect(result).toMatchObject({ transportStatus: 'ok', attempts: 1 })
    expect(runtime.createFrozenP0Inputs).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-flash',
      expectedResponseModel: 'deepseek-v4-flash',
      expectedSystemFingerprint: 'fp_staged_fixture',
    }))
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      command: process.execPath,
      cwd: path.resolve(import.meta.dirname, '../..'),
      environment: expect.objectContaining({
        OPENCODE_API_KEY: 'test-only',
        OPENCODE_GO_BASE_URL: 'https://opencode.ai/zen/go/v1',
        OPENCODE_GO_REQUEST_MODEL: 'deepseek-v4-flash',
        OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-flash',
        OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT: 'fp_staged_fixture',
        OPENCODE_GO_THINKING: 'enabled',
        OPENCODE_GO_REASONING_EFFORT: 'high',
      }),
    })
    expect((captured[0]!.args as string[]).at(-1)).toMatch(/m2-opencode-go-staged-child\.mjs$/u)

    await owned.dispose()
    expect(removeRuntime).toHaveBeenCalledOnce()
    expect(removeRuntime).toHaveBeenCalledWith('/tmp/staged-runtime')
  })

  it('fails before compilation when the staged probe path is missing', async () => {
    const compileEvaluationRuntime = vi.fn(async () => '/tmp/should-not-exist')
    await expect(createDevelopmentExecutor({
      environment: { OPENCODE_API_KEY: 'test-only' },
      services: {
        readProbe: async () => Buffer.from(JSON.stringify(PROBE), 'utf8'),
        compileEvaluationRuntime,
        importEvaluationRuntime: async () => fakeRuntime([]),
        removeRuntime: async () => undefined,
      },
    })).rejects.toThrow(/M2_STAGED_PROVIDER_PROBE/u)
    expect(compileEvaluationRuntime).not.toHaveBeenCalled()
  })
})
