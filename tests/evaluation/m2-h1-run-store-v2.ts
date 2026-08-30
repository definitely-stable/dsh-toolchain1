import type { Sha256Port } from '../../src/model/digest.js'
import type { AgentRetryPolicy, AgentScheduleEntry } from './m2-agent-eval-integrity.js'
import type {
  H1LedgerBindingV2,
  H1RunLedgerAttemptInputV2,
  H1RunLedgerResumeV2,
} from './m2-h1-run-ledger-v2.js'

export interface H1PendingAttemptIntentV2 {
  readonly schema: 'dsh-toolchain-m2-h1-pending-attempt-v2'
  readonly invocationId: string
  readonly definitionSha256: string
  readonly datasetCommitmentSha256: string
  readonly providerIdentityReceiptSha256: string
  readonly expectedResponseModel: string
  readonly expectedBackendFingerprint: string
  readonly scheduleSha256: string
  readonly preEntryCount: number
  readonly preTailEntrySha256: string | null
  readonly scheduleIndex: number
  readonly taskId: string
  readonly arm: 'A' | 'B' | 'C'
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly intentSha256: string
}

export interface H1RunStoreV2 {
  readonly rootDir: string
}

interface H1RunStoreStateBaseV2 {
  readonly orphanedTempFiles: readonly string[]
  readonly recoveredCommittedIntent: boolean
}

export type H1RunStoreStateV2 =
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'NEXT'
      readonly resume: Extract<H1RunLedgerResumeV2, { readonly status: 'NEXT' }>
    })
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'COMPLETE'
      readonly resume: Extract<H1RunLedgerResumeV2, { readonly status: 'COMPLETE' }>
    })
  | (H1RunStoreStateBaseV2 & {
      readonly status: 'RECOVERY_REQUIRED'
      readonly pending: H1PendingAttemptIntentV2
    })

export interface H1RunStoreOpenResultV2 {
  readonly store: H1RunStoreV2
  readonly state: H1RunStoreStateV2
}

function notImplemented(): never {
  throw new Error('H1 run store not implemented')
}

export async function createH1RunStoreV2(
  _rootDir: string,
  _binding: H1LedgerBindingV2,
  _schedule: readonly AgentScheduleEntry[],
  _taskIds: readonly string[],
  _retryPolicy: AgentRetryPolicy,
  _sha256: Sha256Port,
): Promise<H1RunStoreOpenResultV2> {
  return notImplemented()
}

export async function openH1RunStoreV2(
  _rootDir: string,
  _binding: H1LedgerBindingV2,
  _schedule: readonly AgentScheduleEntry[],
  _taskIds: readonly string[],
  _retryPolicy: AgentRetryPolicy,
  _sha256: Sha256Port,
): Promise<H1RunStoreOpenResultV2> {
  return notImplemented()
}

export async function inspectH1RunStoreV2(
  _store: H1RunStoreV2,
): Promise<H1RunStoreStateV2> {
  return notImplemented()
}

export async function beginH1RunStoreAttemptV2(
  _store: H1RunStoreV2,
  _invocationId: string,
): Promise<H1PendingAttemptIntentV2> {
  return notImplemented()
}

export async function commitH1RunStoreAttemptV2(
  _store: H1RunStoreV2,
  _invocationId: string,
  _attempt: H1RunLedgerAttemptInputV2,
): Promise<H1RunStoreStateV2> {
  return notImplemented()
}

export async function closeH1RunStoreV2(
  _store: H1RunStoreV2,
): Promise<void> {
  return notImplemented()
}
