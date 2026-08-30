import type { Sha256Port } from '../../src/model/digest.js'
import { FROZEN_P0_SYSTEM_PROMPT } from './m2-agent-p0-definition.js'
import type { AgentRetryPolicy, AgentScheduleEntry } from './m2-agent-eval-integrity.js'
import type { CapabilityManifest, ResourcePolicy } from './m2-agent-execution-evidence.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import type { H1LedgerBindingV2 } from './m2-h1-run-ledger-v2.js'

export const FROZEN_H1_SYSTEM_PROMPT = FROZEN_P0_SYSTEM_PROMPT

export interface FrozenH1ExecutionDefinitionV2 {
  readonly definition: Record<string, unknown>
  readonly definitionSha256: string
  readonly modelTasks: readonly { readonly id: string; readonly prompt: string }[]
  readonly schedule: readonly AgentScheduleEntry[]
  readonly capabilityManifests: Readonly<Record<'A' | 'B' | 'C', CapabilityManifest>>
  readonly resourcePolicy: ResourcePolicy
  readonly retryPolicy: AgentRetryPolicy
  readonly ledgerBinding: H1LedgerBindingV2
}

export async function createFrozenH1ExecutionDefinitionV2(
  _finalization: H1FinalizationResultV2,
  _workspace: OrdinaryWorkspace,
  _sha256: Sha256Port,
): Promise<FrozenH1ExecutionDefinitionV2> {
  throw new Error('H1 execution definition not implemented')
}
