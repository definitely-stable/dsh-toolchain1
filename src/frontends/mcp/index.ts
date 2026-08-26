import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

import { createApplicationKernel } from '../../kernel/index.js'

export type ServeStdio = (factory: () => McpServer) => StdioServerHandle

export function buildMcpServer(): McpServer {
  const descriptor = createApplicationKernel().describe()
  return new McpServer({
    name: descriptor.product,
    version: descriptor.version,
    description: 'Development toolchain for DeepSeek Harness plugins',
  })
}

export function launchMcpStdio(serve: ServeStdio = serveStdio): StdioServerHandle {
  return serve(() => buildMcpServer())
}
