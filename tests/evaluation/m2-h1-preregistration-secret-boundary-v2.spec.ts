import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import { createH1PreregistrationReceiptV2 } from './m2-h1-preregistration-receipt-v2.js'
import {
  createSyntheticH1Finalization,
  readSyntheticH1Workspace,
} from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()

describe('M2.3 H1 preregistration credential boundary v2', () => {
  it('publishes only the managed-gateway commitment and no credential-shaped or hidden backend material', async () => {
    const [finalization, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
    const receipt = await createH1PreregistrationReceiptV2(finalization, frozen, sha256)
    const serialized = canonicalizeEvaluationJson(receipt)

    expect(serialized).not.toMatch(/(?:^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{8,}(?=$|[^A-Za-z0-9_-])/u)
    expect(serialized).not.toContain('systemFingerprint')
    expect(serialized).not.toContain('backendFingerprint')
    expect(receipt.provider).toMatchObject({
      provider: 'opencode-go',
      requestModel: 'deepseek-v4-flash',
      responseModel: 'deepseek-v4-flash',
      identityMode: 'managed-gateway',
    })
  })
})
