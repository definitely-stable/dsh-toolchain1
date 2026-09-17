import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

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

describe('native DSH verification operation registration', () => {
  it('registers start/get/cancel in the same host-owned tools lifecycle', async () => {
    const ctx = new Context()
    const toolchainFiber = await ctx.plugin(ToolchainService)
    expect(ctx.get('tools')).toBeUndefined()

    const toolsFiber = await ctx.plugin(TestToolsService)
    const tools = ctx.get('tools') as TestToolsService | undefined
    expect(tools).toBeDefined()
    if (tools === undefined) throw new Error('tools capability was not mounted')

    expect([...tools.definitions.keys()]).toEqual([
      'toolchain_target_resolve',
      'toolchain_contract_search',
      'toolchain_contract_inspect',
      'toolchain_plugin_check',
      'toolchain_plugin_verify',
      'toolchain_plugin_verify_start',
      'toolchain_operation_get',
      'toolchain_operation_cancel',
    ])

    await toolsFiber.dispose()
    expect(ctx.get('tools')).toBeUndefined()
    await toolchainFiber.dispose()
  })
})
