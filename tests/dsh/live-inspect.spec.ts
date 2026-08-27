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
}

const generousLimits: TestLiveContractLimits = {
  maxProviderEntries: 16,
  maxProviderResultBytes: 64 * 1024,
  maxJsonDepth: 16,
  maxJsonNodes: 10_000,
  maxContracts: 128,
  maxFactsPerContract: 128,
  maxFactsTotal: 1024,
}

const snapshot = Object.freeze({}) as TargetSnapshot

function serviceProvider(): unknown {
  return {
    platform: 'host',
    id: 'Service',
    methods: [{ name: 'listService' }],
  }
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
})
