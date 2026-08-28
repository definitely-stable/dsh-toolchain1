import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createModelEnvelope,
  createTraceReceipt,
  type CapabilityManifest,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { executeProcessAttemptWithEvidence } from './m2-agent-process-runner.js'

const INFRASTRUCTURE_ERROR_EXECUTOR = fileURLToPath(new URL(
  './fixtures/process-executor/infrastructure-error.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()

describe('M2.3 process attempt runner infrastructure classification', () => {
  it('projects provider transport into canonical v2 retry evidence and retains provider observations', async () => {
    const capabilityManifest: CapabilityManifest = {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'A',
      ordinaryEvidence: null,
      tools: [],
    }
    const modelEnvelope = createModelEnvelope({
      systemPrompt: 'Answer from memory only.',
      task: { id: 'p0-provider-transport', prompt: 'Identify the exact API.' },
      staticContext: [],
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
    let clock = Date.parse('2026-08-28T15:30:00.000Z')

    const result = await executeProcessAttemptWithEvidence({
      identity: {
        evaluationId: 'm2-agent-p0-v2-provider-transport',
        phase: 'P0',
        taskId: modelEnvelope.task.id,
        arm: 'A',
        trial: 1,
        attempt: 1,
        targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
        contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
        datasetCommitmentSha256: 'c'.repeat(64),
      },
      capabilityManifest,
      resourcePolicy,
      retryPolicy: {
        maxInfrastructureRetries: 1,
        modelOutcomeRetries: 0,
        retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'],
      },
      executorIdentity: { provider: 'fixture-provider', model: 'fixture-model', snapshot: 'fixture-snapshot' },
      modelEnvelope,
      isolation: {
        sessionIdSha256: 'd'.repeat(64),
        workspaceMode: 'fresh',
        workspaceSnapshotSha256: 'e'.repeat(64),
        ordinaryEvidenceSha256: 'f'.repeat(64),
        mutableEnvironmentIdSha256: '1'.repeat(64),
      },
      process: {
        command: process.execPath,
        args: [INFRASTRUCTURE_ERROR_EXECUTOR],
        cwd: process.cwd(),
        environment: { PATH: process.env.PATH ?? '' },
        timeoutMs: 5000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      },
      createToolRuntime: async runControlSha256 => ({
        dispatchToolCall: async request => {
          throw new Error(`unexpected tool request: ${request.name}`)
        },
        traceReceipt: () => createTraceReceipt(runControlSha256, [], sha256),
      }),
      sha256,
      now: () => {
        const current = clock
        clock += 1000
        return current
      },
    })

    expect(result.attempt.outcome).toBe('infrastructure-failure')
    if (result.attempt.outcome !== 'infrastructure-failure') {
      throw new Error(`expected infrastructure failure, got ${result.attempt.outcome}`)
    }
    expect(result.attempt.reason).toBe('provider-transport')
    expect(result.attempt.qualityIndependent).toBe(true)
    expect(result.attempt.partialOutput).toBeDefined()
    const retained = JSON.parse(result.attempt.partialOutput!.inline) as {
      providerMetadata?: { completionId?: string }
    }
    expect(retained.providerMetadata?.completionId).toBe('fixture-provider-transport-1')
  })
})
