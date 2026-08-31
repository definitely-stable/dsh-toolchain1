import { readFile } from 'node:fs/promises'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import { finalizeH1CommitmentV2, type H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'

const commitmentUrl = new URL('../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json', import.meta.url)
const workspaceUrl = new URL('./fixtures/m2/rc2-web-v1/ordinary-workspace.json', import.meta.url)

const target = Object.freeze({
  package: '@deepseek-ai/dsh',
  version: '0.1.1-rc.2',
  profile: 'web',
  targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
  contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
})

const domains = Object.freeze([
  'tools',
  'approval',
  'scope',
  'session-query',
  'subagent',
  'compaction',
  'profile-lifecycle',
  'runtime',
])

export function syntheticH1HiddenDataset(taskCount = 96) {
  return {
    schema: 'dsh-toolchain-m2-agent-dataset-v2',
    datasetId: 'H1',
    target,
    taskCount,
    tasks: Array.from({ length: taskCount }, (_, index) => {
      const sequence = String(index + 1).padStart(3, '0')
      const domain = domains[Math.floor(index / 12) % domains.length]!
      const absent = index % 12 >= 9
      return {
        id: `h1-synthetic-${sequence}`,
        domain,
        prompt: `On the exact installed DSH target, resolve synthetic plugin contract fixture ${sequence} and name the target-valid API conclusion.`,
        successRule: absent
          ? {
              kind: 'api-absent',
              symbols: [`SyntheticAbsent${sequence}`],
              proofScope: index % 2 === 0
                ? { kind: 'target' }
                : { kind: 'package', package: '@deepseek-ai/dsh-tools' },
            }
          : {
              kind: 'api-exists-any',
              package: '@deepseek-ai/dsh-tools',
              symbols: [`SyntheticExists${sequence}`],
            },
      }
    }),
  }
}

export function syntheticH1ProviderReceipt(inputTokens = 64) {
  return {
    schema: 'dsh-toolchain-m2-opencode-go-probe-v1',
    provider: 'opencode-go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    requestModel: 'deepseek-v4-flash',
    responseModel: 'deepseek-v4-flash',
    thinking: 'enabled',
    reasoningEffort: 'high',
    functionToolCall: 'verified',
    reasoningContinuation: 'verified',
    tokenMeasurement: 'verified',
    backendIdentityStrength: 'response-model-only',
    inputTokens,
    outputTokens: 17,
  }
}

export async function readSyntheticH1Workspace(): Promise<OrdinaryWorkspace> {
  return JSON.parse(await readFile(workspaceUrl, 'utf8')) as OrdinaryWorkspace
}

export async function createSyntheticH1Finalization(inputTokens = 64): Promise<H1FinalizationResultV2> {
  const source = JSON.parse(await readFile(commitmentUrl, 'utf8')) as unknown
  return finalizeH1CommitmentV2(
    source,
    syntheticH1HiddenDataset(),
    syntheticH1ProviderReceipt(inputTokens),
    createNodeSha256Port(),
  )
}
