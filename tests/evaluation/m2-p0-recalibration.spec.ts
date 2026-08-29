import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import {
  createModelEnvelope,
  type ContentRef,
  type ResourcePolicy,
  type TraceReceipt,
} from './m2-agent-execution-evidence.js'
import { createFrozenP0CapabilityManifests } from './m2-agent-ordinary-broker.js'
import { createOrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import {
  createFrozenP0Inputs,
  type FrozenP0ProviderIdentity,
} from './m2-agent-p0-definition.js'
import { createFrozenP0ToolRuntime } from './m2-agent-p0-tool-runtime.js'
import { executeProcessAttemptWithEvidence } from './m2-agent-process-runner.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

const INVALID_TOOL_EXECUTOR = fileURLToPath(new URL(
  './fixtures/process-executor/invalid-tool-recovery.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()
const PROBE_SHA256 = 'a'.repeat(64)

const DEEPSEEK_PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'deepseek',
  requestModel: 'deepseek-v4-pro',
  reviewedSnapshot: 'fixture-pro',
  expectedResponseModel: 'deepseek-v4-pro',
  expectedSystemFingerprint: 'fp_fixture',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://api.deepseek.com',
  adapterVersion: 'deepseek-chat-v1',
})

const FLASH_PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'opencode-go',
  requestModel: 'deepseek-v4-flash',
  reviewedSnapshot: `opencode-go-probe:${PROBE_SHA256}`,
  expectedResponseModel: 'deepseek-v4-flash',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  providerProbeSha256: PROBE_SHA256,
})

async function workspace() {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
    },
    packages: [{ name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' }],
    files: [{
      path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
      mediaType: 'application/json',
      content: '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n',
    }],
  }, sha256)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function contentRef(value: unknown, label: string): ContentRef {
  return record(value, label) as unknown as ContentRef
}

describe('M2.3 P0 live calibration corrections', () => {
  it('returns model-authored invalid available-tool calls as in-session tool errors instead of tool-transport failure', async () => {
    const frozen = await workspace()
    const toolchain = await createFrozenToolchainBroker('0'.repeat(64))
    const capabilityManifest = createFrozenP0CapabilityManifests(frozen, toolchain).B
    const modelEnvelope = createModelEnvelope({
      systemPrompt: 'Use only exact-target evidence.',
      task: { id: 'p0-invalid-tool-recovery', prompt: 'Recover from one invalid read_file call.' },
      staticContext: [],
      capabilityManifest,
    })
    const resourcePolicy: ResourcePolicy = {
      maxWallTimeMs: 300000,
      maxTurns: 24,
      maxAttempts: 2,
      concurrency: 1,
      maxInputTokens: 150000,
      maxOutputTokens: 12000,
      tokenMeasurementRequired: true,
    }

    const result = await executeProcessAttemptWithEvidence({
      identity: {
        evaluationId: 'm2-p0-invalid-tool-recovery',
        phase: 'P0',
        taskId: modelEnvelope.task.id,
        arm: 'B',
        trial: 1,
        attempt: 1,
        targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
        contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
        datasetCommitmentSha256: '6'.repeat(64),
      },
      capabilityManifest,
      resourcePolicy,
      retryPolicy: {
        maxInfrastructureRetries: 1,
        modelOutcomeRetries: 0,
        retryableReasons: ['provider-transport', 'tool-transport'],
      },
      executorIdentity: { provider: 'fixture', model: 'fixture-model', snapshot: 'fixture' },
      modelEnvelope,
      isolation: {
        sessionIdSha256: '7'.repeat(64),
        workspaceMode: 'read-only-reset',
        workspaceSnapshotSha256: frozen.workspaceSnapshotSha256,
        ordinaryEvidenceSha256: frozen.documentationSha256,
        mutableEnvironmentIdSha256: '8'.repeat(64),
      },
      process: {
        command: process.execPath,
        args: [INVALID_TOOL_EXECUTOR],
        cwd: process.cwd(),
        environment: { PATH: process.env.PATH ?? '' },
        timeoutMs: 5000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      },
      createToolRuntime: runControlSha256 => createFrozenP0ToolRuntime(runControlSha256, frozen),
      sha256,
    })

    expect(result.attempt.outcome).toBe('model-outcome')
    if (result.attempt.outcome !== 'model-outcome') throw new Error(`expected model outcome, got ${result.attempt.outcome}`)
    expect(result.attempt.rawAnswer.inline).toContain('Recovered after bounded model tool error')

    const trace = JSON.parse(result.attempt.executionEvidence.trace.inline) as TraceReceipt
    expect(trace.entries).toHaveLength(1)
    expect(trace.entries[0]).toMatchObject({ family: 'ordinary', name: 'read_file', status: 'error' })
    expect(JSON.parse(trace.entries[0]!.response.inline)).toEqual({
      error: {
        code: 'MODEL_TOOL_CALL_INVALID',
        message: 'read_file path must stay under /exact-target',
      },
    })
  })

  it('re-freezes only the P0 calibration resource envelope around observed live-run needs', async () => {
    const inputs = await createFrozenP0Inputs(DEEPSEEK_PROVIDER)
    const definition = record(inputs.definition, 'P0 definition')
    expect(definition.resources).toEqual({
      maxTurns: 24,
      maxInputTokens: 150000,
      maxOutputTokens: 12000,
      wallTimeMs: 300000,
      concurrency: 1,
    })
    const execution = record(definition.execution, 'P0 execution')
    expect(JSON.parse(contentRef(execution.resourcePolicy, 'resource policy').inline)).toEqual({
      maxWallTimeMs: 300000,
      maxTurns: 24,
      maxAttempts: 2,
      concurrency: 1,
      maxInputTokens: 150000,
      maxOutputTokens: 12000,
      tokenMeasurementRequired: true,
    })
  })

  it('accepts exact OpenCode Go DeepSeek V4 Flash identity for the recalibrated P0', async () => {
    const inputs = await createFrozenP0Inputs(FLASH_PROVIDER)
    const execution = record(inputs.definition.execution, 'P0 execution')
    const executor = JSON.parse(contentRef(execution.executorIdentity, 'executor identity').inline) as Record<string, unknown>
    expect(executor.requestModel).toBe('deepseek-v4-flash')
    expect(executor.expectedResponseModel).toBe('deepseek-v4-flash')
    expect(executor.reviewedSnapshot).toBe(`opencode-go-probe:${PROBE_SHA256}`)
  })
})
