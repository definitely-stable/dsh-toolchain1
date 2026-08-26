import { fileURLToPath } from 'node:url'

import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import ToolchainService from '../../src/integrations/dsh/index.js'

interface TestToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly { readonly type: string; readonly text: string }[]
  }
  execute(args: unknown, execution?: unknown): Promise<unknown>
}

class TestToolsService extends Service {
  readonly definitions = new Map<string, TestToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: TestToolDefinition): () => void {
    if (this.definitions.has(definition.name)) throw new Error(`duplicate tool: ${definition.name}`)
    return this.ctx.effect(() => {
      this.definitions.set(definition.name, definition)
      return () => { this.definitions.delete(definition.name) }
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: TestToolsService
  }
}

const dshHome = fileURLToPath(new URL('../fixtures/targets/valid/dsh-home/', import.meta.url))
const dshPackageRoot = fileURLToPath(new URL('../fixtures/targets/valid/dsh-package/', import.meta.url))

describe('native DSH target tool', () => {
  it('appears only when the tools capability is mounted and follows its lifecycle', async () => {
    const ctx = new Context()
    const toolchainFiber = await ctx.plugin(ToolchainService)
    expect(ctx.get('tools')).toBeUndefined()
    expect(ctx.toolchain.describe().product).toBe('dsh-toolchain')

    const toolsFiber = await ctx.plugin(TestToolsService)
    const tools = ctx.tools
    const definition = tools.definitions.get('toolchain_target_resolve')

    expect(definition).toBeDefined()
    expect(definition?.description).toContain('exact installed DSH target')
    expect(definition?.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: {
          type: 'string',
          description: 'DSH profile name to resolve.',
        },
        dshHome: {
          type: 'string',
          description: 'Optional DSH home override for read-only acquisition.',
        },
        dshPackageRoot: {
          type: 'string',
          description: 'Optional installed @deepseek-ai/dsh package root.',
        },
        patches: {
          type: 'array',
          description: 'Ordered DSH --patch overlay paths.',
          items: { type: 'string' },
        },
      },
      required: ['profile'],
    })
    expect(definition?.output.schema).toEqual({
      type: 'object',
      description: 'Protocol v1 TargetResolveResponse.',
    })

    await toolsFiber.dispose()
    expect(tools.definitions.has('toolchain_target_resolve')).toBe(false)
    expect(ctx.toolchain.describe().product).toBe('dsh-toolchain')

    await toolchainFiber.dispose()
  })

  it('delegates successful and expected-failure calls to ctx.toolchain semantics', async () => {
    const ctx = new Context()
    const toolchainFiber = await ctx.plugin(ToolchainService)
    const toolsFiber = await ctx.plugin(TestToolsService)
    const definition = ctx.tools.definitions.get('toolchain_target_resolve')
    expect(definition).toBeDefined()
    if (definition === undefined) throw new Error('target tool was not registered')

    const success = await definition.execute({
      profile: 'web',
      dshHome,
      dshPackageRoot,
    })
    expect(success).toMatchObject({
      protocolVersion: '1',
      status: 'ok',
      snapshotFingerprint: expect.stringMatching(/^dsh-target-v2:[0-9a-f]{64}$/),
    })

    const failure = await definition.execute({
      profile: 'missing',
      dshHome,
      dshPackageRoot,
    })
    expect(failure).toMatchObject({
      protocolVersion: '1',
      status: 'failed',
      diagnostics: [{ code: 'TARGET_PROFILE_NOT_FOUND', domain: 'target' }],
    })

    const rendered = definition.output.render({}, success)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]?.type).toBe('text')
    expect(JSON.parse(rendered[0]?.text ?? 'null')).toEqual(success)

    await toolsFiber.dispose()
    await toolchainFiber.dispose()
  })
})
