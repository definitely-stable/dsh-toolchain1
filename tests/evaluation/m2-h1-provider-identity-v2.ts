import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import type { H1ProviderIdentityV2 } from './m2-h1-readiness-v2.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SYSTEM_FINGERPRINT_PATTERN = /^[\x21-\x7e]{1,256}$/u

const EXPECTED = Object.freeze({
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
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  identityMode: 'managed-gateway',
})

const REQUIRED_RECEIPT_KEYS = Object.freeze([
  'schema',
  'provider',
  'baseUrl',
  'requestModel',
  'responseModel',
  'thinking',
  'reasoningEffort',
  'functionToolCall',
  'reasoningContinuation',
  'tokenMeasurement',
  'backendIdentityStrength',
  'inputTokens',
  'outputTokens',
])
const OPTIONAL_RECEIPT_KEYS = Object.freeze(['systemFingerprint'])

export interface H1ProviderIdentityReceiptCommitmentV2 {
  readonly sha256: string
  readonly identity: H1ProviderIdentityV2
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertReceiptKeys(record: Record<string, unknown>): void {
  const allowed = new Set([...REQUIRED_RECEIPT_KEYS, ...OPTIONAL_RECEIPT_KEYS])
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(`H1 provider identity receipt contains unknown key(s): ${unknown.join(', ')}`)
  }
  const missing = REQUIRED_RECEIPT_KEYS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw new Error(`H1 provider identity receipt is missing required key(s): ${missing.join(', ')}`)
  }
}

function requireExactString(record: Record<string, unknown>, key: keyof typeof EXPECTED): string {
  const expected = EXPECTED[key]
  const actual = record[key]
  if (actual !== expected) {
    throw new Error(`H1 provider identity receipt ${key} drift: expected ${expected}`)
  }
  return expected
}

function requireTokenCount(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`H1 provider identity receipt ${label} must be a non-negative integer token count`)
  }
  return value as number
}

function normalizeBackendObservation(receipt: Record<string, unknown>): {
  readonly backendIdentityStrength: 'response-model-only' | 'system-fingerprint'
  readonly systemFingerprint?: string
} {
  if (receipt.backendIdentityStrength === 'response-model-only') {
    if ('systemFingerprint' in receipt) {
      throw new Error('H1 provider identity receipt response-model-only backend must not claim a systemFingerprint')
    }
    return Object.freeze({ backendIdentityStrength: 'response-model-only' as const })
  }
  if (receipt.backendIdentityStrength === 'system-fingerprint') {
    if (typeof receipt.systemFingerprint !== 'string' || !SYSTEM_FINGERPRINT_PATTERN.test(receipt.systemFingerprint)) {
      throw new Error('H1 provider identity receipt system-fingerprint backend requires a printable systemFingerprint')
    }
    return Object.freeze({
      backendIdentityStrength: 'system-fingerprint' as const,
      systemFingerprint: receipt.systemFingerprint,
    })
  }
  throw new Error('H1 provider identity receipt backendIdentityStrength must describe observable response-model or system-fingerprint evidence')
}

export async function commitH1ProviderIdentityReceiptV2(
  value: unknown,
  sha256: Sha256Port,
): Promise<H1ProviderIdentityReceiptCommitmentV2> {
  const receipt = requireRecord(value, 'H1 provider identity receipt')
  assertReceiptKeys(receipt)

  requireExactString(receipt, 'schema')
  requireExactString(receipt, 'provider')
  requireExactString(receipt, 'baseUrl')
  requireExactString(receipt, 'requestModel')
  requireExactString(receipt, 'responseModel')
  requireExactString(receipt, 'thinking')
  requireExactString(receipt, 'reasoningEffort')
  requireExactString(receipt, 'functionToolCall')
  requireExactString(receipt, 'reasoningContinuation')
  requireExactString(receipt, 'tokenMeasurement')

  const backendObservation = normalizeBackendObservation(receipt)
  const inputTokens = requireTokenCount(receipt.inputTokens, 'inputTokens')
  const outputTokens = requireTokenCount(receipt.outputTokens, 'outputTokens')

  const normalizedReceipt = Object.freeze({
    schema: EXPECTED.schema,
    provider: EXPECTED.provider,
    baseUrl: EXPECTED.baseUrl,
    requestModel: EXPECTED.requestModel,
    responseModel: EXPECTED.responseModel,
    ...backendObservation,
    thinking: EXPECTED.thinking,
    reasoningEffort: EXPECTED.reasoningEffort,
    functionToolCall: EXPECTED.functionToolCall,
    reasoningContinuation: EXPECTED.reasoningContinuation,
    tokenMeasurement: EXPECTED.tokenMeasurement,
    inputTokens,
    outputTokens,
  })
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson(normalizedReceipt))
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error('SHA-256 port returned a malformed H1 provider identity receipt digest')
  }

  return Object.freeze({
    sha256: digest,
    identity: Object.freeze({
      provider: EXPECTED.provider,
      baseUrl: EXPECTED.baseUrl,
      requestModel: EXPECTED.requestModel,
      responseModel: EXPECTED.responseModel,
      adapterVersion: EXPECTED.adapterVersion,
      thinking: EXPECTED.thinking,
      reasoningEffort: EXPECTED.reasoningEffort,
      identityMode: EXPECTED.identityMode,
      identityReceiptSha256: digest,
    }),
  })
}
