import { Service, type Context } from '@deepseek-ai/cordis'

import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import { createApplicationKernel, type KernelDescriptor } from '../../kernel/index.js'

function createNodeKernel() {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    digest,
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    toolchain: ToolchainService
  }
}

export class ToolchainService extends Service {
  private readonly kernel = createNodeKernel()

  constructor(ctx: Context) {
    super(ctx, 'toolchain')
  }

  describe(): KernelDescriptor {
    return this.kernel.describe()
  }
}

export default ToolchainService
