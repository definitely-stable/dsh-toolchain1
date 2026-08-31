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
    thinking: 'enabled',
    reasoningEffort: 'high',
    functionToolCall: 'verified',
    reasoningContinuation: 'verified',
    tokenMeasurement: 'verified',
    backendIdentityStrength: 'response-model-only',
    inputTokens: 64,
    outputTokens: 17,
  }
}

describe('M2.3 H1 provider identity receipt v2', () => {
  it('commits the exact OpenCode Go Flash managed-gateway boundary without inventing a backend fingerprint', async () => {
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
      identityMode: 'managed-gateway',
      identityReceiptSha256: committed.sha256,
    })
    expect(JSON.stringify(committed.identity)).not.toContain('backendFingerprint')
    expect(JSON.stringify(committed.identity)).not.toContain('systemFingerprint')
  })

  it('canonicalizes object-key order while keeping observable provider evidence commitment-significant', async () => {
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
      responseModel: original.responseModel,
      requestModel: original.requestModel,
      baseUrl: original.baseUrl,
      provider: original.provider,
      schema: original.schema,
    }
    const changedEvidence = { ...receipt(), inputTokens: 65 }

    const first = await commitH1ProviderIdentityReceiptV2(original, sha256)
    expect((await commitH1ProviderIdentityReceiptV2(reordered, sha256)).sha256).toBe(first.sha256)
    expect((await commitH1ProviderIdentityReceiptV2(changedEvidence, sha256)).sha256).not.toBe(first.sha256)
  })

  it('accepts an optional provider-reported system fingerprint only as committed probe evidence', async () => {
    const withOptionalFingerprint = {
      ...receipt(),
      backendIdentityStrength: 'system-fingerprint',
      systemFingerprint: 'fp_optional_provider_signal',
    }
    const committed = await commitH1ProviderIdentityReceiptV2(withOptionalFingerprint, sha256)

    expect(committed.identity.identityMode).toBe('managed-gateway')
    expect(JSON.stringify(committed.identity)).not.toContain('fp_optional_provider_signal')
    expect(committed.sha256).not.toBe((await commitH1ProviderIdentityReceiptV2(receipt(), sha256)).sha256)
  })

  it('rejects missing capability evidence and inconsistent raw backend metadata', async () => {
    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      reasoningContinuation: 'not-observed',
    }, sha256)).rejects.toThrow(/reasoning/iu)

    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      functionToolCall: 'not-observed',
    }, sha256)).rejects.toThrow(/tool/iu)

    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      backendIdentityStrength: 'system-fingerprint',
    }, sha256)).rejects.toThrow(/fingerprint|backend/iu)

    await expect(commitH1ProviderIdentityReceiptV2({
      ...receipt(),
      systemFingerprint: 'fp_without_matching_strength',
    }, sha256)).rejects.toThrow(/fingerprint|backend/iu)
  })

  it('rejects provider/model/config drift, unknown fields and invalid token evidence', async () => {
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), requestModel: 'other-model' }, sha256))
      .rejects.toThrow(/model/iu)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), responseModel: 'other-model' }, sha256))
      .rejects.toThrow(/model/iu)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), baseUrl: 'https://example.com/v1' }, sha256))
      .rejects.toThrow(/baseUrl|OpenCode/iu)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), secret: 'must-not-be-committed' }, sha256))
      .rejects.toThrow(/secret|unknown/iu)
    await expect(commitH1ProviderIdentityReceiptV2({ ...receipt(), inputTokens: -1 }, sha256))
      .rejects.toThrow(/token/iu)
  })
})
