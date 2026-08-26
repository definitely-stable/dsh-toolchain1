import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import { createDshFilesystemTargetAcquisition } from '../../acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../../acquisition/node-sha256.js'
import { createApplicationKernel } from '../../kernel/index.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

function createNodeKernel() {
  const digest = createNodeSha256Port()
  return createApplicationKernel({
    targetAcquisition: createDshFilesystemTargetAcquisition({ digest }),
    digest,
  })
}

export function buildMcpServer(): McpServer {
  const descriptor = createNodeKernel().describe()
  return new McpServer({
    name: descriptor.product,
    version: descriptor.version,
    description: 'Development toolchain for DeepSeek Harness plugins',
  })
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
