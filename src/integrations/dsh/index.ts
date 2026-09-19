import { randomUUID } from 'node:crypto'

import { Service, type Context } from '@deepseek-ai/cordis'

import { createDshContractFilesystemAcquisition } from '../../acquisition/dsh-contract-filesystem.js'
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import { createPluginSubjectAcquisition } from '../../acquisition/plugin-subject.js'
import {
  checkPluginResponse,
  createApplicationKernel,
  inspectContractResponse,
  resolveTargetResponse,
  searchContractsResponse,
  verifyPluginResponse,
  type KernelDescriptor,
} from '../../kernel/index.js'
import {
  cancelVerificationOperationResponse,
  createVerificationOperationManager,
  getVerificationOperationResponse,
  startPluginVerificationResponse,
  type VerificationOperationManager,
} from '../../kernel/operation.js'
import type { ContractEnrichmentPort } from '../../model/contract.js'
import type { Sha256Port } from '../../model/digest.js'
import {
  parseOperationRequest,
  parsePluginVerifyRequest,
} from '../../protocol/index.js'
import type {
  ContractInspectRequest,
  ContractInspectResponse,
  ContractSearchRequest,
  ContractSearchResponse,
  OperationCancelResponse,
  OperationGetResponse,
  OperationRequest,
  PluginCheckRequest,
  PluginCheckResponse,
  PluginVerifyRequest,
  PluginVerifyResponse,
  PluginVerifyStartResponse,
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../protocol/index.js'
import { createPackedPluginVerificationExecutionPort } from '../../verification/execution-port.js'
import { isDefaultAgentTool } from './agent-surface-policy.js'
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
  createOperationCancelToolDefinition,
  createOperationGetToolDefinition,
  createPluginVerifyStartToolDefinition,
} from './operation-tool.js'
import { createPluginCheckToolDefinition } from './plugin-check-tool.js'
import { createPluginVerifyToolDefinition } from './plugin-verify-tool.js'
import {
  bindContractEnrichmentToRuntimeTarget,
  createDshAmbientTargetBinding,
  createDshRuntimeTargetBinding,
  provenRunningProfile,
  type DshAmbientTargetBindingPort,
  type DshRuntimeTargetBindingPort,
  type DshStartupTargetIdentity,
} from './runtime-target-binding.js'
import {
  createTargetResolveToolDefinition,
  type DshToolDefinition,
  type DshToolRegistryPort,
} from './target-tool.js'

