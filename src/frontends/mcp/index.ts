import { randomUUID } from 'node:crypto'

import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import protocolSchema from '../../../spec/schemas/v1/toolchain-protocol.schema.json' with { type: 'json' }
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
  type ApplicationKernel,
  type VerificationApplicationKernel,
} from '../../kernel/index.js'
import {
  cancelVerificationOperationResponse,
  createVerificationOperationManager,
  getVerificationOperationResponse,
  startPluginVerificationResponse,
  type VerificationOperationManager,
} from '../../kernel/operation.js'
import { serializeContractInspectModelResponse } from '../../model/contract-inspect-compact.js'
import {
  parseContractInspectRequest,
  parseContractSearchRequest,
  parseOperationRequest,
  parsePluginCheckRequest,
  parsePluginVerifyRequest,
  type ContractInspectRequest,
  type ContractInspectResponse,
  type ContractSearchRequest,
  type ContractSearchResponse,
  type OperationCancelResponse,
  type OperationGetResponse,
  type OperationRequest,
  type PluginCheckRequest,
  type PluginCheckResponse,
  type PluginVerifyRequest,
  type PluginVerifyResponse,
  type PluginVerifyStartResponse,
  type TargetResolveRequest,
  type TargetResolveResponse,
} from '../../protocol/index.js'
import { createPackedPluginVerificationExecutionPort } from '../../verification/execution-port.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

export interface BuildMcpServerOptions {
  readonly kernel?: ApplicationKernel
  readonly requestId?: () => string
  readonly operationId?: () => string
}

interface ReadOnlyIdempotentAnnotations {
  readonly readOnlyHint: true
  readonly idempotentHint: true
}

interface ExecutingAnnotations {
  readonly readOnlyHint: false
  readonly idempotentHint: false
}

type McpStructuredResult<T> = {
  readonly content: [{ readonly type: 'text'; readonly text: string }]
  readonly structuredContent: T
}

export interface TargetResolveMcpTool {
  readonly name: 'target.resolve'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<TargetResolveRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<TargetResolveResponse>>
    readonly annotations: ReadOnlyIdempotentAnnotations
  }
  readonly callback: (request: TargetResolveRequest) => Promise<McpStructuredResult<TargetResolveResponse>>
}

export interface ContractSearchMcpTool {
  readonly name: 'contract.search'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<ContractSearchRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<ContractSearchResponse>>
    readonly annotations: ReadOnlyIdempotentAnnotations
  }
  readonly callback: (request: ContractSearchRequest) => Promise<McpStructuredResult<ContractSearchResponse>>
}

export interface ContractInspectMcpTool {
  readonly name: 'contract.inspect'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<ContractInspectRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<ContractInspectResponse>>
    readonly annotations: ReadOnlyIdempotentAnnotations
  }
  readonly callback: (request: ContractInspectRequest) => Promise<McpStructuredResult<ContractInspectResponse>>
}

export interface PluginCheckMcpTool {
  readonly name: 'plugin.check'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<PluginCheckRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<PluginCheckResponse>>
    readonly annotations: ReadOnlyIdempotentAnnotations
  }
  readonly callback: (request: PluginCheckRequest) => Promise<McpStructuredResult<PluginCheckResponse>>
}

export interface PluginVerifyMcpTool {
  readonly name: 'plugin.verify'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<PluginVerifyRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<PluginVerifyResponse>>
    readonly annotations: ExecutingAnnotations
  }
  readonly callback: (request: PluginVerifyRequest) => Promise<McpStructuredResult<PluginVerifyResponse>>
}

export interface PluginVerifyStartMcpTool {
  readonly name: 'plugin.verify.start'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<PluginVerifyRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<PluginVerifyStartResponse>>
    readonly annotations: ExecutingAnnotations
  }
  readonly callback: (request: PluginVerifyRequest) => Promise<McpStructuredResult<PluginVerifyStartResponse>>
}

export interface OperationGetMcpTool {
  readonly name: 'operation.get'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<OperationRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<OperationGetResponse>>
    readonly annotations: ReadOnlyIdempotentAnnotations
  }
  readonly callback: (request: OperationRequest) => Promise<McpStructuredResult<OperationGetResponse>>
}

export interface OperationCancelMcpTool {
  readonly name: 'operation.cancel'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<OperationRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<OperationCancelResponse>>
    readonly annotations: ExecutingAnnotations
  }
  readonly callback: (request: OperationRequest) => Promise<McpStructuredResult<OperationCancelResponse>>
}

export interface VerificationOperationMcpTools {
  readonly start: PluginVerifyStartMcpTool
  readonly get: OperationGetMcpTool
  readonly cancel: OperationCancelMcpTool
}

function createNodeKernel(): VerificationApplicationKernel {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
    pluginSubjectAcquisition: createPluginSubjectAcquisition(digest),
    pluginVerificationExecution: createPackedPluginVerificationExecutionPort(),
    digest,
  })
}

