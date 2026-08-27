import { describe, expect, it, vi } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createDshLiveContractEnrichment,
  type DshCordisInspectRegistryPort,
} from '../../src/integrations/dsh/live-inspect.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

interface TestLiveContractLimits {
  readonly maxProviderEntries: number
  readonly maxProviderResultBytes: number
  readonly maxJsonDepth: number
  readonly maxJsonNodes: number
  readonly maxContracts: number
  readonly maxFactsPerContract: number
  readonly maxFactsTotal: number
  readonly maxToolSchemaBytesPerTool: number
  readonly maxToolSchemaBytesTotal: number
}

const generousLimits: TestLiveContractLimits = {
  maxProviderEntries: 16,
  maxProviderResultBytes: 64 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 10_000,
  maxContracts: 128,
  maxFactsPerContract: 128,
  maxFactsTotal: 1024,
  maxToolSchemaBytesPerTool: 16 * 1024,
  maxToolSchemaBytesTotal: 64 * 1024,
}

const snapshot = Object.freeze({}) as TargetSnapshot

function inspectProvider(id: string, method: string): unknown {
  return {
    platform: 'host',
    id,
    methods: [{ name: method }],
  }
}

function serviceProvider(): unknown {
  return inspectProvider('Service', 'listService')
}

function eventProvider(): unknown {
  return inspectProvider('Event', 'listEvents')
}

function toolProvider(): unknown {
  return inspectProvider('Tool', 'listTools')
}

function serviceCatalog(services: readonly unknown[] = []): Record<string, unknown> {
  return { mode: 'catalog', services }
}

function liveHarness(
  result: unknown,
  limits: TestLiveContractLimits,
  providers: readonly unknown[] = [serviceProvider()],
) {
  const controller = new AbortController()
  const agent = Object.freeze({ id: 'budget-agent' })
  const query = vi.fn(async (
    _platform: 'host' | 'client',
    _providerId: string,
    _methodName: string,
    _input: unknown,
    _agent: unknown,
    _signal: AbortSignal,
  ) => result)
  const registry: DshCordisInspectRegistryPort = {
    list: () => providers,
    query,
  }
  const options = {
    registry,
    execution: Object.freeze({ agent, signal: controller.signal }),
    digest: createNodeSha256Port(),
    limits,
  }
  const enrichment = createDshLiveContractEnrichment(options)
  if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
  return { enrichment, query }
}

async function expectLimitFailure(
  result: unknown,
  limits: TestLiveContractLimits,
  providers?: readonly unknown[],
) {
  const { enrichment } = liveHarness(result, limits, providers)
  await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
    code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
  })
}

function providerResult(providerId: string): unknown {
  if (providerId === 'Service') {
    return serviceCatalog([{
      key: 'alpha',
      description: 'Alpha Service.',
      methods: [{ signature: 'ping(): string' }],
    }])
  }
  if (providerId === 'Event') {
    return {
      mode: 'catalog',
      events: [{
        name: 'tools/change',
        description: 'Tool registry changed.',
        mode: 'emit',
        signature: '(): void',
      }],
    }
  }
  if (providerId === 'Tool') {
    return {
      tools: [{
        name: 'agent_only',
        description: 'Visible only in this Agent scope.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
      }],
    }
  }
  throw new Error(`unexpected provider ${providerId}`)
}

function allHostProvidersHarness(limits: TestLiveContractLimits = generousLimits) {
  const controller = new AbortController()
  const agent = Object.freeze({ id: 'agent-scoped-tools' })
  const query = vi.fn(async (
    platform: 'host' | 'client',
    providerId: string,
    _methodName: string,
    _input: unknown,
    actualAgent: unknown,
    signal: AbortSignal,
  ) => {
    expect(platform).toBe('host')
    expect(actualAgent).toBe(agent)
    expect(signal).toBe(controller.signal)
    return providerResult(providerId)
  })
  const registry: DshCordisInspectRegistryPort = {
    // Deliberately reverse the canonical query order.
    list: () => [toolProvider(), eventProvider(), serviceProvider()],
    query,
  }
  const enrichment = createDshLiveContractEnrichment({
    registry,
    execution: Object.freeze({ agent, signal: controller.signal }),
    digest: createNodeSha256Port(),
    limits,
  })
  if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
  return { enrichment, query }
}

