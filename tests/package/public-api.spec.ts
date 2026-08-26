import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import * as rootApi from '../../src/index.js'

const root = new URL('../../', import.meta.url)

describe('public package API', () => {
  it('exports only stable M0 product and protocol identities', () => {
    expect(Object.keys(rootApi).sort()).toEqual([
      'TOOLCHAIN_PRODUCT',
      'TOOLCHAIN_PROTOCOL_VERSION',
      'TOOLCHAIN_VERSION',
    ])
    expect(rootApi.TOOLCHAIN_PRODUCT).toBe('dsh-toolchain')
    expect(rootApi.TOOLCHAIN_VERSION).toBe('0.0.0')
    expect(rootApi.TOOLCHAIN_PROTOCOL_VERSION).toBe('1')
  })

  it('keeps compile-time product version consistent with package.json', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { version: string }
    expect(rootApi.TOOLCHAIN_VERSION).toBe(manifest.version)
  })
})
