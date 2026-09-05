import { describe, expect, it } from 'vitest'

import { buildCompactnessReceiptV1 } from './m2-compactness-baseline.js'

describe('temporary compactness receipt sync evidence', () => {
  it('prints the deterministic Search category projection while the committed receipt is stale', async () => {
    const receipt = await buildCompactnessReceiptV1()
    console.log('M2_COMPACTNESS_CATEGORY_RECEIPT', JSON.stringify(receipt.search.byCategory))
    expect(Object.keys(receipt.search.byCategory)).toHaveLength(6)
  }, 30_000)
})
