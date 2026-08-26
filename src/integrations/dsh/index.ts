import { Service, type Context } from '@deepseek-ai/cordis'

import { createApplicationKernel, type KernelDescriptor } from '../../kernel/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolchain: ToolchainService
  }
}

export class ToolchainService extends Service {
  private readonly kernel = createApplicationKernel()

  constructor(ctx: Context) {
    super(ctx, 'toolchain')
  }

  describe(): KernelDescriptor {
    return this.kernel.describe()
  }
}

export default ToolchainService
