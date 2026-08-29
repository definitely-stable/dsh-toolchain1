import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { validateContentRef, type ContentRef } from './m2-agent-execution-evidence.js'
import {
  createFrozenP0Inputs,
  type FrozenP0ProviderIdentity,
} from './m2-agent-p0-definition.js'

const PROVIDER_PROBE_SHA256 = 'a'.repeat(64)

const OPENCODE_GO_PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'opencode-go',
  requestModel: 'deepseek-v4-pro',
  reviewedSnapshot: `opencode-go-probe:${PROVIDER_PROBE_SHA256}`,
  expectedResponseModel: 'deepseek-v4-pro',
  expectedSystemFingerprint: 'fp_opencode_go_fixture',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  providerProbeSha256: PROVIDER_PROBE_SHA256,
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

describe('M2.3 OpenCode Go P0 provider identity', () => {
  it('freezes honest OpenCode Go provenance without changing the P0 experiment substrate', async () => {
    const inputs = await createFrozenP0Inputs(OPENCODE_GO_PROVIDER)
    const execution = record(inputs.definition.execution, 'P0 execution')
    const executorIdentity = contentRef(execution.executorIdentity, 'P0 executor identity')
    await validateContentRef(executorIdentity, createNodeSha256Port())

    expect(JSON.parse(executorIdentity.inline)).toEqual({
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-pro',
      reviewedSnapshot: `opencode-go-probe:${PROVIDER_PROBE_SHA256}`,
      expectedResponseModel: 'deepseek-v4-pro',
      expectedSystemFingerprint: 'fp_opencode_go_fixture',
      thinking: 'enabled',
      reasoningEffort: 'high',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      adapterVersion: 'opencode-go-deepseek-chat-v1',
      providerProbeSha256: PROVIDER_PROBE_SHA256,
    })

    expect(inputs.schedule).toHaveLength(72)
    expect(inputs.dataset.taskCount).toBe(8)
    expect(inputs.workspace.workspaceSnapshotSha256).toBe('ce2cd6608f7ef9095470d231f0562adf9bbd5a73f8ea7daeda2e40bb9da8e413')
  })

  it('permits response-model-only probe binding when the gateway omits system_fingerprint', async () => {
    const provider: FrozenP0ProviderIdentity = Object.freeze({
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-pro',
      reviewedSnapshot: `opencode-go-probe:${PROVIDER_PROBE_SHA256}`,
      expectedResponseModel: 'deepseek-v4-pro',
      thinking: 'enabled',
      reasoningEffort: 'high',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      adapterVersion: 'opencode-go-deepseek-chat-v1',
      providerProbeSha256: PROVIDER_PROBE_SHA256,
    })

    const inputs = await createFrozenP0Inputs(provider)
    const execution = record(inputs.definition.execution, 'P0 execution')
    const executorIdentity = JSON.parse(contentRef(execution.executorIdentity, 'P0 executor identity').inline) as Record<string, unknown>

    expect(executorIdentity.expectedResponseModel).toBe('deepseek-v4-pro')
    expect(executorIdentity).not.toHaveProperty('expectedSystemFingerprint')
    expect(executorIdentity.providerProbeSha256).toBe(PROVIDER_PROBE_SHA256)
  })

  it('rejects provider/adapter mismatches instead of becoming a generic provider registry', async () => {
    const invalid = {
      ...OPENCODE_GO_PROVIDER,
      adapterVersion: 'deepseek-chat-v1',
    } as unknown as FrozenP0ProviderIdentity

    await expect(createFrozenP0Inputs(invalid)).rejects.toThrow(/provider|adapter|OpenCode/u)
  })
})
