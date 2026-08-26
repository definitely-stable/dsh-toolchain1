import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  TOOLCHAIN_PRODUCT,
  TOOLCHAIN_PROTOCOL_VERSION,
  TOOLCHAIN_VERSION,
  createApplicationKernel,
} from '../../src/index.js'

const root = new URL('../../', import.meta.url)

describe('public package API', () => {
  it('exports only the M0 product identity and shared kernel surface', () => {
    expect(TOOLCHAIN_PRODUCT).toBe('dsh-toolchain')
    expect(TOOLCHAIN_VERSION).toBe('0.0.0')
    expect(TOOLCHAIN_PROTOCOL_VERSION).toBe('1')
    expect(createApplicationKernel().describe()).toEqual({
      product: TOOLCHAIN_PRODUCT,
      version: TOOLCHAIN_VERSION,
      protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
    })
  })

  it('keeps compile-time product version consistent with package.json', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as { version: string }
    expect(TOOLCHAIN_VERSION).toBe(manifest.version)
  })

  it('returns immutable independent descriptors', () => {
    const first = createApplicationKernel().describe()
    const second = createApplicationKernel().describe()

    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(second)).toBe(true)
    expect(first).not.toBe(second)
  })
})
