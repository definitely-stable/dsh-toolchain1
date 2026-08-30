import { isAbsolute, relative, resolve } from 'node:path'

import type { Sha256Port } from '../../src/model/digest.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import {
  createFrozenH1AttemptInputFactoryV2,
  type FrozenH1AttemptInputFactoryV2,
  type H1ProcessConfigurationV2,
} from './m2-h1-attempt-input-v2.js'
import type { FrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  readH1ExecutionSourceIdentityV2,
  type H1ExecutionSourceBindingV2,
} from './m2-h1-execution-source-binding-v2.js'

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u

function assertCheckoutSource(
  checkedOutSourceCommitSha: string,
  expectedSourceCommitSha: string,
): void {
  if (!SOURCE_COMMIT_PATTERN.test(checkedOutSourceCommitSha)) {
    throw new Error('H1 checked-out source commit must be an exact lowercase 40-hex Git commit id')
  }
  if (checkedOutSourceCommitSha !== expectedSourceCommitSha) {
    throw new Error('H1 checked-out source commit drifted from the preregistered source binding')
  }
}

function assertProcessSource(
  configuration: H1ProcessConfigurationV2,
  entrypoint: string,
  runtimeVersion: string,
): void {
  if (configuration.command !== process.execPath) {
    throw new Error('H1 child executable drifted from the preregistered Node runtime')
  }
  if (process.versions.node !== runtimeVersion) {
    throw new Error(`H1 Node runtime drifted from preregistered version ${runtimeVersion}`)
  }
  if (configuration.args.length !== 1) {
    throw new Error('H1 child args must contain exactly the preregistered entrypoint')
  }
  if (configuration.cwd.includes('\0') || configuration.args[0]!.includes('\0')) {
    throw new Error('H1 child repository root/entrypoint must not contain NUL')
  }
  const expectedEntrypoint = resolve(configuration.cwd, entrypoint)
  const actualEntrypoint = resolve(configuration.cwd, configuration.args[0]!)
  const fromRoot = relative(configuration.cwd, expectedEntrypoint)
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error('H1 preregistered entrypoint escapes the checked-out repository root')
  }
  if (actualEntrypoint !== expectedEntrypoint) {
    throw new Error('H1 child entrypoint drifted from the preregistered source binding')
  }
}

export async function createSourceBoundH1AttemptInputFactoryV2(
  frozen: FrozenH1ExecutionDefinitionV2,
  sourceBinding: H1ExecutionSourceBindingV2,
  workspace: OrdinaryWorkspace,
  processConfiguration: H1ProcessConfigurationV2,
  checkedOutSourceCommitSha: string,
  sha256: Sha256Port,
): Promise<FrozenH1AttemptInputFactoryV2> {
  const sourceIdentity = await readH1ExecutionSourceIdentityV2(sourceBinding, frozen, sha256)
  assertCheckoutSource(checkedOutSourceCommitSha, sourceIdentity.sourceCommitSha)
  assertProcessSource(processConfiguration, sourceIdentity.entrypoint, sourceIdentity.runtimeVersion)
  return createFrozenH1AttemptInputFactoryV2(frozen, workspace, processConfiguration, sha256)
}