describe('DSH live Inspect safety budgets', () => {
  it('rejects provider directories larger than the configured bound before any query', async () => {
    const limits = { ...generousLimits, maxProviderEntries: 1 }
    const providers = [serviceProvider(), { platform: 'host', id: 'Other', methods: [] }]
    const { enrichment, query } = liveHarness(serviceCatalog(), limits, providers)

    await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
      code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects serialized provider results larger than the configured byte bound', async () => {
    const limits = { ...generousLimits, maxProviderResultBytes: 128 }
    await expectLimitFailure(serviceCatalog([{
      key: 'oversized',
      description: 'x'.repeat(512),
      methods: [],
    }]), limits)
  })

  it('rejects provider JSON exceeding configured depth even when deep data is otherwise ignored', async () => {
    const limits = { ...generousLimits, maxJsonDepth: 4 }
    await expectLimitFailure({
      ...serviceCatalog(),
      extra: { a: { b: { c: { d: 'too-deep' } } } },
    }, limits)
  })

  it('rejects provider JSON exceeding configured node count', async () => {
    const limits = { ...generousLimits, maxJsonNodes: 10 }
    await expectLimitFailure({
      ...serviceCatalog(),
      extra: Array.from({ length: 32 }, (_, index) => index),
    }, limits)
  })

  it('rejects more normalized contracts than the configured bound', async () => {
    const limits = { ...generousLimits, maxContracts: 1 }
    await expectLimitFailure(serviceCatalog([
      { key: 'alpha', methods: [] },
      { key: 'beta', methods: [] },
    ]), limits)
  })

  it('rejects more facts on one contract than the configured bound', async () => {
    const limits = { ...generousLimits, maxFactsPerContract: 1 }
    await expectLimitFailure(serviceCatalog([{
      key: 'alpha',
      methods: [{ signature: 'a(): void' }, { signature: 'b(): void' }],
    }]), limits)
  })

  it('rejects aggregate live facts beyond the configured bound', async () => {
    const limits = { ...generousLimits, maxFactsTotal: 2 }
    await expectLimitFailure(serviceCatalog([
      { key: 'alpha', methods: [{ signature: 'a(): void' }, { signature: 'b(): void' }] },
      { key: 'beta', methods: [{ signature: 'c(): void' }, { signature: 'd(): void' }] },
    ]), limits)
  })

  it('rejects one Tool parameter schema beyond its dedicated byte bound', async () => {
    const limits = { ...generousLimits, maxToolSchemaBytesPerTool: 96 }
    await expectLimitFailure({
      tools: [{
        name: 'oversized_tool',
        description: 'oversized',
        parameters: { type: 'object', description: 'x'.repeat(256) },
      }],
    }, limits, [toolProvider()])
  })

  it('rejects aggregate Tool parameter schemas beyond their dedicated byte bound', async () => {
    const limits = { ...generousLimits, maxToolSchemaBytesTotal: 128 }
    await expectLimitFailure({
      tools: [
        { name: 'alpha', description: 'a', parameters: { type: 'object', description: 'x'.repeat(80) } },
        { name: 'beta', description: 'b', parameters: { type: 'object', description: 'y'.repeat(80) } },
      ],
    }, limits, [toolProvider()])
  })

  it('applies normalized contract and fact limits across all supported Host providers', async () => {
    const contractHarness = allHostProvidersHarness({ ...generousLimits, maxContracts: 2 })
    await expect(contractHarness.enrichment.enrich(snapshot)).rejects.toMatchObject({
      code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
    })

    const factHarness = allHostProvidersHarness({ ...generousLimits, maxFactsTotal: 3 })
    await expect(factHarness.enrichment.enrich(snapshot)).rejects.toMatchObject({
      code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
    })
  })
})

