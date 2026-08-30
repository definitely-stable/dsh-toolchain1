import type { Sha256Port } from '../../src/model/digest.js'
import type { ProcessAttemptEvidenceInput, ProcessAttemptEvidenceResult } from './m2-agent-process-runner.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'
import type {
  H1PendingAttemptIntentV2,
  H1RunStoreStateV2,
  H1RunStoreV2,
} from './m2-h1-run-store-v2.js'

export interface H1DurableAttemptEvidenceV2 {
  readonly schema: 'dsh-toolchain-m2-h1-durable-attempt-evidence-v2'
  readonly pendingIntentSha256: string
  readonly evidenceSha256: string
  readonly result: ProcessAttemptEvidenceResult
}

export interface H1DurableAttemptCommitV2 {
  readonly status: 'COMMITTED' | 'RECOVERED'
  readonly evidenceSha256: string
  readonly evidencePath: string
  readonly state: H1RunStoreStateV2
}

export interface H1DurableAttemptInputV2 {
  readonly store: H1RunStoreV2
  readonly binding: H1LedgerBindingV2
  readonly invocationId: string
  readonly attemptInput: ProcessAttemptEvidenceInput
  readonly sha256: Sha256Port
}

function notImplemented(): never {
  throw new Error('H1 durable attempt coordinator not implemented')
}

export async function persistH1TerminalAttemptEvidenceV2(
  _store: H1RunStoreV2,
  _binding: H1LedgerBindingV2,
  _pending: H1PendingAttemptIntentV2,
  _result: ProcessAttemptEvidenceResult,
  _sha256: Sha256Port,
): Promise<{ readonly evidenceSha256: string; readonly evidencePath: string }> {
  return notImplemented()
}

export async function executeH1DurableAttemptV2(
  _input: H1DurableAttemptInputV2,
): Promise<H1DurableAttemptCommitV2> {
  return notImplemented()
}

export async function recoverH1DurableAttemptV2(
  _store: H1RunStoreV2,
  _binding: H1LedgerBindingV2,
  _sha256: Sha256Port,
): Promise<H1DurableAttemptCommitV2 | { readonly status: 'RECOVERY_REQUIRED'; readonly state: H1RunStoreStateV2 }> {
  return notImplemented()
}
