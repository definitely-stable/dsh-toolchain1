import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson, hashEvaluationDefinition } from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  validateContentRef,
  type ContentRef,
} from './m2-agent-execution-evidence.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const RUNTIME_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u
const EXPECTED_REPOSITORY = 'definitely-stable/dsh-toolchain1'

export const CANONICAL_H1_CHILD_ENTRYPOINT = 'scripts/m2-opencode-go-p0-child.mjs'
export const CANONICAL_H1_NODE_VERSION = '24.19.0'

export interface H1ExecutionSourceIdentityV2 {
  readonly schema: 'dsh-toolchain-m2-h1-execution-source-v2'
  readonly repository: 'definitely-stable/dsh-toolchain1'
  readonly sourceCommitSha: string
  readonly entrypoint: string
  readonly runtime: 'node'
  readonly runtimeVersion: string
  readonly protocol: 'closed-ndjson-v1'
}

export interface H1ExecutionSourceBindingV2 {
  readonly schema: 'dsh-toolchain-m2-h1-source-binding-v2'
  readonly definitionSha256: string
  readonly sourceIdentity: ContentRef
  readonly sourceBindingSha256: string
}

const SOURCE_IDENTITY_KEYS = Object.freeze([
  'schema',
  'repository',
  'sourceCommitSha',
  'entrypoint',
  'runtime',
  'runtimeVersion',
  'protocol',
])
const SOURCE_BINDING_KEYS = Object.freeze([
  'schema',
  'definitionSha256',
  'sourceIdentity',
  'sourceBindingSha256',
])

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

function validateEntrypoint(value: unknown): string {
  const entrypoint = requireString(value, 'H1 execution source entrypoint')
  if (
    entrypoint.startsWith('/')
    || entrypoint.includes('\\')
    || entrypoint.includes('\0')
    || entrypoint.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('H1 execution source entrypoint must be a normalized repo-relative POSIX path')
  }
  return entrypoint
}

export function validateH1ExecutionSourceIdentityV2(value: unknown): H1ExecutionSourceIdentityV2 {
  const record = requireRecord(value, 'H1 execution source identity')
  assertExactKeys(record, SOURCE_IDENTITY_KEYS, 'H1 execution source identity')
  if (record.schema !== 'dsh-toolchain-m2-h1-execution-source-v2') {
    throw new Error('H1 execution source schema drifted')
  }
  if (record.repository !== EXPECTED_REPOSITORY) {
    throw new Error('H1 execution source repository drifted')
  }
  const sourceCommitSha = requireString(record.sourceCommitSha, 'H1 execution source commit')
  if (!SOURCE_COMMIT_PATTERN.test(sourceCommitSha)) {
    throw new Error('H1 execution source commit must be an exact lowercase 40-hex Git commit id')
  }
  const entrypoint = validateEntrypoint(record.entrypoint)
  if (record.runtime !== 'node') throw new Error('H1 execution source runtime must remain node')
  const runtimeVersion = requireString(record.runtimeVersion, 'H1 execution source runtime version')
  if (!RUNTIME_VERSION_PATTERN.test(runtimeVersion)) {
    throw new Error('H1 execution source runtime version must be exact x.y.z')
  }
  if (record.protocol !== 'closed-ndjson-v1') {
    throw new Error('H1 execution source protocol must remain closed-ndjson-v1')
  }
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-execution-source-v2',
    repository: EXPECTED_REPOSITORY,
    sourceCommitSha,
    entrypoint,
    runtime: 'node',
    runtimeVersion,
    protocol: 'closed-ndjson-v1',
  })
}

export function createCanonicalH1ExecutionSourceIdentityV2(sourceCommitSha: string): H1ExecutionSourceIdentityV2 {
  return validateH1ExecutionSourceIdentityV2({
    schema: 'dsh-toolchain-m2-h1-execution-source-v2',
    repository: EXPECTED_REPOSITORY,
    sourceCommitSha,
    entrypoint: CANONICAL_H1_CHILD_ENTRYPOINT,
    runtime: 'node',
    runtimeVersion: CANONICAL_H1_NODE_VERSION,
    protocol: 'closed-ndjson-v1',
  })
}

async function sourceIdentityContentRef(
  identity: H1ExecutionSourceIdentityV2,
  sha256: Sha256Port,
): Promise<ContentRef> {
  return createInlineContentRef(
    canonicalizeEvaluationJson(identity),
    'application/json',
    'utf8-bytes-v1',
    sha256,
  )
}

