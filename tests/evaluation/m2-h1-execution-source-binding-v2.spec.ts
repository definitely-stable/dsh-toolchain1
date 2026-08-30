import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createFrozenH1AttemptInputFactoryV2 } from './m2-h1-attempt-input-v2.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import { createSyntheticH1Finalization, readSyntheticH1Workspace } from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()
const SYSTEM_FINGERPRINT = 'fp_h1_source_binding_red'

function otherwiseValidProcessConfiguration() {
  return {
    command: process.execPath,
    args: ['arbitrary-unbound-child.mjs'],
    cwd: process.cwd(),
    environment: {
      PATH: process.env.PATH ?? '',
      OPENCODE_API_KEY: 'sk-synthetic-h1-runtime-only',
      OPENCODE_GO_BASE_URL: 'https://opencode.ai/zen/go/v1',
      OPENCODE_GO_REQUEST_MODEL: 'deepseek-v4-flash',
      OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-flash',
      OPENCODE_GO_EXPECTED_SYSTEM_FINGERPRINT: SYSTEM_FINGERPRINT,
      OPENCODE_GO_THINKING: 'enabled',
      OPENCODE_GO_REASONING_EFFORT: 'high',
      OPENCODE_GO_MAX_OUTPUT_TOKENS: '12000',
    },
  }
}

describe('M2.3 H1 execution source binding v2', () => {
  it('refuses attempt construction from an execution definition that has no bound source identity', async () => {
    const [finalization, workspace] = await Promise.all([
      createSyntheticH1Finalization(SYSTEM_FINGERPRINT),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)

    await expect(createFrozenH1AttemptInputFactoryV2(
      frozen,
      workspace,
      otherwiseValidProcessConfiguration(),
      sha256,
    )).rejects.toThrow(/source|implementation|entrypoint|bound/iu)
  })
})