function createNodeKernel(digest: Sha256Port) {
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
    pluginSubjectAcquisition: createPluginSubjectAcquisition(digest),
    pluginVerificationExecution: createPackedPluginVerificationExecutionPort(),
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

interface RunningTargetContextIdentity {
  readonly baseUrl: string
  readonly dshHome: string
}

/**
 * The Host's own DSH home, when it exposes one. Only `dshHomePath` is needed to resolve an explicit
 * profile inside that installation; the root base URL matters for proving that a resolved target is
 * the *running* one, which is a separate question with a separate condition.
 */
function dshHomeFromContext(ctx: Context): string | undefined {
  const dshHomePath = ctx.get('dshHomePath') as unknown
  if (typeof dshHomePath !== 'function') return undefined

  try {
    const dshHome = (dshHomePath as () => unknown)()
    return typeof dshHome === 'string' && dshHome.length !== 0 ? dshHome : undefined
  } catch {
    return undefined
  }
}

function runningTargetContextIdentity(ctx: Context): RunningTargetContextIdentity | undefined {
  const root = (ctx as unknown as { readonly root?: { readonly baseUrl?: unknown } }).root
  const baseUrl = root?.baseUrl
  const dshHome = dshHomeFromContext(ctx)
  if (typeof baseUrl !== 'string' || dshHome === undefined) return undefined
  return Object.freeze({ baseUrl, dshHome })
}

async function captureStartupTargetBindingIdentity(
  identity: RunningTargetContextIdentity | undefined,
  runningProfile: string | undefined,
  kernel: ReturnType<typeof createNodeKernel>,
): Promise<DshStartupTargetIdentity | undefined> {
  if (identity === undefined || runningProfile === undefined) return undefined

  try {
    const resolved = await kernel.resolveTarget({ profile: runningProfile, dshHome: identity.dshHome })
    return Object.freeze({
      targetFingerprint: resolved.snapshot.fingerprint,
      ...(resolved.snapshot.profileLifecycle === undefined
        ? {}
        : { lifecycleFingerprint: resolved.snapshot.profileLifecycle.fingerprint }),
    })
  } catch {
    // A baseline that cannot be proven must disable live enrichment rather than
    // weaken the runtime-target binding to path identity alone.
    return undefined
  }
}

function runtimeTargetBindingFromContext(
  ctx: Context,
  startupIdentity: Promise<DshStartupTargetIdentity | undefined>,
): DshRuntimeTargetBindingPort | undefined {
  const identity = runningTargetContextIdentity(ctx)
  if (identity === undefined) return undefined
  return createDshRuntimeTargetBinding({
    baseUrl: identity.baseUrl,
    dshHome: identity.dshHome,
    startupTargetFingerprint: startupIdentity.then(value => value?.targetFingerprint),
    startupLifecycleFingerprint: startupIdentity.then(value => value?.lifecycleFingerprint),
  })
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
  binding: DshAmbientTargetBindingPort,
): () => void {
  const disposers: Array<() => void> = []
  // Every definition below is constructed, then filtered by the agent-surface policy.
  // Filtering after construction rather than skipping construction keeps the omitted
  // operations alive as real, tested definitions that other frontends can register.
  const definitions: readonly DshToolDefinition[] = [
    createTargetResolveToolDefinition(
      request => ctx.toolchain.resolveTarget(request),
      binding,
    ),
    createContractSearchToolDefinition(contracts.search, binding),
    createContractInspectToolDefinition(contracts.inspect, binding),
    createPluginCheckToolDefinition(
      request => ctx.toolchain.checkPlugin(request),
      binding,
    ),
    createPluginVerifyToolDefinition(
      request => ctx.toolchain.verifyPlugin(request),
      binding,
    ),
    createPluginVerifyStartToolDefinition(
      request => ctx.toolchain.startPluginVerification(request),
      binding,
    ),
    createOperationGetToolDefinition(
      request => ctx.toolchain.getOperation(request),
    ),
    createOperationCancelToolDefinition(
      request => ctx.toolchain.cancelOperation(request),
    ),
  ]
  try {
    for (const definition of definitions) {
      if (!isDefaultAgentTool(definition.name)) continue
      disposers.push(tools.register(definition))
    }
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
  private readonly operations: VerificationOperationManager
  private readonly startupTargetIdentity: Promise<DshStartupTargetIdentity | undefined>

  constructor(ctx: Context) {
    super(ctx, 'toolchain')
    this.digest = createNodeSha256Port()
    this.kernel = createNodeKernel(this.digest)
    this.operations = createVerificationOperationManager({
      operationId: randomUUID,
      execute: (request, requestId, signal) => verifyPluginResponse(
        this.kernel,
        request,
        requestId,
        signal,
      ),
    })
    ctx.effect(() => () => this.operations.close())
    // Capture composition and lifecycle from one immutable startup snapshot.
    // The baseline is never refreshed from mutable filesystem state later in this Host.
    const hostIdentity = runningTargetContextIdentity(ctx)
    const runningProfile = provenRunningProfile(process.argv)
    this.startupTargetIdentity = captureStartupTargetBindingIdentity(
      hostIdentity,
      runningProfile,
      this.kernel,
    )
    // Agent Tools that omit a target are bound to that same immutable epoch rather than to a
    // default profile or a fresh read of a profile the Host may no longer be running.
    const dshHome = dshHomeFromContext(ctx)
    const binding = createDshAmbientTargetBinding({
      ...(dshHome === undefined ? {} : {
        host: {
          dshHome,
          ...(runningProfile === undefined ? {} : { runningProfile }),
        },
      }),
      startupIdentity: this.startupTargetIdentity,
      resolveTarget: request => this.kernel.resolveTarget(request),
    })

    ctx.inject(['tools'], (toolCtx) => registerNativeTools(
      toolCtx,
      toolsFromContext(toolCtx),
      {
        search: (request, execution) => this.searchContractsNative(toolCtx, request, execution),
        inspect: (request, execution) => this.inspectContractNative(toolCtx, request, execution),
      },
      binding,
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

  checkPlugin(
    request: PluginCheckRequest,
    requestId: string = randomUUID(),
  ): Promise<PluginCheckResponse> {
    return checkPluginResponse(this.kernel, request, requestId)
  }

  verifyPlugin(
    request: PluginVerifyRequest,
    requestId: string = randomUUID(),
  ): Promise<PluginVerifyResponse> {
    return verifyPluginResponse(this.kernel, request, requestId)
  }

  async startPluginVerification(
    request: PluginVerifyRequest,
    requestId: string = randomUUID(),
  ): Promise<PluginVerifyStartResponse> {
    return startPluginVerificationResponse(
      this.operations,
      parsePluginVerifyRequest(request),
      requestId,
    )
  }

  async getOperation(
    request: OperationRequest,
    requestId: string = randomUUID(),
  ): Promise<OperationGetResponse> {
    return getVerificationOperationResponse(
      this.operations,
      parseOperationRequest(request),
      requestId,
    )
  }

  async cancelOperation(
    request: OperationRequest,
    requestId: string = randomUUID(),
  ): Promise<OperationCancelResponse> {
    return cancelVerificationOperationResponse(
      this.operations,
      parseOperationRequest(request),
      requestId,
    )
  }

  private liveEnrichment(
    ctx: Context,
    execution?: DshContractToolExecutionContext,
  ): ContractEnrichmentPort | undefined {
    if (execution === undefined) return undefined
    const registry = inspectFromContext(ctx)
    if (registry === undefined) return undefined
    const enrichment = createDshLiveContractEnrichment({ registry, execution, digest: this.digest })
    if (enrichment === undefined) return undefined
    const binding = runtimeTargetBindingFromContext(ctx, this.startupTargetIdentity)
    if (binding === undefined) return undefined
    return bindContractEnrichmentToRuntimeTarget(enrichment, binding)
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
