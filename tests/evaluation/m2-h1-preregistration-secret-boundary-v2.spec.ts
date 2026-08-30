import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import { createH1PreregistrationReceiptV2 } from './m2-h1-preregistration-receipt-v2.js'
import {
  createSyntheticH1Finalization,
  readSyntheticH1Workspace,
} from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()

describe('M2.3 H1 preregistration credential boundary v2', () => {
  it('rejects a credential-shaped token embedded inside an otherwise printable public identity string', async () => {
    const [finalization, workspace] = await Promise.all([
      createSyntheticH1Finalization('fp_debug=sk-secret123456789'),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)

    await expect(createH1PreregistrationReceiptV2(finalization, frozen, sha256))
      .rejects.toThrow(/credential|secret|public/iu)
  })
})
