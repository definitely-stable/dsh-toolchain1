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
import type { Sha256Port } from '../../model/digest.js'
import type { ContractEnrichmentPort } from '../../model/contract.js'
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
  type DshContractToolExecutionContext,
} from './contract-tool.js'
import {
  createDshLiveContractEnrichment,
  type DshCordisInspectRegistryPort,
} from './live-inspect.js'
import {
  createTargetResolveToolDefinition,
  type DshToolRegistryPort,
} from './target-tool.js'

function createNodeKernel(digest: Sha256Port) {
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

function inspectFromContext(ctx: Context): DshCordisInspectRegistryPort | undefined {
  const value = ctx.get('cordisInspect') as unknown
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<DshCordisInspectRegistryPort>
  return typeof candidate.list === 'function' && typeof candidate.query === 'function'
    ? candidate as DshCordisInspectRegistryPort
    : undefined
}

interface NativeContractResolvers {
  search(
    request: ContractSearchRequest,
    execution?: DshContractToolExecutionContext,
  ): Promise<ContractSearchResponse>
  inspect(
    request: ContractInspectRequest,
    execution?: DshContractToolExecutionContext,
  ): Promise<ContractInspectResponse>
}

function registerNativeTools(
  ctx: Context,
  tools: DshToolRegistryPort,
  contracts: NativeContractResolvers,
): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(tools.register(createTargetResolveToolDefinition(
      request => ctx.toolchain.resolveTarget(request),
    )))
    disposers.push(tools.register(createContractSearchToolDefinition(contracts.search)))
    disposers.push(tools.register(createContractInspectToolDefinition(contracts.inspect)))
  } catch (error) {
    for (const dispose of disposers.toReversed()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.toReversed()) dispose()
  }
}

export class ToolchainService extends Service {
  private readonly digest: Sha256Port
  private readonly kernel: ReturnType<typeof createNodeKernel>

  constructor(ctx: Context) {
    super(ctx, 'toolchain')
    this.digest = createNodeSha256Port()
    this.kernel = createNodeKernel(this.digest)

    ctx.inject(['tools'], (toolCtx) => registerNativeTools(
      toolCtx,
      toolsFromContext(toolCtx),
      {
        search: (request, execution) => this.searchContractsNative(toolCtx, request, execution),
        inspect: (request, execution) => this.inspectContractNative(toolCtx, request, execution),
      },
    ))
  }

  describe(): KernelDescriptor {
    return this.kernel.describe()
  }

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

  private liveEnrichment(
    ctx: Context,
    execution?: DshContractToolExecutionContext,
  ): ContractEnrichmentPort | undefined {
    if (execution === undefined) return undefined
    const registry = inspectFromContext(ctx)
    if (registry === undefined) return undefined
    return createDshLiveContractEnrichment({ registry, execution, digest: this.digest })
  }

  private searchContractsNative(
    ctx: Context,
    request: ContractSearchRequest,
    execution?: DshContractToolExecutionContext,
  ): Promise<ContractSearchResponse> {
    return searchContractsResponse(
      this.kernel,
      request,
      randomUUID(),
      this.liveEnrichment(ctx, execution),
    )
  }

  private inspectContractNative(
    ctx: Context,
    request: ContractInspectRequest,
    execution?: DshContractToolExecutionContext,
  ): Promise<ContractInspectResponse> {
    return inspectContractResponse(
      this.kernel,
      request,
      randomUUID(),
      this.liveEnrichment(ctx, execution),
    )
  }
}

export default ToolchainService
