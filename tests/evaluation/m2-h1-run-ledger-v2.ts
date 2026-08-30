import type { Sha256Port } from '../../src/model/digest.js'
import type {
  AgentArm,
  AgentRetryPolicy,
  AgentScheduleEntry,
} from './m2-agent-eval-integrity.js'

export interface H1LedgerBindingV2 {
  readonly definitionSha256: string
  readonly datasetCommitmentSha256: string
  readonly providerIdentityReceiptSha256: string
  readonly expectedResponseModel: string
  readonly expectedBackendFingerprint: string
}

export interface H1RunLedgerHeaderV2 extends H1LedgerBindingV2 {
  readonly schema: 'dsh-toolchain-m2-h1-run-ledger-v2'
  readonly scheduleSha256: string
  readonly scheduleLength: number
}

export interface H1RunLedgerEntryV2 {
  readonly sequence: number
  readonly scheduleIndex: number
  readonly taskId: string
  readonly arm: AgentArm
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly outcome: 'infrastructure-failure' | 'model-outcome'
  readonly reason?: string
  readonly evidenceSha256: string
  readonly responseModel?: string
  readonly systemFingerprint?: string
  readonly previousEntrySha256: string | null
  readonly entrySha256: string
}

export interface H1RunLedgerV2 {
  readonly header: H1RunLedgerHeaderV2
  readonly entries: readonly H1RunLedgerEntryV2[]
}

export type H1RunLedgerResumeV2 =
  | {
      readonly status: 'NEXT'
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly inconclusive: boolean
    }
  | {
      readonly status: 'COMPLETE'
      readonly inconclusive: boolean
    }

export type H1RunLedgerAttemptInputV2 =
  | {
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly outcome: 'infrastructure-failure'
      readonly reason: string
      readonly evidenceSha256: string
    }
  | {
      readonly scheduleIndex: number
      readonly taskId: string
      readonly arm: AgentArm
      readonly trial: 1 | 2 | 3
      readonly attempt: number
      readonly outcome: 'model-outcome'
      readonly evidenceSha256: string
      readonly responseModel: string
      readonly systemFingerprint: string
    }

function notImplemented(): never {
  throw new Error('H1 run ledger not implemented')
}

export async function createH1RunLedgerV2(
  _binding: H1LedgerBindingV2,
  _schedule: readonly AgentScheduleEntry[],
  _taskIds: readonly string[],
  _sha256: Sha256Port,
): Promise<H1RunLedgerV2> {
  return notImplemented()
}

export async function validateH1RunLedgerV2(
  _ledger: unknown,
  _binding: H1LedgerBindingV2,
  _schedule: readonly AgentScheduleEntry[],
  _taskIds: readonly string[],
  _retryPolicy: AgentRetryPolicy,
  _sha256: Sha256Port,
): Promise<H1RunLedgerResumeV2> {
  return notImplemented()
}

export async function appendH1RunLedgerAttemptV2(
  _ledger: H1RunLedgerV2,
  _binding: H1LedgerBindingV2,
  _schedule: readonly AgentScheduleEntry[],
  _taskIds: readonly string[],
  _retryPolicy: AgentRetryPolicy,
  _attempt: H1RunLedgerAttemptInputV2,
  _sha256: Sha256Port,
): Promise<H1RunLedgerV2> {
  return notImplemented()
}
