import type { Sha256Port } from '../../src/model/digest.js'
import type { ProcessAttemptEvidenceInput } from './m2-agent-process-runner.js'
import type { H1RunLedgerResumeV2, H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'
import type { H1RunStoreStateV2, H1RunStoreV2 } from './m2-h1-run-store-v2.js'

export type H1NextResumeV2 = Extract<H1RunLedgerResumeV2, { readonly status: 'NEXT' }>

export interface H1DurableScheduleRunnerInputV2 {
  readonly store: H1RunStoreV2
  readonly binding: H1LedgerBindingV2
  readonly sha256: Sha256Port
  readonly buildAttemptInput: (resume: H1NextResumeV2) => Promise<ProcessAttemptEvidenceInput>
  readonly maxCommittedAttempts?: number
}

export type H1DurableScheduleRunnerResultV2 =
  | {
      readonly status: 'COMPLETE'
      readonly committedAttempts: number
      readonly state: Extract<H1RunStoreStateV2, { readonly status: 'COMPLETE' }>
    }
  | {
      readonly status: 'PAUSED'
      readonly committedAttempts: number
      readonly state: Extract<H1RunStoreStateV2, { readonly status: 'NEXT' }>
    }
  | {
      readonly status: 'RECOVERY_REQUIRED'
      readonly committedAttempts: number
      readonly state: Extract<H1RunStoreStateV2, { readonly status: 'RECOVERY_REQUIRED' }>
    }

function notImplemented(): never {
  throw new Error('H1 durable schedule runner not implemented')
}

export async function createH1DurableInvocationIdV2(
  _binding: H1LedgerBindingV2,
  _resume: H1NextResumeV2,
  _sha256: Sha256Port,
): Promise<string> {
  return notImplemented()
}

export async function runH1DurableScheduleV2(
  _input: H1DurableScheduleRunnerInputV2,
): Promise<H1DurableScheduleRunnerResultV2> {
  return notImplemented()
}