function verificationKernel(kernel: ApplicationKernel): VerificationApplicationKernel | undefined {
  return typeof kernel.verifyPlugin === 'function'
    ? kernel as VerificationApplicationKernel
    : undefined
}

type ProtocolDefinition =
  | 'targetResolveRequest'
  | 'targetResolveResponse'
  | 'contractSearchRequest'
  | 'contractSearchResponse'
  | 'contractInspectRequest'
  | 'contractInspectResponse'
  | 'pluginCheckRequest'
  | 'pluginCheckResponse'
  | 'pluginVerifyRequest'
  | 'pluginVerifyResponse'
  | 'pluginVerifyStartResponse'
  | 'operationRequest'
  | 'operationGetResponse'
  | 'operationCancelResponse'

function protocolDefinitionSchema(definition: ProtocolDefinition) {
  return {
    $schema: protocolSchema.$schema,
    $ref: `#/$defs/${definition}`,
    $defs: protocolSchema.$defs,
  }
}

function structuredResult<T>(response: T): McpStructuredResult<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(response) }],
    structuredContent: response,
  }
}

function structuredSerializedResult<T>(response: T, text: string): McpStructuredResult<T> {
  return {
    content: [{ type: 'text', text }],
    structuredContent: response,
  }
}

const readOnlyIdempotent = Object.freeze({
  readOnlyHint: true as const,
  idempotentHint: true as const,
})

const executing = Object.freeze({
  readOnlyHint: false as const,
  idempotentHint: false as const,
})