function bindingProjection(binding: Omit<H1ExecutionSourceBindingV2, 'sourceBindingSha256'>): unknown {
  return binding
}

async function validateFrozenDefinitionIdentity(
  frozen: FrozenH1ExecutionDefinitionV2,
  sha256: Sha256Port,
): Promise<void> {
  const definitionSha256 = await hashEvaluationDefinition(frozen.definition, sha256)
  if (definitionSha256 !== frozen.definitionSha256) {
    throw new Error('H1 source binding requires an untampered frozen definition')
  }
  if (frozen.ledgerBinding.definitionSha256 !== frozen.definitionSha256) {
    throw new Error('H1 source binding requires the ledger definition SHA to match the frozen definition')
  }
}

export async function createH1ExecutionSourceBindingV2(
  frozen: FrozenH1ExecutionDefinitionV2,
  sourceIdentityValue: unknown,
  sha256: Sha256Port,
): Promise<H1ExecutionSourceBindingV2> {
  await validateFrozenDefinitionIdentity(frozen, sha256)
  const identity = validateH1ExecutionSourceIdentityV2(sourceIdentityValue)
  const sourceIdentity = await sourceIdentityContentRef(identity, sha256)
  const withoutHash = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-source-binding-v2' as const,
    definitionSha256: frozen.definitionSha256,
    sourceIdentity,
  })
  const sourceBindingSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(bindingProjection(withoutHash)))
  const binding = Object.freeze({ ...withoutHash, sourceBindingSha256 })
  return validateH1ExecutionSourceBindingV2(binding, frozen, sha256)
}

export async function validateH1ExecutionSourceBindingV2(
  value: unknown,
  frozen: FrozenH1ExecutionDefinitionV2,
  sha256: Sha256Port,
): Promise<H1ExecutionSourceBindingV2> {
  await validateFrozenDefinitionIdentity(frozen, sha256)
  const record = requireRecord(value, 'H1 execution source binding')
  assertExactKeys(record, SOURCE_BINDING_KEYS, 'H1 execution source binding')
  if (record.schema !== 'dsh-toolchain-m2-h1-source-binding-v2') {
    throw new Error('H1 execution source binding schema drifted')
  }
  const definitionSha256 = requireSha256(record.definitionSha256, 'H1 source binding definition SHA')
  if (definitionSha256 !== frozen.definitionSha256) {
    throw new Error('H1 source binding definition SHA drifted from the frozen scientific definition')
  }
  const sourceIdentity = requireRecord(record.sourceIdentity, 'H1 source identity ContentRef') as unknown as ContentRef
  await validateContentRef(sourceIdentity, sha256)
  if (sourceIdentity.mediaType !== 'application/json' || sourceIdentity.canonicalization !== 'utf8-bytes-v1') {
    throw new Error('H1 source identity ContentRef must retain canonical JSON bytes')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(sourceIdentity.inline) as unknown
  } catch (error) {
    throw new Error('H1 source identity retained bytes are not valid JSON', { cause: error })
  }
  const identity = validateH1ExecutionSourceIdentityV2(parsed)
  if (sourceIdentity.inline !== canonicalizeEvaluationJson(identity)) {
    throw new Error('H1 source identity retained JSON is not canonical')
  }
  const sourceBindingSha256 = requireSha256(record.sourceBindingSha256, 'H1 source binding SHA')
  const expected = await sha256.sha256Utf8(canonicalizeEvaluationJson(bindingProjection({
    schema: 'dsh-toolchain-m2-h1-source-binding-v2',
    definitionSha256,
    sourceIdentity,
  })))
  if (sourceBindingSha256 !== expected) {
    throw new Error('H1 source binding SHA does not match its canonical definition/source bytes')
  }
  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-source-binding-v2',
    definitionSha256,
    sourceIdentity: Object.freeze(structuredClone(sourceIdentity)),
    sourceBindingSha256,
  })
}

export async function readH1ExecutionSourceIdentityV2(
  binding: H1ExecutionSourceBindingV2,
  frozen: FrozenH1ExecutionDefinitionV2,
  sha256: Sha256Port,
): Promise<H1ExecutionSourceIdentityV2> {
  const validated = await validateH1ExecutionSourceBindingV2(binding, frozen, sha256)
  return validateH1ExecutionSourceIdentityV2(JSON.parse(validated.sourceIdentity.inline) as unknown)
}
