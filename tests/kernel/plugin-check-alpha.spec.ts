import { describe, expect, it } from 'vitest'

import { createApplicationKernel } from '../../src/kernel/index.js'
import * as protocol from '../../src/protocol/index.js'
import type { Sha256Port } from '../../src/model/digest.js'

const digest: Sha256Port = {
  async sha256Utf8() {
    return 'a'.repeat(64)
  },
}

describe('Exact Target Plugin Check alpha boundary', () => {
  it('adds one strict Protocol parser for plugin.check instead of frontend-owned request semantics', () => {
    const parser = Reflect.get(protocol, 'parsePluginCheckRequest')
    expect(parser).toBeTypeOf('function')
  })

  it('adds plugin.check to the shared application kernel instead of implementing compatibility in frontends', () => {
    const kernel = createApplicationKernel({
      targetAcquisition: {
        async acquire() {
          throw new Error('not reached')
        },
      },
      digest,
    })

    expect(Reflect.get(kernel, 'checkPlugin')).toBeTypeOf('function')
  })
})
