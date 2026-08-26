import { randomUUID } from 'node:crypto'

import { Service, type Context } from '@deepseek-ai/cordis'

import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import {
  createApplicationKernel,
  resolveTargetResponse,
  type KernelDescriptor,
} from '../../kernel/index.js'
import type {
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../protocol/index.js'
import {
  createTargetResolveToolDefinition,
  type DshToolRegistryPort,
} from './target-tool.js'

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

function toolsFromContext(ctx: Context): DshToolRegistryPort {
  const tools = (ctx as unknown as { readonly tools?: DshToolRegistryPort }).tools
  if (tools === undefined) throw new Error('Cordis injected tools capability is unavailable')
  return tools
}

export class ToolchainService extends Service {
  private readonly kernel = createNodeKernel()

  constructor(ctx: Context) {
    super(ctx, 'toolchain')

    ctx.inject(['tools'], (toolCtx) => {
      return toolsFromContext(toolCtx).register(createTargetResolveToolDefinition(
        request => toolCtx.toolchain.resolveTarget(request),
      ))
    })
  }

  describe(): KernelDescriptor {
    return this.kernel.describe()
  }

  /**
   * Resolve an exact target through the same Protocol response path as CLI and
   * MCP. Callers normally omit `requestId`; the optional value exists for
   * deterministic same-process correlation/tests and is never target identity.
   */
  resolveTarget(
    request: TargetResolveRequest,
    requestId: string = randomUUID(),
  ): Promise<TargetResolveResponse> {
    return resolveTargetResponse(this.kernel, request, requestId)
  }
}

export default ToolchainService
