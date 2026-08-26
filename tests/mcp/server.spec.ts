import { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it, vi } from 'vitest'

import { buildMcpServer, launchMcpStdio } from '../../src/frontends/mcp/index.js'

describe('MCP frontend', () => {
  it('builds a fresh MCP server from the shared product identity', () => {
    const first = buildMcpServer()
    const second = buildMcpServer()

    expect(first).toBeInstanceOf(McpServer)
    expect(second).toBeInstanceOf(McpServer)
    expect(second).not.toBe(first)
  })

  it('delegates stdio ownership to serveStdio with a fresh-server factory', () => {
    const servers: McpServer[] = []
    const handle = { close: vi.fn(async () => undefined) }
    const serve = vi.fn((factory: () => McpServer) => {
      servers.push(factory(), factory())
      return handle
    })

    expect(launchMcpStdio(serve)).toBe(handle)
    expect(serve).toHaveBeenCalledOnce()
    expect(servers).toHaveLength(2)
    expect(servers[0]).not.toBe(servers[1])
  })
})
