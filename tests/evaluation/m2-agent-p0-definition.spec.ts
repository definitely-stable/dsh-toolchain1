import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createModelTask,
  validateCapabilityManifests,
  validateContentRef,
  type ContentRef,
} from './m2-agent-execution-evidence.js'
import {
  createFrozenP0Inputs,
  FROZEN_P0_SYSTEM_PROMPT,
  type FrozenP0ProviderIdentity,
} from './m2-agent-p0-definition.js'

const PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'deepseek',
  requestModel: 'deepseek-v4-pro',
  reviewedSnapshot: 'DeepSeek-V4-Pro-0813',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://api.deepseek.com',
  adapterVersion: 'deepseek-chat-v1',
})

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function contentRef(value: unknown, label: string): ContentRef {
  return record(value, label) as unknown as ContentRef
}

describe('M2.3 frozen P0 execution definition', () => {
  it('freezes the exact eight-task dataset into one deterministic 72-run balanced schedule', async () => {
    const first = await createFrozenP0Inputs(PROVIDER)
    const second = await createFrozenP0Inputs(PROVIDER)

    expect(first.dataset.taskCount).toBe(8)
    expect(first.dataset.tasks).toHaveLength(8)
    expect(new Set(first.dataset.tasks.map(task => task.id)).size).toBe(8)
    expect(first.schedule).toHaveLength(72)
    expect(new Set(first.schedule.map(entry => `${entry.taskId}/${entry.trial}/${entry.arm}`)).size).toBe(72)
    expect(first.schedule).toEqual(second.schedule)
    expect(first.definitionSha256).toBe(second.definitionSha256)

    const definition = record(first.definition, 'P0 definition')
    expect(definition.schema).toBe('dsh-toolchain-m2-agent-eval-v2')
    expect(definition.recordType).toBe('definition')
    expect(definition.phase).toBe('P0')
    expect(definition.status).toBe('PREREGISTERED')
    expect(record(definition.dataset, 'P0 definition dataset').taskCount).toBe(8)
    expect(record(definition.runOrder, 'P0 definition runOrder').schedule).toEqual(first.schedule)
  })

  it('projects model-visible tasks by allowlist and never leaks evaluator metadata', async () => {
    const inputs = await createFrozenP0Inputs(PROVIDER)

    for (const task of inputs.dataset.tasks) {
      const projected = createModelTask(task)
      expect(Object.keys(projected).sort()).toEqual(['id', 'prompt'])
      expect(projected).toEqual({ id: task.id, prompt: task.prompt })
      expect('oracleHints' in projected).toBe(false)
      expect('successCriteria' in projected).toBe(false)
      expect('domain' in projected).toBe(false)
      expect('intent' in projected).toBe(false)
    }

    expect(FROZEN_P0_SYSTEM_PROMPT).toContain('Use only evidence available in this run.')
    expect(FROZEN_P0_SYSTEM_PROMPT).toContain('API_CLAIM package=<package-or-*> symbol=<symbol> assertion=<exists|absent>')
  })

  it('binds exact target, ordinary substrate, capability manifests and retained execution policy evidence', async () => {
    const inputs = await createFrozenP0Inputs(PROVIDER)
    const sha256 = createNodeSha256Port()
    const definition = record(inputs.definition, 'P0 definition')
    const target = record(definition.target, 'P0 definition target')
    const execution = record(definition.execution, 'P0 definition execution')
    const manifests = record(execution.capabilityManifests, 'P0 capability manifest refs')

    expect(target.targetFingerprint).toBe('dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe')
    expect(target.contractIndexFingerprint).toBe('dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2')
    expect(inputs.workspace.workspaceSnapshotSha256).toBe('ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413')
    expect(inputs.workspace.documentationSha256).toBe('9325818edcb90fd4ea8d870c6dad3c438cdbc9b72c744d4807b76c2aacc1cacf')

    validateCapabilityManifests(inputs.capabilityManifests)
    expect(inputs.capabilityManifests.B.ordinaryEvidence?.workspaceSnapshotSha256).toBe(inputs.workspace.workspaceSnapshotSha256)
    expect(inputs.capabilityManifests.C.ordinaryEvidence).toEqual(inputs.capabilityManifests.B.ordinaryEvidence)
    expect(inputs.capabilityManifests.C.tools.slice(inputs.capabilityManifests.B.tools.length).map(tool => tool.name)).toEqual([
      'toolchain_contract_search',
      'toolchain_contract_inspect',
    ])

    for (const arm of ['A', 'B', 'C'] as const) {
      const ref = contentRef(manifests[arm], `P0 capability manifest ${arm}`)
      await validateContentRef(ref, sha256)
      expect(JSON.parse(ref.inline)).toEqual(inputs.capabilityManifests[arm])
    }
    await validateContentRef(contentRef(execution.runnerIdentity, 'P0 runner identity'), sha256)
    await validateContentRef(contentRef(execution.executorIdentity, 'P0 executor identity'), sha256)
    await validateContentRef(contentRef(execution.resourcePolicy, 'P0 resource policy'), sha256)
    await validateContentRef(contentRef(execution.retryPolicy, 'P0 retry policy'), sha256)

    const resources = record(definition.resources, 'P0 resources')
    expect(resources).toEqual({
      maxTurns: 12,
      maxInputTokens: 30_000,
      maxOutputTokens: 6_000,
      wallTimeMs: 300_000,
      concurrency: 1,
    })
    expect(record(definition.retries, 'P0 retries')).toEqual({
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0,
      retryableReasons: ['provider-transport', 'tool-transport'],
    })
  })

  it('keeps provider credentials out of frozen experiment identity', async () => {
    const inputs = await createFrozenP0Inputs(PROVIDER)
    const encoded = JSON.stringify(inputs.definition)

    expect(encoded).toContain('deepseek-v4-pro')
    expect(encoded).toContain('DeepSeek-V4-Pro-0813')
    expect(encoded).not.toContain('DEEPSEEK_API_KEY')
    expect(encoded).not.toContain('sk-test-secret')
  })
})
