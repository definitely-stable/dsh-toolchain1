import type { Sha256Port } from '../../src/model/digest.js'
import { commitH1ProviderIdentityReceiptV2 } from './m2-h1-provider-identity-v2.js'
import {
  commitHiddenH1DatasetV2,
  evaluateH1ReadinessV2,
  type H1CommitmentV2,
  type H1ReadinessBlockerV2,
  type H1ReadinessV2,
} from './m2-h1-readiness-v2.js'

const SOURCE_KEYS = Object.freeze([
  'schema',
  'version',
  'datasetId',
  'status',
  'target',
  'measurement',
  'prospectiveDesign',
  'thresholds',
  'hiddenDataset',
  'provider',
  'analysis',
])

const EXPECTED_SOURCE_BLOCKERS = Object.freeze<H1ReadinessBlockerV2[]>([
  'COMMITMENT_NOT_FINALIZED',
  'TASK_SET_NOT_COMMITTED',
  'PROVIDER_IDENTITY_NOT_FROZEN',
])

export interface H1FinalizationResultV2 {
  readonly commitment: H1CommitmentV2
  readonly readiness: H1ReadinessV2
  readonly modelTasks: readonly {
    readonly id: string
    readonly prompt: string
  }[]
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(record).filter(key => !allowedSet.has(key))
  if (unknown.length > 0) {
    throw new Error(`${label} contains unknown key(s): ${unknown.join(', ')}`)
  }
  const missing = allowed.filter(key => !(key in record))
  if (missing.length > 0) {
    throw new Error(`${label} is missing required key(s): ${missing.join(', ')}`)
  }
}

function sameBlockers(actual: readonly H1ReadinessBlockerV2[]): boolean {
  if (actual.length !== EXPECTED_SOURCE_BLOCKERS.length) return false
  const actualSet = new Set(actual)
  return EXPECTED_SOURCE_BLOCKERS.every(blocker => actualSet.has(blocker))
}

function requirePristineBlockedSource(value: unknown): H1CommitmentV2 {
  const source = requireRecord(value, 'H1 finalization source commitment')
  assertExactKeys(source, SOURCE_KEYS, 'H1 finalization source commitment')

  if (source.status !== 'BLOCKED') {
    throw new Error('H1 finalization source must be the pristine public BLOCKED commitment')
  }

  const hiddenDataset = requireRecord(source.hiddenDataset, 'H1 finalization source hiddenDataset')
  assertExactKeys(hiddenDataset, ['sha256', 'taskCount'], 'H1 finalization source hiddenDataset')
  if (hiddenDataset.sha256 !== null || hiddenDataset.taskCount !== null) {
    throw new Error('H1 finalization source must not contain pre-populated hidden dataset commitment fields')
  }
  if (source.provider !== null) {
    throw new Error('H1 finalization source must not contain pre-populated provider identity fields')
  }

  const readiness = evaluateH1ReadinessV2(source)
  if (readiness.status !== 'BLOCKED' || readiness.runAllowed || !sameBlockers(readiness.blockers)) {
    throw new Error(
      `H1 finalization source readiness is not pristine BLOCKED: ${readiness.blockers.join(', ') || 'none'}`,
    )
  }

  return source as unknown as H1CommitmentV2
}

export async function finalizeH1CommitmentV2(
  sourceValue: unknown,
  hiddenDatasetValue: unknown,
  providerReceiptValue: unknown,
  sha256: Sha256Port,
): Promise<H1FinalizationResultV2> {
  const source = requirePristineBlockedSource(sourceValue)
  const hiddenDataset = await commitHiddenH1DatasetV2(hiddenDatasetValue, sha256)
  const provider = await commitH1ProviderIdentityReceiptV2(providerReceiptValue, sha256)

  const commitment = Object.freeze({
    ...structuredClone(source),
    status: 'COMMITTED' as const,
    hiddenDataset: Object.freeze({
      sha256: hiddenDataset.sha256,
      taskCount: hiddenDataset.taskCount,
    }),
    provider: provider.identity,
  }) satisfies H1CommitmentV2

  const readiness = evaluateH1ReadinessV2(commitment)
  if (readiness.status !== 'READY' || !readiness.runAllowed || readiness.blockers.length !== 0) {
    throw new Error(
      `H1 finalization did not produce a READY commitment: ${readiness.blockers.join(', ') || 'unknown blocker'}`,
    )
  }

  return Object.freeze({
    commitment,
    readiness,
    modelTasks: hiddenDataset.modelTasks,
  })
}
