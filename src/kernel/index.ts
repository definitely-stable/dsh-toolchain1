import { TOOLCHAIN_PROTOCOL_VERSION } from '../protocol/index.js'
import { TOOLCHAIN_PRODUCT, TOOLCHAIN_VERSION } from '../product.js'

export interface KernelDescriptor {
  readonly product: typeof TOOLCHAIN_PRODUCT
  readonly version: typeof TOOLCHAIN_VERSION
  readonly protocolVersion: typeof TOOLCHAIN_PROTOCOL_VERSION
}

export interface ApplicationKernel {
  describe(): KernelDescriptor
}

export function createApplicationKernel(): ApplicationKernel {
  const descriptor: KernelDescriptor = Object.freeze({
    product: TOOLCHAIN_PRODUCT,
    version: TOOLCHAIN_VERSION,
    protocolVersion: TOOLCHAIN_PROTOCOL_VERSION,
  })

  return Object.freeze({
    describe: () => descriptor,
  })
}
