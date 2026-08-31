import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { validateContentRef, type ContentRef } from './m2-agent-execution-evidence.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  createH1ExecutionSourceBindingV2,
  validateH1ExecutionSourceIdentityV2,
  type H1ExecutionSourceBindingV2,
  type H1ExecutionSourceIdentityV2,
} from './m2-h1-execution-source-binding-v2.js'
import {
  createH1PreregistrationReceiptV2,
  validateH1PreregistrationReceiptV2,
  type H1PreregistrationReceiptV2,
} from './m2-h1-preregistration-receipt-v2.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const TOP_LEVEL_KEYS = Object.freeze([
  'schema',
  'version',
  'status',
  'evaluationId',
  'receipt',
  'sourceBinding',
  'envelopeSha256',
])
const SOURCE_BINDING_KEYS = Object.freeze([
  'schema',
  'definitionSha256',
  'sourceIdentity',
  'sourceBindingSha256',
])

export interface H1SourceBoundPreregistrationV2 {
  readonly schema: 'dsh-toolchain-m2-h1-source-bound-preregistration-v2'
  readonly version: 'h1-source-bound-preregistration-v2'
  readonly status: 'PREREGISTERED'
  readonly evaluationId: 'm2-agent-h1-v2'
  readonly receipt: H1PreregistrationReceiptV2
  readonly sourceBinding: H1ExecutionSourceBindingV2
  readonly envelopeSha256: string
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label)
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
  return digest
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys)
  const unknown = Object.keys(record).filter(key => !expected.has(key))
  const missing = keys.filter(key => !(key in record))
  if (unknown.length > 0) throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
  if (missing.length > 0) throw new Error(`${label} is missing required key(s): ${missing.join(', ')}`)
}

async function validatePublicSourceBinding(
  value: unknown,
  expectedDefinitionSha256: string,
  sha256: Sha256Port,
): Promise<H1ExecutionSourceBindingV2> {
  const record = requireRecord(value, 'H1 public source binding')
  assertExactKeys(record, SOURCE_BINDING_KEYS, 'H1 public source binding')
  if (record.schema !== 'dsh-toolchain-m2-h1-source-binding-v2') {
    throw new Error('H1 public source binding schema drifted')
  }
  const definitionSha256 = requireSha256(record.definitionSha256, 'H1 public source definition SHA')
  if (definitionSha256 !== expectedDefinitionSha256) {
    throw new Error('H1 public source binding definition SHA drifted from preregistration receipt')
  }
  const sourceIdentity = requireRecord(record.sourceIdentity, 'H1 public source identity ContentRef') as unknown as ContentRef
  await validateContentRef(sourceIdentity, sha256)
  if (sourceIdentity.mediaType !== 'application/json' || sourceIdentity.canonicalization !== 'utf8-bytes-v1') {
    throw new Error('H1 public source identity must retain canonical JSON bytes')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(sourceIdentity.inline) as unknown
  } catch (error) {
    throw new Error('H1 public source identity retained bytes are not valid JSON', { cause: error })
  }
  const identity = validateH1ExecutionSourceIdentityV2(parsed)
  if (sourceIdentity.inline !== canonicalizeEvaluationJson(identity)) {
    throw new Error('H1 public source identity retained JSON is not canonical')
  }
  const sourceBindingSha256 = requireSha256(record.sourceBindingSha256, 'H1 public source binding SHA')
  const expectedSourceBindingSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson({
    schema: 'dsh-toolchain-m2-h1-source-binding-v2',
    definitionSha256,
    sourceIdentity,
  }))
  if (sourceBindingSha256 !== expectedSourceBindingSha256) {
    throw new Error('H1 public source binding SHA does not match canonical source/definition bytes')
  }
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-source-binding-v2',
    definitionSha256,
    sourceIdentity: Object.freeze(structuredClone(sourceIdentity)),
    sourceBindingSha256,
  })
}

export async function createH1SourceBoundPreregistrationV2(
  finalization: H1FinalizationResultV2,
  frozen: FrozenH1ExecutionDefinitionV2,
  sourceIdentity: H1ExecutionSourceIdentityV2,
  sha256: Sha256Port,
): Promise<H1SourceBoundPreregistrationV2> {
  const [receipt, sourceBinding] = await Promise.all([
    createH1PreregistrationReceiptV2(finalization, frozen, sha256),
    createH1ExecutionSourceBindingV2(frozen, sourceIdentity, sha256),
  ])
  if (receipt.execution.definitionSha256 !== sourceBinding.definitionSha256) {
    throw new Error('H1 preregistration receipt/source binding definition identities diverged')
  }
  const withoutHash = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-source-bound-preregistration-v2' as const,
    version: 'h1-source-bound-preregistration-v2' as const,
    status: 'PREREGISTERED' as const,
    evaluationId: 'm2-agent-h1-v2' as const,
    receipt,
    sourceBinding,
  })
  const envelopeSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(withoutHash))
  return validateH1SourceBoundPreregistrationV2(
    Object.freeze({ ...withoutHash, envelopeSha256 }),
    sha256,
  )
}

export async function validateH1SourceBoundPreregistrationV2(
  value: unknown,
  sha256: Sha256Port,
): Promise<H1SourceBoundPreregistrationV2> {
  const record = requireRecord(value, 'H1 source-bound preregistration envelope')
  assertExactKeys(record, TOP_LEVEL_KEYS, 'H1 source-bound preregistration envelope')
  if (
    record.schema !== 'dsh-toolchain-m2-h1-source-bound-preregistration-v2'
    || record.version !== 'h1-source-bound-preregistration-v2'
    || record.status !== 'PREREGISTERED'
    || record.evaluationId !== 'm2-agent-h1-v2'
  ) {
    throw new Error('H1 source-bound preregistration envelope identity drifted')
  }
  const receipt = await validateH1PreregistrationReceiptV2(record.receipt, sha256)
  const sourceBinding = await validatePublicSourceBinding(
    record.sourceBinding,
    receipt.execution.definitionSha256,
    sha256,
  )
  const envelopeSha256 = requireSha256(record.envelopeSha256, 'H1 source-bound preregistration envelope SHA')
  const expectedEnvelopeSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson({
    schema: 'dsh-toolchain-m2-h1-source-bound-preregistration-v2',
    version: 'h1-source-bound-preregistration-v2',
    status: 'PREREGISTERED',
    evaluationId: 'm2-agent-h1-v2',
    receipt,
    sourceBinding,
  }))
  if (envelopeSha256 !== expectedEnvelopeSha256) {
    throw new Error('H1 source-bound preregistration envelope SHA does not match canonical public bytes')
  }
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-source-bound-preregistration-v2',
    version: 'h1-source-bound-preregistration-v2',
    status: 'PREREGISTERED',
    evaluationId: 'm2-agent-h1-v2',
    receipt,
    sourceBinding,
    envelopeSha256,
  })
}
