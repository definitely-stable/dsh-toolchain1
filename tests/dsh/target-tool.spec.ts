import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ToolchainService from '../../src/integrations/dsh/index.js'
import { DEFAULT_AGENT_TOOL_NAMES } from '../../src/integrations/dsh/agent-surface-policy.js'
import { createTargetResolveToolDefinition } from '../../src/integrations/dsh/target-tool.js'
import type { ContractSearchResponse } from '../../src/protocol/index.js'
import { stubTargetBinding } from '../support/tool-target-binding.js'

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

interface InspectQueryCall {
  readonly platform: string
  readonly providerId: string
  readonly methodName: string
  readonly input: unknown
  readonly agent: unknown
  readonly signal: AbortSignal
}

class TestCordisInspectService extends Service {
  readonly calls: InspectQueryCall[] = []

  constructor(ctx: Context) {
    super(ctx, 'cordisInspect')
  }

  list(): unknown[] {
    return [{
      platform: 'host',
      id: 'Service',
      description: 'test generated Service API catalog',
      methods: [{
        name: 'listService',
        description: 'test compact Service API catalog',
        inputSchema: { type: 'object', additionalProperties: false },
        outputSchema: { type: 'object' },
      }],
    }]
  }

  query(
    platform: string,
    providerId: string,
    methodName: string,
    input: unknown,
    agent: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    this.calls.push({ platform, providerId, methodName, input, agent, signal })
    return Promise.resolve({
      mode: 'catalog',
      services: [{
        key: 'liveAlpha',
        description: 'Alpha Service API contract from the generated Harness catalog.',
        methods: [{ signature: 'ping(): string' }],
      }],
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tools: TestToolsService
    cordisInspect: TestCordisInspectService
  }
}

const fixtureTargets = fileURLToPath(new URL('../fixtures/targets/valid/', import.meta.url))
const fixtureDshPackage = fileURLToPath(new URL('../fixtures/targets/valid/dsh-package/', import.meta.url))

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/**
 * Materialize the install layout a real DSH home has and the shared fixture deliberately omits: the
 * flat `$DSH_HOME/profiles/node_modules` fallback through which a Host resolves the DSH app and its
 * in-box bundles. A Host binding names only profile and home, so this spec needs a realistic graph
 * rather than one that resolves only with an explicit package root.
 */
async function materializeHostHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-host-home-'))
  temporaryRoots.push(root)
  await cp(fixtureTargets, root, { recursive: true })

  const fallback = join(root, 'dsh-home', 'profiles', 'node_modules', '@deepseek-ai')
  await mkdir(join(fallback, 'dsh'), { recursive: true })
  await cp(join(fixtureDshPackage, 'package.json'), join(fallback, 'dsh', 'package.json'))
  for (const bundle of ['dsh-base', 'dsh-web-app']) {
    await cp(
      join(fixtureDshPackage, 'node_modules', '@deepseek-ai', bundle),
      join(fallback, bundle),
      { recursive: true },
    )
  }

  return join(root, 'dsh-home')
}

describe('native DSH Toolchain tools', () => {
  // The native surface resolves an explicit profile inside the Host's own DSH home, so the fixture
  // installation has to be reachable through the same Host capability a real DSH Host exposes.
  async function provideHostHome(ctx: Context): Promise<void> {
    const home = await materializeHostHome()
    ctx.provide('dshHomePath', () => home)
  }

  it('appears only when the tools capability is mounted and follows its lifecycle', async () => {
    const ctx = new Context()
    await provideHostHome(ctx)
    const toolchainFiber = await ctx.plugin(ToolchainService)
    expect(ctx.get('tools')).toBeUndefined()
    expect(ctx.toolchain.describe().product).toBe('dsh-toolchain')

    const toolsFiber = await ctx.plugin(TestToolsService)
    const tools = ctx.tools
    const definition = tools.definitions.get('toolchain_target_resolve')

    // The advertised catalog is the agent-surface policy, in policy order. Asserting
    // against the policy rather than a literal list keeps this test honest when the
    // surface deliberately changes.
    expect([...tools.definitions.keys()]).toEqual([...DEFAULT_AGENT_TOOL_NAMES])
    expect(definition).toBeDefined()
    expect(definition?.description).toContain('exact installed DSH target')
    // One optional flat profile, no nested target and no acquisition hints: omitting it binds the
    // exact target this Host is running in (ADR-0011).
    expect(definition?.parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        profile: {
          type: 'string',
          minLength: 1,
          pattern: '^(?!\\.{1,2}$)(?!node_modules$)[^/\\\\]+$',
          description: 'Optional DSH profile name. Omit to bind the exact DSH target this Host is running in.',
        },
      },
    })
    expect(definition?.output.schema).toEqual({
      type: 'object',
      description: 'Protocol v1 TargetResolveResponse.',
    })

    await toolsFiber.dispose()
    expect(tools.definitions.size).toBe(0)
    expect(ctx.toolchain.describe().product).toBe('dsh-toolchain')

    await toolchainFiber.dispose()
  })

