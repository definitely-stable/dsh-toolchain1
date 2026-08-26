import { describe, expect, it } from 'vitest'

import { createApplicationKernel } from '../../src/kernel/index.js'

describe('application kernel descriptor', () => {
  it('describes the M0 product without exposing future operations', () => {
    const kernel = createApplicationKernel()

    expect(kernel.describe()).toEqual({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    })
  })
})
