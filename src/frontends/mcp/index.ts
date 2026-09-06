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
import { serializeContractInspectModelResponse } from '../../model/contract-inspect-compact.js'
import {
  parseContractInspectRequest,
  parseContractSearchRequest,
  parsePluginCheckRequest,
  parsePluginVerifyRequest,
  type ContractInspectRequest,
  type ContractInspectResponse,
  type ContractSearchRequest,
  type ContractSearchResponse,
  type PluginCheckRequest,
  type PluginCheckResponse,
  type PluginVerifyRequest,
  type PluginVerifyResponse,
  type TargetResolveRequest,
  type TargetResolveResponse,
} from '../../protocol/index.js'
import { createPackedPluginVerificationExecutionPort } from '../../verification/execution-port.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

export interface BuildMcpServerOptions {
  readonly kernel?: ApplicationKernel
  readonly requestId?: () => string
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

export function buildMcpServer(options: BuildMcpServerOptions = {}): McpServer {
  const kernel = options.kernel ?? createNodeKernel()
  const descriptor = kernel.describe()
  const requestId = options.requestId ?? randomUUID
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

  server.registerTool(targetResolve.name, targetResolve.config, targetResolve.callback)
  server.registerTool(contractSearch.name, contractSearch.config, contractSearch.callback)
  server.registerTool(contractInspect.name, contractInspect.config, contractInspect.callback)
  server.registerTool(pluginCheck.name, pluginCheck.config, pluginCheck.callback)
  server.registerTool(pluginVerify.name, pluginVerify.config, pluginVerify.callback)

  return server
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