  it('delegates target success and expected failure to ctx.toolchain semantics', async () => {
    const ctx = new Context()
    await provideHostHome(ctx)
    const toolchainFiber = await ctx.plugin(ToolchainService)
    const toolsFiber = await ctx.plugin(TestToolsService)
    const definition = ctx.tools.definitions.get('toolchain_target_resolve')
    expect(definition).toBeDefined()
    if (definition === undefined) throw new Error('target tool was not registered')

    const success = await definition.execute({ profile: 'web' })
    expect(success).toMatchObject({
      protocolVersion: '1',
      status: 'ok',
      snapshotFingerprint: expect.stringMatching(/^dsh-target-v2:[0-9a-f]{64}$/),
    })

    const failure = await definition.execute({ profile: 'missing' })
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

  it('executes registered contract search then inspect through ctx.toolchain semantics', async () => {
    const ctx = new Context()
    await provideHostHome(ctx)
    const toolchainFiber = await ctx.plugin(ToolchainService)
    const toolsFiber = await ctx.plugin(TestToolsService)
    const searchDefinition = ctx.tools.definitions.get('toolchain_contract_search')
    const inspectDefinition = ctx.tools.definitions.get('toolchain_contract_inspect')
    if (searchDefinition === undefined || inspectDefinition === undefined) {
      throw new Error('contract tools were not registered')
    }

    const search = await searchDefinition.execute({
      profile: 'web',
      query: 'a-user-plugin',
    }) as ContractSearchResponse

    expect(search.status).toBe('ok')
    if (search.status !== 'ok') throw new Error('registered contract search unexpectedly failed')
    expect(search.data.matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'package:a-user-plugin', availability: 'unknown' }),
    ]))

    const inspect = await inspectDefinition.execute({
      profile: 'web',
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: 'package:a-user-plugin',
    })
    expect(inspect).toMatchObject({
      protocolVersion: '1',
      status: 'ok',
      snapshotFingerprint: search.snapshotFingerprint,
      data: {
        contractIndexFingerprint: search.data.contractIndexFingerprint,
        contract: { id: 'package:a-user-plugin', availability: 'unknown' },
      },
    })

    await toolsFiber.dispose()
    await toolchainFiber.dispose()
  })

  it('falls back offline when an Agent and Inspect exist but the running DSH target is not proven', async () => {
    const ctx = new Context()
    await provideHostHome(ctx)
    const inspectFiber = await ctx.plugin(TestCordisInspectService)
    const toolchainFiber = await ctx.plugin(ToolchainService)
    const toolsFiber = await ctx.plugin(TestToolsService)
    const searchDefinition = ctx.tools.definitions.get('toolchain_contract_search')
    if (searchDefinition === undefined) throw new Error('contract search tool was not registered')

    const controller = new AbortController()
    const agent = Object.freeze({ id: 'agent-unbound-runtime' })
    const execution = Object.freeze({ agent, signal: controller.signal })

    const search = await searchDefinition.execute({
      profile: 'web',
      query: 'liveAlpha',
      kinds: ['service'],
    }, execution) as ContractSearchResponse

    expect(search.status).toBe('ok')
    if (search.status !== 'ok') throw new Error('contract search unexpectedly failed')
    expect(search.data.matches).toEqual([])
    expect(ctx.cordisInspect.calls).toEqual([])

    await toolsFiber.dispose()
    await toolchainFiber.dispose()
    await inspectFiber.dispose()
  })

  it('binds the running Host target when the Agent omits a profile, and honours an explicit one', async () => {
    const resolve = vi.fn(async () => ({ status: 'ok' }) as never)
    const definition = createTargetResolveToolDefinition(resolve, stubTargetBinding('web'))

    // An omitted profile is not an argument error: the binding decides which target the call is
    // about, and it is the only place allowed to make that decision.
    await expect(Promise.resolve().then(() => definition.execute({}))).resolves.toEqual({ status: 'ok' })
    expect(resolve).toHaveBeenLastCalledWith({ profile: 'web' })

    await expect(Promise.resolve().then(() => definition.execute({ profile: 'tui' })))
      .resolves.toEqual({ status: 'ok' })
    expect(resolve).toHaveBeenLastCalledWith({ profile: 'tui' })
  })

  it.each([
    null,
    { profile: '' },
    { profile: '..' },
    { profile: 'web', unexpected: true },
    { profile: 'web', dshHome: '' },
    { profile: 'web', dshPackageRoot: '' },
    { profile: 'web', patches: 'overlay.yml' },
    { profile: 'web', patches: ['overlay.yml', ''] },
    { target: { profile: 'web' } },
  ])('rejects malformed raw target arguments before invoking Toolchain Service: %j', async (args) => {
    const resolve = vi.fn(async () => {
      throw new Error('resolver must not run for invalid tool arguments')
    })
    const definition = createTargetResolveToolDefinition(resolve, stubTargetBinding())

    await expect(Promise.resolve().then(() => definition.execute(args)))
      .rejects.toThrow(/invalid target\.resolve arguments/i)
    expect(resolve).not.toHaveBeenCalled()
  })
})
