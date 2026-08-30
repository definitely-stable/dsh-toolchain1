import type { Sha256Port } from '../../src/model/digest.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import type { ProcessAttemptEvidenceInput } from './m2-agent-process-runner.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import type { H1NextResumeV2 } from './m2-h1-durable-schedule-runner-v2.js'

export interface H1ProcessConfigurationV2 {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
}

export interface FrozenH1AttemptInputFactoryV2 {
  buildAttemptInput(resume: H1NextResumeV2): Promise<ProcessAttemptEvidenceInput>
}

export async function createFrozenH1AttemptInputFactoryV2(
  _frozen: FrozenH1ExecutionDefinitionV2,
  _workspace: OrdinaryWorkspace,
  _processConfiguration: H1ProcessConfigurationV2,
  _sha256: Sha256Port,
): Promise<FrozenH1AttemptInputFactoryV2> {
  throw new Error('H1 attempt-input factory not implemented')
}
