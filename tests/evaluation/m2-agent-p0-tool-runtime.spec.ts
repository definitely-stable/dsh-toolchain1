import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import {
  createModelEnvelope,
  validateContentRef,
  validateTraceReceipt,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { createFrozenP0CapabilityManifests } from './m2-agent-ordinary-broker.js'
import { createOrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import { createFrozenP0ToolRuntime } from './m2-agent-p0-tool-runtime.js'
import { executeProcessAttemptWithEvidence } from './m2-agent-process-runner.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

const EXECUTOR = fileURLToPath(new URL(
  './fixtures/process-executor/ordinary-toolchain-roundtrip.mjs',
  import.meta.url,
))
const sha256 = createNodeSha256Port()

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
    packages: [
      { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
    ],
    files: [
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
        mediaType: 'application/json',
        content: '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        mediaType: 'text/plain',
        content: '# dsh-tools\nPublished rc.2 docs for dsh-tools.\n',
      },
    ],
  }, sha256)
}

describe('M2.3 composite P0 tool runtime', () => {
  it('runs ordinary read then production Toolchain search→inspect through one runner-owned trace', async () => {
    const frozen = await workspace()
    const definitionBroker = await createFrozenToolchainBroker('0'.repeat(64))
    const manifests = createFrozenP0CapabilityManifests(frozen, {
      searchTool: definitionBroker.searchTool,
      inspectTool: definitionBroker.inspectTool,
    })
    const capabilityManifest = manifests.C
    const modelEnvelope = createModelEnvelope({
      systemPrompt: 'Answer only from evidence available to this exact-target run.',
      task: {
        id: 'p0-composite-runtime',
        prompt: 'Use conventional exact-target evidence and Toolchain to verify the DSH tools package.',
      },
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
    const retryPolicy = {
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0 as const,
      retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'],
    }
    let clock = Date.parse('2026-08-28T16:00:00.000Z')

    const result = await executeProcessAttemptWithEvidence({
      identity: {
        evaluationId: 'm2-agent-p0-v2-composite',
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
        workspaceSnapshotSha256: frozen.workspaceSnapshotSha256,
        ordinaryEvidenceSha256: frozen.documentationSha256,
        mutableEnvironmentIdSha256: '8'.repeat(64),
      },
      process: {
        command: process.execPath,
        args: [EXECUTOR],
        cwd: process.cwd(),
        environment: { PATH: process.env.PATH ?? '' },
        timeoutMs: 5000,
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 16 * 1024,
      },
      createToolRuntime: runControlSha256 => createFrozenP0ToolRuntime(runControlSha256, frozen),
      sha256,
      now: () => {
        const current = clock
        clock += 1000
        return current
      },
    })

    expect(result.attempt.outcome).toBe('model-outcome')
    if (result.attempt.outcome !== 'model-outcome') throw new Error('expected model outcome')
    expect(result.attempt.rawAnswer.inline).toContain('Ordinary docs plus Toolchain verified')

    const trace = JSON.parse(result.attempt.executionEvidence.trace.inline) as {
      runControlSha256: string
      entries: Array<{ sequence: number; family: string; name: string; status: string }>
      traceSha256: string
    }
    expect(trace.entries.map(entry => [entry.sequence, entry.family, entry.name, entry.status])).toEqual([
      [1, 'ordinary', 'read_file', 'ok'],
      [2, 'toolchain', 'toolchain_contract_search', 'ok'],
      [3, 'toolchain', 'toolchain_contract_inspect', 'ok'],
    ])
    await expect(validateTraceReceipt(trace, 'C', sha256)).resolves.toBeUndefined()
    await expect(validateContentRef(result.attempt.executionEvidence.trace, sha256)).resolves.toBeUndefined()

    const resource = JSON.parse(result.attempt.executionEvidence.resourceReceipt.inline) as {
      observed: { turns: number }
    }
    expect(resource.observed.turns).toBe(4)
  })
})
