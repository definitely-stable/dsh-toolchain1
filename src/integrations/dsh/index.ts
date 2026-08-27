import { randomUUID } from 'node:crypto'

import { Service, type Context } from '@deepseek-ai/cordis'

import { createDshContractFilesystemAcquisition } from '../../acquisition/dsh-contract-filesystem.js'
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import {
  createApplicationKernel,
  inspectContractResponse,
  resolveTargetResponse,
  searchContractsResponse,
  type KernelDescriptor,
} from '../../kernel/index.js'
import type {
  ContractInspectRequest,
  ContractInspectResponse,
  ContractSearchRequest,
  ContractSearchResponse,
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../protocol/index.js'
import {
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from './contract-tool.js'
import {
  createTargetResolveToolDefinition,
  type DshToolRegistryPort,
} from './target-tool.js'

function createNodeKernel() {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
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

function registerNativeTools(ctx: Context, tools: DshToolRegistryPort): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(tools.register(createTargetResolveToolDefinition(
      request => ctx.toolchain.resolveTarget(request),
    )))
    disposers.push(tools.register(createContractSearchToolDefinition(
      request => ctx.toolchain.searchContracts(request),
    )))
    disposers.push(tools.register(createContractInspectToolDefinition(
      request => ctx.toolchain.inspectContract(request),
    )))
  } catch (error) {
    for (const dispose of disposers.toReversed()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.toReversed()) dispose()
  }
}

export class ToolchainService extends Service {
  private readonly kernel = createNodeKernel()

  constructor(ctx: Context) {
    super(ctx, 'toolchain')

    ctx.inject(['tools'], (toolCtx) => registerNativeTools(toolCtx, toolsFromContext(toolCtx)))
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

  searchContracts(
    request: ContractSearchRequest,
    requestId: string = randomUUID(),
  ): Promise<ContractSearchResponse> {
    return searchContractsResponse(this.kernel, request, requestId)
  }

  inspectContract(
    request: ContractInspectRequest,
    requestId: string = randomUUID(),
  ): Promise<ContractInspectResponse> {
    return inspectContractResponse(this.kernel, request, requestId)
  }
}

export default ToolchainService
