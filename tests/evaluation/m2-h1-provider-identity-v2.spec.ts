import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { commitH1ProviderIdentityReceiptV2 } from './m2-h1-provider-identity-v2.js'

const sha256 = createNodeSha256Port()

function receipt() {
  return {
    schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requestModel: 'deepseek-v4-flash',
    responseModel: 'deepseek-v4-flash',
    systemFingerprint: 'fp_opencode_h1_fixture',
    thinking: 'enabled',
    reasoningEffort: 'high',
    functionToolCall: 'verified',
    reasoningContinuation: 'verified',
    tokenMeasurement: 'verified',
    backendIdentityStrength: 'system-fingerprint',
    inputTokens: 64,
    outputTokens: 17,
  }
}

describe('M2.3 H1 provider identity receipt v2', () => {
  it('derives the complete readiness identity from one canonical strong receipt', async () => {
    const committed = await commitH1ProviderIdentityReceiptV2(receipt(), sha256)

    expect(committed.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(committed.identity).toEqual({
      provider: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      requestModel: 'deepseek-v4-flash',
      responseModel: 'deepseek-v4-flash',
      adapterVersion: 'opencode-go-deepseek-chat-v1',
      thinking: 'enabled',
      reasoningEffort: 'high',
      backendIdentityStrength: 'system-fingerprint',
      backendFingerprint: 'fp_opencode_h1_fixture',
      identityReceiptSha256: committed.sha256,
    })
  })

  it('canonicalizes object-key order while keeping receipt evidence commitment-significant', async () => {
    const original = receipt()
    const reordered = {
      outputTokens: original.outputTokens,
      inputTokens: original.inputTokens,
      backendIdentityStrength: original.backendIdentityStrength,
      tokenMeasurement: original.tokenMeasurement,
      reasoningContinuation: original.reasoningContinuation,
      functionToolCall: original.functionToolCall,
      reasoningEffort: original.reasoningEffort,
      thinking: original.thinking,
      systemFingerprint: original.systemFingerprint,
      responseModel: original.responseModel,
      requestModel: original.requestModel,
      baseUrl: original.baseUrl,
      provider: original.provider,
      schema: original.schema,
    }
    const changedEvidence = { ...receipt(), inputTokens: 65 }
    const changedBackend = { ...receipt(), systemFingerprint: 'fp_opencode_h1_other' }

    const first = await commitH1ProviderIdentityReceiptV2(original, sha256)
    expect((await commitH1ProviderIdentityReceiptV2(reordered, sha256)).sha256).toBe(first.sha256)
    expect((await commitH1ProviderIdentityReceiptV2(changedEvidence, sha256)).sha256).not.toBe(first.sha256)
    expect((await commitH1ProviderIdentityReceiptV2(changedBackend, sha256)).identity.backendFingerprint)
      .toBe('fp_opencode_h1_other')
  })

  it('rejects weak backend identity and missing capability evidence', async () => {
    const responseModelOnly = { ...receipt(), backendIdentityStrength: 'response-model-only' }
    delete (responseModelOnly as Partial<ReturnType<typeof receipt>>).systemFingerprint
    await expect(commitH1ProviderIdentityReceiptV2(responseModelOnly, sha256)).rejects.toThrow(/system|backend|identity/u)

    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      reasoningContinuation: 'not-observed',
    }, sha256)).rejects.toThrow(/reasoning/u)

    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      functionToolCall: 'not-observed',
    }, sha256)).rejects.toThrow(/tool/u)
  })

  it('rejects provider/model/config drift, unknown fields and invalid token evidence', async () => {
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), requestModel: 'other-model' }, sha256))
      .rejects.toThrow(/model/u)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), baseUrl: 'https://example.com/v1' }, sha256))
      .rejects.toThrow(/baseUrl|OpenCode/u)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), secret: 'must-not-be-committed' }, sha256))
      .rejects.toThrow(/secret|unknown/u)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), inputTokens: -1 }, sha256))
      .rejects.toThrow(/token/u)
  })
})
