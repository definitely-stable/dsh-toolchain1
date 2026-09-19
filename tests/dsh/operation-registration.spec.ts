import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_TOOL_NAMES,
  OMITTED_FROM_DEFAULT_AGENT_SURFACE,
} from '../../src/integrations/dsh/agent-surface-policy.js'
import ToolchainService from '../../src/integrations/dsh/index.js'
import type { DshToolDefinition } from '../../src/integrations/dsh/target-tool.js'

class TestToolsService extends Service {
  readonly definitions = new Map<string, DshToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: DshToolDefinition): () => void {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      return () => { this.definitions.delete(definition.name) }
    })
  }
}

async function mountService() {
  const ctx = new Context()
  const toolchainFiber = await ctx.plugin(ToolchainService)
  expect(ctx.get('tools')).toBeUndefined()

  const toolsFiber = await ctx.plugin(TestToolsService)
  const tools = ctx.get('tools') as TestToolsService | undefined
  expect(tools).toBeDefined()
  if (tools === undefined) throw new Error('tools capability was not mounted')
  return { ctx, tools, toolsFiber, toolchainFiber }
}

describe('native DSH default agent tool surface', () => {
  it('advertises only the coding-agent surface and withholds the operation lifecycle', async () => {
    const { ctx, tools, toolsFiber, toolchainFiber } = await mountService()

    // The advertised catalog is the policy, in policy order.
    expect([...tools.definitions.keys()]).toEqual([...DEFAULT_AGENT_TOOL_NAMES])

    // The asynchronous lifecycle is a persistent-client capability, not a coding-agent
    // one: H2 never called any of the three across 36 observations, so their schemas
    // were pure advertised cost. Withheld rather than deleted — see the policy module.
    for (const withheld of OMITTED_FROM_DEFAULT_AGENT_SURFACE) {
      expect(tools.definitions.has(withheld), `${withheld} must not be advertised by default`).toBe(false)
    }

    await toolsFiber.dispose()
    expect(ctx.get('tools')).toBeUndefined()
    await toolchainFiber.dispose()
  })

  it('keeps the withheld operations reachable through the application service', async () => {
    // Withholding a tool must not remove the capability. The service methods that back
    // the three omitted tools stay callable, so a persistent Host, Web or MCP frontend
    // can still start, poll and cancel a verification operation.
    const { ctx, toolchainFiber, toolsFiber } = await mountService()
    const service = ctx.get('toolchain') as unknown as Record<string, unknown>
    for (const method of ['startPluginVerification', 'getOperation', 'cancelOperation']) {
      expect(typeof service[method], `ctx.toolchain.${method}`).toBe('function')
    }
    await toolsFiber.dispose()
    await toolchainFiber.dispose()
  })
})
