import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createInlineContentRef,
  createResourceReceipt,
  createTraceReceipt,
  validateContentRef,
  validateExecutorModelOutcome,
  validateIsolationReceipt,
  validateResourceReceipt,
  validateTraceReceipt,
  type IsolationReceipt,
  type RunnerToolTraceEntry,
} from './m2-agent-execution-evidence.js'

const CONTROL = 'a'.repeat(64)

async function toolEntry(
  family: 'ordinary' | 'toolchain',
  name: string,
  sequence = 1,
): Promise<RunnerToolTraceEntry> {
  const sha256 = createNodeSha256Port()
  return {
    sequence,
    family,
    name,
    startedAt: '2026-08-28T08:00:00.000Z',
    completedAt: '2026-08-28T08:00:01.000Z',
    status: 'ok',
    request: await createInlineContentRef(
      JSON.stringify({ input: name }),
      'application/json',
      'utf8-bytes-v1',
      sha256,
    ),
    response: await createInlineContentRef(
      JSON.stringify({ output: 'ok' }),
      'application/json',
      'utf8-bytes-v1',
      sha256,
    ),
  }
}

function isolatedReceipt(overrides: Partial<IsolationReceipt> = {}): IsolationReceipt {
  return {
    schema: 'dsh-toolchain-m2-isolation-v1',
    runControlSha256: CONTROL,
    sessionIdSha256: 'b'.repeat(64),
    freshModelSession: true,
    memoryCarryover: false,
    workspaceMode: 'read-only-reset',
    workspaceSnapshotSha256: 'c'.repeat(64),
    toolStateReset: true,
    ordinaryEvidenceSha256: 'd'.repeat(64),
    mutableEnvironmentIdSha256: 'e'.repeat(64),
    parallelMutableStateShared: false,
    retrySessionPolicy: 'fresh-session-per-attempt',
    ...overrides,
  }
}

describe('M2.3 runner-owned execution evidence', () => {
  it('rejects executor attempts to self-report runner-owned tool/isolation/resource evidence', () => {
    const valid = {
      outcome: 'model-outcome',
      finalAnswer: 'Use the exact target API.',
      providerMetadata: {
        completionId: 'completion-1',
        finishReason: 'stop',
        inputTokens: 42,
        outputTokens: 17,
      },
    }

    expect(() => validateExecutorModelOutcome(valid)).not.toThrow()

    for (const forbidden of [
      { toolEvents: [] },
      { sessionIsolation: 'isolated' },
      { startedAt: '2026-08-28T08:00:00.000Z' },
      { resourceCompliance: 'compliant' },
      { infrastructureFailureReason: 'provider-transport' },
    ]) {
      expect(() => validateExecutorModelOutcome({ ...valid, ...forbidden })).toThrow(/executor|runner-owned|field/i)
    }
  })

  it('keeps content hashes auditable by retaining and re-hashing the exact bytes', async () => {
    const sha256 = createNodeSha256Port()
    const ref = await createInlineContentRef(
      '{"query":"defineTool"}',
      'application/json',
      'utf8-bytes-v1',
      sha256,
    )

    expect(ref.byteLength).toBe(Buffer.byteLength(ref.inline, 'utf8'))
    await expect(validateContentRef(ref, sha256)).resolves.toBeUndefined()
    await expect(validateContentRef({ ...ref, inline: '{"query":"changed"}' }, sha256)).rejects.toThrow(/hash|byte/i)
    await expect(validateContentRef({ ...ref, byteLength: ref.byteLength + 1 }, sha256)).rejects.toThrow(/byte/i)
  })

  it('enforces arm tool policy from runner-owned traces', async () => {
    const sha256 = createNodeSha256Port()
    const ordinary = await toolEntry('ordinary', 'read_file')
    const search = await toolEntry('toolchain', 'toolchain_contract_search')
    const inspect = await toolEntry('toolchain', 'toolchain_contract_inspect', 2)

    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [], sha256), 'A', sha256))
      .resolves.toBeUndefined()
    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [ordinary], sha256), 'A', sha256))
      .rejects.toThrow(/arm A|tool/i)

    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [ordinary], sha256), 'B', sha256))
      .resolves.toBeUndefined()
    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [search], sha256), 'B', sha256))
      .rejects.toThrow(/arm B|Toolchain/i)

    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [search, inspect], sha256), 'C', sha256))
      .resolves.toBeUndefined()
    const extra = await toolEntry('toolchain', 'toolchain_contract_extra')
    await expect(validateTraceReceipt(await createTraceReceipt(CONTROL, [extra], sha256), 'C', sha256))
      .rejects.toThrow(/Toolchain|search|inspect/i)
  })

  it('fails isolation when the runner cannot prove fresh-session and reset invariants', () => {
    expect(() => validateIsolationReceipt(isolatedReceipt())).not.toThrow()

    const invalid: IsolationReceipt[] = [
      isolatedReceipt({ freshModelSession: false as true }),
      isolatedReceipt({ memoryCarryover: true as false }),
      isolatedReceipt({ toolStateReset: false as true }),
      isolatedReceipt({ parallelMutableStateShared: true as false }),
      isolatedReceipt({ retrySessionPolicy: 'reuse-session' as 'fresh-session-per-attempt' }),
    ]
    for (const receipt of invalid) {
      expect(() => validateIsolationReceipt(receipt)).toThrow(/isolation|fresh|carry|reset|shared|retry/i)
    }
  })

  it('separates configured resources from observations and refuses unverifiable required token limits', async () => {
    const sha256 = createNodeSha256Port()
    const policy = {
      maxWallTimeMs: 120_000,
      maxTurns: 20,
      maxAttempts: 3,
      concurrency: 1,
      maxInputTokens: 24_000,
      maxOutputTokens: 4_000,
      tokenMeasurementRequired: true,
    }

    const compliant = await createResourceReceipt(
      CONTROL,
      policy,
      { wallTimeMs: 15_000, turns: 3, attempts: 1, inputTokens: 1_000, outputTokens: 200 },
      { wallTime: 'runner', turns: 'runner', tokens: 'provider-reported' },
      sha256,
    )
    expect(compliant.compliance).toBe('compliant')
    await expect(validateResourceReceipt(compliant, sha256)).resolves.toBeUndefined()

    const unavailable = await createResourceReceipt(
      CONTROL,
      policy,
      { wallTimeMs: 15_000, turns: 3, attempts: 1 },
      { wallTime: 'runner', turns: 'runner', tokens: 'unavailable' },
      sha256,
    )
    expect(unavailable.compliance).toBe('unverifiable')

    const exceeded = await createResourceReceipt(
      CONTROL,
      policy,
      { wallTimeMs: 130_000, turns: 3, attempts: 1, inputTokens: 1_000, outputTokens: 200 },
      { wallTime: 'runner', turns: 'runner', tokens: 'provider-reported' },
      sha256,
    )
    expect(exceeded.compliance).toBe('non-compliant')
  })
})
