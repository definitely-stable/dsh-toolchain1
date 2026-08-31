import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { validateH1PreregistrationReceiptV2 } from './m2-h1-preregistration-receipt-v2.js'

const sha256 = createNodeSha256Port()
const receiptUrl = new URL('../../docs/evaluation/m2/h1-preregistration-receipt-v2.json', import.meta.url)
const providerReceiptUrl = new URL('../../docs/evaluation/m2/h1-provider-identity-receipt-v2.json', import.meta.url)

const DATASET_SHA256 = '73b8fa145369d859c692cfe0bfaed3acc2ce20950f177c1b7e09cd0d913fb7ea'
const PROVIDER_RECEIPT_SHA256 = 'ba594a928f7fde32b4ca2724dc57d1fef0a267f061ecdcfc5f87e909be5cb5b8'
const DEFINITION_SHA256 = '7463f59344c674b0fd9ffd42608454a52d75fbfca0f9da45f77031242c3598d6'
const RECEIPT_SHA256 = '5efbf614296b271c7e6115aace6707aec7001d977cbf702b42df9885dd2e896e'

describe('M2.3 published H1 preregistration v2', () => {
  it('retains the exact validated public receipt without hidden task material', async () => {
    const text = await readFile(receiptUrl, 'utf8')
    const parsed = JSON.parse(text) as unknown

    expect(text).toBe(`${canonicalizeEvaluationJson(parsed)}\n`)
    const receipt = await validateH1PreregistrationReceiptV2(parsed, sha256)

    expect(receipt).toMatchObject({
      status: 'PREREGISTERED',
      receiptSha256: RECEIPT_SHA256,
      hiddenDataset: {
        sha256: DATASET_SHA256,
        taskCount: 96,
      },
      provider: {
        provider: 'opencode-go',
        requestModel: 'deepseek-v4-flash',
        responseModel: 'deepseek-v4-flash',
        identityMode: 'managed-gateway',
        identityReceiptSha256: PROVIDER_RECEIPT_SHA256,
      },
      execution: {
        definitionSha256: DEFINITION_SHA256,
        scheduleCount: 864,
        concurrency: 1,
      },
    })
    expect(text).not.toContain('h1-approval-')
    expect(text).not.toContain('h1-scope-')
    expect(text).not.toContain('h1-session-')
    expect(text).not.toContain('h1-tool-')
  })

  it('retains the exact non-secret provider probe bytes bound by the preregistration receipt', async () => {
    const [receiptText, providerText] = await Promise.all([
      readFile(receiptUrl, 'utf8'),
      readFile(providerReceiptUrl, 'utf8'),
    ])
    const receipt = await validateH1PreregistrationReceiptV2(JSON.parse(receiptText), sha256)
    const provider = JSON.parse(providerText) as Record<string, unknown>

    expect(providerText).toBe(`${canonicalizeEvaluationJson(provider)}\n`)
    await expect(sha256.sha256Utf8(canonicalizeEvaluationJson(provider)))
      .resolves.toBe(PROVIDER_RECEIPT_SHA256)
    expect(receipt.provider.identityReceiptSha256).toBe(PROVIDER_RECEIPT_SHA256)
    expect(provider).toMatchObject({
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
    })
    expect(provider).not.toHaveProperty('systemFingerprint')
  })
})