describe('DSH live Host provider normalization', () => {
  it('queries Service, Event, and Agent-scoped Tool in canonical order without overstating catalog liveness', async () => {
    const { enrichment, query } = allHostProvidersHarness()
    const acquired = await enrichment.enrich(snapshot)

    expect(query.mock.calls.map(call => call.slice(0, 4))).toEqual([
      ['host', 'Service', 'listService', {}],
      ['host', 'Event', 'listEvents', {}],
      ['host', 'Tool', 'listTools', {}],
    ])
    expect(acquired.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'service:host:alpha',
        kind: 'service',
        availability: 'unknown',
      }),
      expect.objectContaining({
        id: 'event:host:tools/change',
        kind: 'event',
        name: 'tools/change',
        qualifiedName: 'event:tools/change',
        availability: 'unknown',
        facts: expect.arrayContaining([
          expect.objectContaining({ key: 'dispatch-mode', value: 'emit' }),
          expect.objectContaining({ key: 'listener-signature', value: '(): void' }),
        ]),
      }),
      expect.objectContaining({
        id: 'tool:host:agent_only',
        kind: 'tool',
        name: 'agent_only',
        qualifiedName: 'tool:agent_only',
        availability: 'available',
        facts: expect.arrayContaining([
          expect.objectContaining({
            key: 'parameters-schema',
            value: '{"properties":{"path":{"type":"string"}},"type":"object"}',
          }),
        ]),
      }),
    ]))
    expect(acquired.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'generated-catalog:cordis-inspect:host:Service:listService',
        kind: 'generated-catalog',
        strength: 'authoritative',
      }),
      expect.objectContaining({
        id: 'generated-catalog:cordis-inspect:host:Event:listEvents',
        kind: 'generated-catalog',
        strength: 'authoritative',
      }),
      expect.objectContaining({
        id: 'runtime:cordis-inspect:host:Tool:listTools',
        kind: 'runtime',
        strength: 'observed',
      }),
    ]))
  })

  it('uses code-point ordering rather than locale collation for semantic Service identity', async () => {
    const { enrichment } = liveHarness(serviceCatalog([
      { key: 'a', methods: [] },
      { key: 'Z', methods: [] },
    ]), generousLimits)

    const acquired = await enrichment.enrich(snapshot)
    expect(acquired.contracts.map(contract => contract.id)).toEqual([
      'service:host:Z',
      'service:host:a',
    ])
  })

  it('maps ordinary provider query failures into the Toolchain live-evidence error family', async () => {
    const controller = new AbortController()
    const registry: DshCordisInspectRegistryPort = {
      list: () => [toolProvider()],
      query: vi.fn(async () => {
        throw new Error('Host Cordis inspect provider "Tool" is not registered')
      }),
    }
    const enrichment = createDshLiveContractEnrichment({
      registry,
      execution: Object.freeze({ agent: Object.freeze({ id: 'race-agent' }), signal: controller.signal }),
      digest: createNodeSha256Port(),
    })
    if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')

    await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
      name: 'ContractAcquisitionError',
      code: 'CONTRACT_LIVE_EVIDENCE_INVALID',
    })
  })

  it('preserves provider cancellation instead of relabelling it as invalid evidence', async () => {
    const controller = new AbortController()
    const registry: DshCordisInspectRegistryPort = {
      list: () => [toolProvider()],
      query: vi.fn(async () => {
        throw new DOMException('This operation was aborted', 'AbortError')
      }),
    }
    const enrichment = createDshLiveContractEnrichment({
      registry,
      execution: Object.freeze({ agent: Object.freeze({ id: 'cancel-agent' }), signal: controller.signal }),
      digest: createNodeSha256Port(),
    })
    if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')

    await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
