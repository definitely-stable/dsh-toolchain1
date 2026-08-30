import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { createSyntheticH1Finalization } from './m2-h1-synthetic-fixture-v2.js'

describe('M2.3 H1 finalization model-task projection binding v2', () => {
  it('commits the exact model-visible task projection hash alongside the hidden dataset hash', async () => {
    const finalized = await createSyntheticH1Finalization()
    const hidden = finalized.commitment.hiddenDataset as unknown as Record<string, unknown>
    const expected = await createNodeSha256Port().sha256Utf8(canonicalizeEvaluationJson(finalized.modelTasks))

    expect(hidden.modelTaskProjectionSha256).toBe(expected)
    expect(hidden.modelTaskProjectionSha256).toMatch(/^[0-9a-f]{64}$/u)
  })
})
