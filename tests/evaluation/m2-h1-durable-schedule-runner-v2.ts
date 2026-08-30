import type { Sha256Port } from '../../src/model/digest.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import type { ProcessAttemptEvidenceInput } from './m2-agent-process-runner.js'
import {
  executeH1DurableAttemptV2,
  recoverH1DurableAttemptV2,
} from './m2-h1-attempt-coordinator-v2.js'
import type { H1RunLedgerResumeV2, H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'
import {
  inspectH1RunStoreV2,
  type H1RunStoreStateV2,
  type H1RunStoreV2,
} from './m2-h1-run-store-v2.js'

const INVOCATION_ID_PREFIX = 'dsh-toolchain-m2-h1-invocation-v2:'

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

function validateCommitBudget(maxCommittedAttempts: number | undefined): void {
  if (
    maxCommittedAttempts !== undefined
    && (!Number.isSafeInteger(maxCommittedAttempts) || maxCommittedAttempts < 1)
  ) {
    throw new Error('H1 durable schedule maxCommittedAttempts must be a positive safe integer')
  }
}

export async function createH1DurableInvocationIdV2(
  binding: H1LedgerBindingV2,
  resume: H1NextResumeV2,
  sha256: Sha256Port,
): Promise<string> {
  const digest = await sha256.sha256Utf8(canonicalizeEvaluationJson({
    schema: 'dsh-toolchain-m2-h1-invocation-v2',
    definitionSha256: binding.definitionSha256,
    datasetCommitmentSha256: binding.datasetCommitmentSha256,
    providerIdentityReceiptSha256: binding.providerIdentityReceiptSha256,
    expectedResponseModel: binding.expectedResponseModel,
    expectedBackendFingerprint: binding.expectedBackendFingerprint,
    scheduleIndex: resume.scheduleIndex,
    taskId: resume.taskId,
    arm: resume.arm,
    trial: resume.trial,
    attempt: resume.attempt,
  }))
  return `${INVOCATION_ID_PREFIX}${digest}`
}

export async function runH1DurableScheduleV2(
  input: H1DurableScheduleRunnerInputV2,
): Promise<H1DurableScheduleRunnerResultV2> {
  validateCommitBudget(input.maxCommittedAttempts)
  let committedAttempts = 0

  while (true) {
    const state = await inspectH1RunStoreV2(input.store)

    if (state.status === 'COMPLETE') {
      return Object.freeze({
        status: 'COMPLETE' as const,
        committedAttempts,
        state,
      })
    }

    if (state.status === 'RECOVERY_REQUIRED') {
      const recovery = await recoverH1DurableAttemptV2(input.store, input.binding, input.sha256)
      if (recovery.status === 'RECOVERED') {
        committedAttempts += 1
        continue
      }
      if (recovery.status === 'RECOVERY_REQUIRED') {
        if (recovery.state.status !== 'RECOVERY_REQUIRED') {
          throw new Error('H1 durable schedule recovery returned a mismatched store state')
        }
        return Object.freeze({
          status: 'RECOVERY_REQUIRED' as const,
          committedAttempts,
          state: recovery.state,
        })
      }
      throw new Error('H1 durable schedule recovery state changed unexpectedly while holding the run-store writer lock')
    }

    if (
      input.maxCommittedAttempts !== undefined
      && committedAttempts >= input.maxCommittedAttempts
    ) {
      return Object.freeze({
        status: 'PAUSED' as const,
        committedAttempts,
        state,
      })
    }

    const attemptInput = await input.buildAttemptInput(state.resume)
    const invocationId = await createH1DurableInvocationIdV2(
      input.binding,
      state.resume,
      input.sha256,
    )
    await executeH1DurableAttemptV2({
      store: input.store,
      binding: input.binding,
      invocationId,
      attemptInput,
      sha256: input.sha256,
    })
    committedAttempts += 1
  }
}
