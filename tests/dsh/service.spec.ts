import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import ToolchainService from '../../src/integrations/dsh/index.js'

describe('ToolchainService lifecycle', () => {
  it('mounts ctx.toolchain from the shared kernel and removes it on dispose', async () => {
    const ctx = new Context()
    expect(ctx.get('toolchain')).toBeUndefined()

    const fiber = await ctx.plugin(ToolchainService)
    expect(ctx.toolchain.describe()).toEqual({
      product: 'dsh-toolchain',
      version: '0.0.0',
      protocolVersion: '1',
    })

    await fiber.dispose()
    expect(ctx.get('toolchain')).toBeUndefined()
  })
})
