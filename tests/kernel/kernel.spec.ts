import { describe, expect, it } from 'vitest'

import { createApplicationKernel } from '../../src/kernel/index.js'

function createKernel() {
  return createApplicationKernel({
    targetAcquisition: {
      acquire: async () => { throw new Error('target acquisition is not used by descriptor tests') },
    },
    digest: {
      sha256Utf8: async () => '0'.repeat(64),
    },
  })
}

describe('application kernel descriptor', () => {
  it('describes the product independently of target acquisition', () => {
    const kernel = createKernel()

    expect(kernel.describe()).toEqual({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    })
  })
})
