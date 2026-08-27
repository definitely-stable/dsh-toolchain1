import { randomUUID } from 'node:crypto'

import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import protocolSchema from '../../../spec/schemas/v1/toolchain-protocol.schema.json' with { type: 'json' }
import { createDshContractFilesystemAcquisition } from '../../acquisition/dsh-contract-filesystem.js'
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import {
  createApplicationKernel,
  inspectContractResponse,
  resolveTargetResponse,
  searchContractsResponse,
  type ApplicationKernel,
} from '../../kernel/index.js'
import {
  parseContractInspectRequest,
  parseContractSearchRequest,
  type ContractInspectRequest,
  type ContractInspectResponse,
  type ContractSearchRequest,
  type ContractSearchResponse,
  type TargetResolveRequest,
  type TargetResolveResponse,
} from '../../protocol/index.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

export interface BuildMcpServerOptions {
  readonly kernel?: ApplicationKernel
  readonly requestId?: () => string
}

interface ReadOnlyIdempotentAnnotations {
  readonly readOnlyHint: true
  readonly idempotentHint: true
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

function createNodeKernel(): ApplicationKernel {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    contractAcquisition: createDshContractFilesystemAcquisition({ digest }),
    digest,
  })
}

type ProtocolDefinition =
  | 'targetResolveRequest'
  | 'targetResolveResponse'
  | 'contractSearchRequest'
  | 'contractSearchResponse'
  | 'contractInspectRequest'
  | 'contractInspectResponse'

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

const readOnlyIdempotent = Object.freeze({
  readOnlyHint: true as const,
  idempotentHint: true as const,
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
      description: 'Search deterministic contract evidence for one exact installed DSH target.',
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
      description: 'Inspect one contract against an exact deterministic contract-index fingerprint.',
      inputSchema,
      outputSchema,
      annotations: readOnlyIdempotent,
    },
    callback: async (request) => structuredResult(
      await inspectContractResponse(kernel, parseContractInspectRequest(request), requestId()),
    ),
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

  server.registerTool(targetResolve.name, targetResolve.config, targetResolve.callback)
  server.registerTool(contractSearch.name, contractSearch.config, contractSearch.callback)
  server.registerTool(contractInspect.name, contractInspect.config, contractInspect.callback)

  return server
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
