import { randomUUID } from 'node:crypto'

import { fromJsonSchema, McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import protocolSchema from '../../../spec/schemas/v1/toolchain-protocol.schema.json' with { type: 'json' }
import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import {
  createApplicationKernel,
  resolveTargetResponse,
  type ApplicationKernel,
} from '../../kernel/index.js'
import type {
  TargetResolveRequest,
  TargetResolveResponse,
} from '../../protocol/index.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

export interface BuildMcpServerOptions {
  readonly kernel?: ApplicationKernel
  readonly requestId?: () => string
}

export interface TargetResolveMcpTool {
  readonly name: 'target.resolve'
  readonly config: {
    readonly description: string
    readonly inputSchema: ReturnType<typeof fromJsonSchema<TargetResolveRequest>>
    readonly outputSchema: ReturnType<typeof fromJsonSchema<TargetResolveResponse>>
    readonly annotations: {
      readonly readOnlyHint: true
      readonly idempotentHint: true
    }
  }
  readonly callback: (request: TargetResolveRequest) => Promise<{
    readonly content: [{ readonly type: 'text'; readonly text: string }]
    readonly structuredContent: TargetResolveResponse
  }>
}

function createNodeKernel() {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    digest,
  })
}

function protocolDefinitionSchema(definition: 'targetResolveRequest' | 'targetResolveResponse') {
  return {
    $schema: protocolSchema.$schema,
    $ref: `#/$defs/${definition}`,
    $defs: protocolSchema.$defs,
  }
}

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
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    callback: async (request) => {
      const response = await resolveTargetResponse(kernel, request, requestId())
      return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
        structuredContent: response,
      }
    },
  }
}

export function buildMcpServer(options: BuildMcpServerOptions = {}): McpServer {
  const kernel = options.kernel ?? createNodeKernel()
  const descriptor = kernel.describe()
  const server = new McpServer({
    name: descriptor.product,
    version: descriptor.version,
    description: 'Development toolchain for DeepSeek Harness plugins',
  })
  const targetResolve = createTargetResolveMcpTool(
    kernel,
    options.requestId ?? randomUUID,
  )

  server.registerTool(
    targetResolve.name,
    targetResolve.config,
    targetResolve.callback,
  )

  return server
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
