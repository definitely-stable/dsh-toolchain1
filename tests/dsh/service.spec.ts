import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import ToolchainService from '../../src/integrations/dsh/index.js'

const dshHome = fileURLToPath(new URL('../fixtures/targets/valid/dsh-home/', import.meta.url))
const dshPackageRoot = fileURLToPath(new URL('../fixtures/targets/valid/dsh-package/', import.meta.url))

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

  it('projects target resolution through the shared Protocol response path', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)

    const response = await ctx.toolchain.resolveTarget({
      profile: 'web',
      dshHome,
      dshPackageRoot,
    }, 'dsh-service-success')

    expect(response.status).toBe('ok')
    expect(response.requestId).toBe('dsh-service-success')
    if (response.status === 'ok') {
      expect(response.snapshotFingerprint).toBe(response.data.snapshot.fingerprint)
      expect(response.snapshotFingerprint).toMatch(/^dsh-target-v2:[0-9a-f]{64}$/)
      expect(response.data.snapshot.dsh).toEqual({
        name: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
      })
      expect(response.data.snapshot.profile.name).toBe('web')
    }

    await fiber.dispose()
  })

  it('preserves shared target diagnostic identity for expected acquisition failures', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(ToolchainService)

    const response = await ctx.toolchain.resolveTarget({
      profile: 'missing',
      dshHome,
      dshPackageRoot,
    }, 'dsh-service-failure')

    expect(response).toMatchObject({
      protocolVersion: '1',
      requestId: 'dsh-service-failure',
      status: 'failed',
      diagnostics: [{
        code: 'TARGET_PROFILE_NOT_FOUND',
        severity: 'error',
        domain: 'target',
      }],
    })

    await fiber.dispose()
  })
})
