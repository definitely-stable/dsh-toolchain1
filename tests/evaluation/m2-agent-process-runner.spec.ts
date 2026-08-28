import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import {
  createModelEnvelope,
  validateContentRef,
  type CapabilityManifest,
  type ModelVisibleTool,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'
import { executeProcessAttemptWithEvidence } from './m2-agent-process-runner.js'

const TOOLCHAIN_EXECUTOR = fileURLToPath(new URL(
  './fixtures/process-executor/toolchain-roundtrip.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()

async function toolchainManifest(): Promise<CapabilityManifest> {
  const broker = await createFrozenToolchainBroker('0'.repeat(64))
  const readFile: ModelVisibleTool = {
    family: 'ordinary',
    name: 'read_file',
    description: 'Read one file from the frozen exact-target workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }
  return {
    schema: 'dsh-toolchain-m2-capability-manifest-v1',
    arm: 'C',
    ordinaryEvidence: {
      workspaceSnapshotSha256: 'a'.repeat(64),
      roots: ['/workspace/target'],
      readOnly: true,
      staticDocsSha256: 'b'.repeat(64),
      networkPolicy: 'offline',
      search: { backend: 'frozen-search', version: '1', maxResults: 20 },
    },
    tools: [
      readFile,
      {
        family: 'toolchain',
        name: broker.searchTool.name,
        description: broker.searchTool.description,
        inputSchema: broker.searchTool.parameters,
      },
      {
        family: 'toolchain',
        name: broker.inspectTool.name,
        description: broker.inspectTool.description,
        inputSchema: broker.inspectTool.parameters,
      },
    ],
  }
}

describe('M2.3 process attempt runner integration', () => {
  it('runs a C-arm search→inspect process and emits a complete runner-owned v2 attempt evidence chain', async () => {
    const capabilityManifest = await toolchainManifest()
    const modelEnvelope = createModelEnvelope({
      systemPrompt: 'Answer only from evidence available to the exact-target run.',
      task: {
        id: 'p0-process-toolchain',
        prompt: 'Find and inspect the contract that exposes ToolRuntimeScheduler.',
      },
      staticContext: [{ docs: 'frozen-rc2' }],
      capabilityManifest,
    })
    const resourcePolicy: ResourcePolicy = {
      maxWallTimeMs: 300000,
      maxTurns: 12,
      maxAttempts: 2,
      concurrency: 1,
      maxInputTokens: 30000,
      maxOutputTokens: 6000,
      tokenMeasurementRequired: true,
    }
    const retryPolicy = {
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0 as const,
      retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'],
    }
    let clock = Date.parse('2026-08-28T15:00:00.000Z')

    const result = await executeProcessAttemptWithEvidence({
      identity: {
        evaluationId: 'm2-agent-p0-v2-process',
        phase: 'P0',
        taskId: modelEnvelope.task.id,
        arm: 'C',
        trial: 1,
        attempt: 1,
        targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
        contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
        datasetCommitmentSha256: '6'.repeat(64),
      },
      capabilityManifest,
      resourcePolicy,
      retryPolicy,
      executorIdentity: {
        provider: 'fixture-provider',
        model: 'fixture-model',
        snapshot: 'fixture-snapshot',
      },
      modelEnvelope,
      isolation: {
        sessionIdSha256: '7'.repeat(64),
        workspaceMode: 'read-only-reset',
        workspaceSnapshotSha256: 'a'.repeat(64),
        ordinaryEvidenceSha256: 'b'.repeat(64),
        mutableEnvironmentIdSha256: '8'.repeat(64),
      },
      process: {
        command: process.execPath,
        args: [TOOLCHAIN_EXECUTOR],
        cwd: process.cwd(),
        environment: { PATH: process.env.PATH ?? '' },
        timeoutMs: 5000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      },
      createToolRuntime: async runControlSha256 => {
        const broker = await createFrozenToolchainBroker(runControlSha256)
        return {
          dispatchToolCall: async request => {
            if (request.name === broker.searchTool.name) return broker.searchTool.execute(request.input)
            if (request.name === broker.inspectTool.name) return broker.inspectTool.execute(request.input)
            throw new Error(`unexpected tool request: ${request.name}`)
          },
          traceReceipt: broker.traceReceipt,
        }
      },
      sha256,
      now: () => {
        const current = clock
        clock += 1000
        return current
      },
    })

    expect(result.attempt.outcome).toBe('model-outcome')
    expect(result.attempt.taskSuccess).toBe('UNKNOWN')
    expect(result.attempt.parsedApiClaims).toEqual([])
    expect(result.attempt.rawAnswer.inline).toContain('package:@deepseek-ai/dsh-tools')
    expect(result.attempt.providerMetadata.inline).toContain('fixture-toolchain-roundtrip-1')

    const trace = JSON.parse(result.attempt.executionEvidence.trace.inline) as {
      runControlSha256: string
      entries: Array<{ sequence: number; family: string; name: string; status: string }>
    }
    expect(trace.runControlSha256).toBe(result.frozen.runControl.sha256)
    expect(trace.entries).toHaveLength(2)
    expect(trace.entries.map(entry => entry.name)).toEqual([
      'toolchain_contract_search',
      'toolchain_contract_inspect',
    ])
    expect(trace.entries.every(entry => entry.family === 'toolchain' && entry.status === 'ok')).toBe(true)

    const resource = JSON.parse(result.attempt.executionEvidence.resourceReceipt.inline) as {
      observed: { turns: number; attempts: number; inputTokens?: number; outputTokens?: number }
      measurement: { wallTime: string; turns: string; tokens: string }
      compliance: string
    }
    expect(resource.observed).toMatchObject({
      turns: 3,
      attempts: 1,
      inputTokens: 120,
      outputTokens: 24,
    })
    expect(resource.measurement).toEqual({
      wallTime: 'runner',
      turns: 'runner',
      tokens: 'provider-reported',
    })
    expect(resource.compliance).toBe('compliant')

    const isolation = JSON.parse(result.attempt.executionEvidence.isolationReceipt.inline) as {
      runControlSha256: string
      freshModelSession: boolean
      memoryCarryover: boolean
      toolStateReset: boolean
    }
    expect(isolation).toMatchObject({
      runControlSha256: result.frozen.runControl.sha256,
      freshModelSession: true,
      memoryCarryover: false,
      toolStateReset: true,
    })

    for (const reference of [
      result.frozen.capabilityManifest,
      result.frozen.resourcePolicy,
      result.frozen.retryPolicy,
      result.frozen.executorIdentity,
      result.frozen.modelEnvelope,
      result.frozen.runControl,
      result.attempt.executionEvidence.trace,
      result.attempt.executionEvidence.isolationReceipt,
      result.attempt.executionEvidence.resourceReceipt,
      result.attempt.rawAnswer,
      result.attempt.providerMetadata,
    ]) {
      await expect(validateContentRef(reference, sha256)).resolves.toBeUndefined()
    }
  })
})
