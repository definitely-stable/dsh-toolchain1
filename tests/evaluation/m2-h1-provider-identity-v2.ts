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
  backendIdentityStrength: 'system-fingerprint',
  adapterVersion: 'opencode-go-deepseek-chat-v1',
})

const RECEIPT_KEYS = Object.freeze([
  'schema',
  'provider',
  'baseUrl',
  'requestModel',
  'responseModel',
  'systemFingerprint',
  'thinking',
  'reasoningEffort',
  'functionToolCall',
  'reasoningContinuation',
  'tokenMeasurement',
  'backendIdentityStrength',
  'inputTokens',
  'outputTokens',
])

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

function assertExactKeys(record: Record<string, unknown>): void {
  const allowed = new Set(RECEIPT_KEYS)
  const unknown = Object.keys(record).filter(key => !allowed.has(key))
  if (unknown.length > 0) {
    throw new Error(`H1 provider identity receipt contains unknown key(s): ${unknown.join(', ')}`)
  }
  const missing = RECEIPT_KEYS.filter(key => !(key in record))
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

function requireSystemFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !SYSTEM_FINGERPRINT_PATTERN.test(value)) {
    throw new Error('H1 provider identity receipt requires a non-empty printable systemFingerprint')
  }
  return value
}

function requireTokenCount(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`H1 provider identity receipt ${label} must be a non-negative integer token count`)
  }
  return value as number
}

export async function commitH1ProviderIdentityReceiptV2(
  value: unknown,
  sha256: Sha256Port,
): Promise<H1ProviderIdentityReceiptCommitmentV2> {
  const receipt = requireRecord(value, 'H1 provider identity receipt')
  assertExactKeys(receipt)

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
  requireExactString(receipt, 'backendIdentityStrength')

  const systemFingerprint = requireSystemFingerprint(receipt.systemFingerprint)
  const inputTokens = requireTokenCount(receipt.inputTokens, 'inputTokens')
  const outputTokens = requireTokenCount(receipt.outputTokens, 'outputTokens')

  const normalizedReceipt = Object.freeze({
    schema: EXPECTED.schema,
    provider: EXPECTED.provider,
    baseUrl: EXPECTED.baseUrl,
    requestModel: EXPECTED.requestModel,
    responseModel: EXPECTED.responseModel,
    systemFingerprint,
    thinking: EXPECTED.thinking,
    reasoningEffort: EXPECTED.reasoningEffort,
    functionToolCall: EXPECTED.functionToolCall,
    reasoningContinuation: EXPECTED.reasoningContinuation,
    tokenMeasurement: EXPECTED.tokenMeasurement,
    backendIdentityStrength: EXPECTED.backendIdentityStrength,
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
      backendIdentityStrength: EXPECTED.backendIdentityStrength,
      backendFingerprint: systemFingerprint,
      identityReceiptSha256: digest,
    }),
  })
}
