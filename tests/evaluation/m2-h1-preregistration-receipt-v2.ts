import type { Sha256Port } from '../../src/model/digest.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'

export interface H1PreregistrationReceiptV2 {
  readonly schema: 'dsh-toolchain-m2-h1-preregistration-receipt-v2'
  readonly version: 'h1-preregistration-receipt-v2'
  readonly status: 'PREREGISTERED'
  readonly evaluationId: 'm2-agent-h1-v2'
  readonly target: Record<string, unknown>
  readonly finalizedCommitmentSha256: string
  readonly measurement: Record<string, unknown>
  readonly prospectiveDesign: Record<string, unknown>
  readonly thresholds: Record<string, unknown>
  readonly analysis: Record<string, unknown>
  readonly hiddenDataset: Record<string, unknown>
  readonly provider: Record<string, unknown>
  readonly execution: Record<string, unknown>
  readonly disclosure: Record<string, unknown>
  readonly receiptSha256: string
}

export async function createH1PreregistrationReceiptV2(
  _finalization: H1FinalizationResultV2,
  _frozen: FrozenH1ExecutionDefinitionV2,
  _sha256: Sha256Port,
): Promise<H1PreregistrationReceiptV2> {
  throw new Error('H1 preregistration receipt not implemented')
}

export async function validateH1PreregistrationReceiptV2(
  _value: unknown,
  _sha256: Sha256Port,
): Promise<H1PreregistrationReceiptV2> {
  throw new Error('H1 preregistration receipt validator not implemented')
}