export function createTargetResolveMcpTool(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
): TargetResolveMcpTool {
  const inputSchema = fromJsonSchema<TargetResolveRequest>(
    protocolDefinitionSchema('targetResolveRequest'),
  )
  const outputSchema = fromJsonSchema<TargetResolveResponse>(
    protocolDefinitionSchema('targetResolveResponse'),
  )

  return {
    name: 'target.resolve',
    config: {
      description: 'Resolve the exact installed DSH target and return its canonical Toolchain Protocol response.',
      inputSchema,
      outputSchema,
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => structuredResult(
      await resolveTargetResponse(kernel, request, requestId()),
    ),
  }
}

export function createContractSearchMcpTool(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
): ContractSearchMcpTool {
  const inputSchema = fromJsonSchema<ContractSearchRequest>(
    protocolDefinitionSchema('contractSearchRequest'),
  )
  const outputSchema = fromJsonSchema<ContractSearchResponse>(
    protocolDefinitionSchema('contractSearchResponse'),
  )

  return {
    name: 'contract.search',
    config: {
      description: 'Search deterministic contract evidence for one exact installed DSH target. Use data.matches[].id as contract.inspect contractId; evidence ids are provenance only.',
      inputSchema,
      outputSchema,
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => structuredResult(
      await searchContractsResponse(kernel, parseContractSearchRequest(request), requestId()),
    ),
  }
}

export function createContractInspectMcpTool(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
): ContractInspectMcpTool {
  const inputSchema = fromJsonSchema<ContractInspectRequest>(
    protocolDefinitionSchema('contractInspectRequest'),
  )
  const outputSchema = fromJsonSchema<ContractInspectResponse>(
    protocolDefinitionSchema('contractInspectResponse'),
  )

  return {
    name: 'contract.inspect',
    config: {
      description: 'Inspect one exact DSH contract. Copy contractId exactly from contract.search data.matches[].id; do not pass evidence ids.',
      inputSchema,
      outputSchema,
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => {
      const response = await inspectContractResponse(
        kernel,
        parseContractInspectRequest(request),
        requestId(),
      )
      return structuredSerializedResult(
        response,
        serializeContractInspectModelResponse(response),
      )
    },
  }
}

export function createPluginCheckMcpTool(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
): PluginCheckMcpTool {
  const inputSchema = fromJsonSchema<PluginCheckRequest>(
    protocolDefinitionSchema('pluginCheckRequest'),
  )
  const outputSchema = fromJsonSchema<PluginCheckResponse>(
    protocolDefinitionSchema('pluginCheckResponse'),
  )

  return {
    name: 'plugin.check',
    config: {
      description: 'Run the static Exact Target Plugin Check against one installed DSH target without executing candidate code or mutating the target profile.',
      inputSchema,
      outputSchema,
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => structuredResult(
      await checkPluginResponse(kernel, parsePluginCheckRequest(request), requestId()),
    ),
  }
}

export function createPluginVerifyMcpTool(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
): PluginVerifyMcpTool {
  const inputSchema = fromJsonSchema<PluginVerifyRequest>(
    protocolDefinitionSchema('pluginVerifyRequest'),
  )
  const outputSchema = fromJsonSchema<PluginVerifyResponse>(
    protocolDefinitionSchema('pluginVerifyResponse'),
  )

  return {
    name: 'plugin.verify',
    config: {
      description: 'Execute one packed plugin in an isolated temporary DSH environment under the safe policy and return the canonical verification receipt.',
      inputSchema,
      outputSchema,
      annotations: executing,
    },
    callback: async (request) => {
      const verification = verificationKernel(kernel)
      if (verification === undefined) {
        throw new Error('Plugin verification execution is not configured for this MCP server')
      }
      return structuredResult(
        await verifyPluginResponse(
          verification,
          parsePluginVerifyRequest(request),
          requestId(),
        ),
      )
    },
  }
}

function operationManagerOrThrow(
  manager: VerificationOperationManager | undefined,
): VerificationOperationManager {
  if (manager === undefined) {
    throw new Error('Plugin verification execution is not configured for this MCP server')
  }
  return manager
}

export function createVerificationOperationMcpTools(
  kernel: ApplicationKernel,
  requestId: () => string = randomUUID,
  operationId: () => string = randomUUID,
): VerificationOperationMcpTools {
  const verification = verificationKernel(kernel)
  const manager = verification === undefined
    ? undefined
    : createVerificationOperationManager({
        operationId,
        execute: (request, operationRequestId, signal) => verifyPluginResponse(
          verification,
          request,
          operationRequestId,
          signal,
        ),
      })

  const start: PluginVerifyStartMcpTool = {
    name: 'plugin.verify.start',
    config: {
      description: 'Start one packed-plugin verification operation in this persistent MCP server. Use operation.get for status and operation.cancel for cooperative cancellation.',
      inputSchema: fromJsonSchema<PluginVerifyRequest>(
        protocolDefinitionSchema('pluginVerifyRequest'),
      ),
      outputSchema: fromJsonSchema<PluginVerifyStartResponse>(
        protocolDefinitionSchema('pluginVerifyStartResponse'),
      ),
      annotations: executing,
    },
    callback: async (request) => structuredResult(
      startPluginVerificationResponse(
        operationManagerOrThrow(manager),
        parsePluginVerifyRequest(request),
        requestId(),
      ),
    ),
  }

  const get: OperationGetMcpTool = {
    name: 'operation.get',
    config: {
      description: 'Read the current snapshot of one verification operation owned by this persistent MCP server.',
      inputSchema: fromJsonSchema<OperationRequest>(
        protocolDefinitionSchema('operationRequest'),
      ),
      outputSchema: fromJsonSchema<OperationGetResponse>(
        protocolDefinitionSchema('operationGetResponse'),
      ),
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => structuredResult(
      getVerificationOperationResponse(
        operationManagerOrThrow(manager),
        parseOperationRequest(request),
        requestId(),
      ),
    ),
  }

  const cancel: OperationCancelMcpTool = {
    name: 'operation.cancel',
    config: {
      description: 'Request cooperative cancellation of one verification operation owned by this persistent MCP server.',
      inputSchema: fromJsonSchema<OperationRequest>(
        protocolDefinitionSchema('operationRequest'),
      ),
      outputSchema: fromJsonSchema<OperationCancelResponse>(
        protocolDefinitionSchema('operationCancelResponse'),
      ),
      annotations: executing,
    },
    callback: async (request) => structuredResult(
      cancelVerificationOperationResponse(
        operationManagerOrThrow(manager),
        parseOperationRequest(request),
        requestId(),
      ),
    ),
  }

  return Object.freeze({ start, get, cancel })
}

export function buildMcpServer(options: BuildMcpServerOptions = {}): McpServer {
  const kernel = options.kernel ?? createNodeKernel()
  const descriptor = kernel.describe()
  const requestId = options.requestId ?? randomUUID
  const operationId = options.operationId ?? randomUUID
  const server = new McpServer({
    name: descriptor.product,
    version: descriptor.version,
    description: 'Development toolchain for DeepSeek Harness plugins',
  })
  const targetResolve = createTargetResolveMcpTool(kernel, requestId)
  const contractSearch = createContractSearchMcpTool(kernel, requestId)
  const contractInspect = createContractInspectMcpTool(kernel, requestId)
  const pluginCheck = createPluginCheckMcpTool(kernel, requestId)
  const pluginVerify = createPluginVerifyMcpTool(kernel, requestId)
  const operations = createVerificationOperationMcpTools(kernel, requestId, operationId)

  server.registerTool(targetResolve.name, targetResolve.config, targetResolve.callback)
  server.registerTool(contractSearch.name, contractSearch.config, contractSearch.callback)
  server.registerTool(contractInspect.name, contractInspect.config, contractInspect.callback)
  server.registerTool(pluginCheck.name, pluginCheck.config, pluginCheck.callback)
  server.registerTool(pluginVerify.name, pluginVerify.config, pluginVerify.callback)
  server.registerTool(operations.start.name, operations.start.config, operations.start.callback)
  server.registerTool(operations.get.name, operations.get.config, operations.get.callback)
  server.registerTool(operations.cancel.name, operations.cancel.config, operations.cancel.callback)

  return server
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
