import { describe, expect, it, vi } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createDshLiveContractEnrichment,
  type DshCordisInspectRegistryPort,
} from '../../src/integrations/dsh/live-inspect.js'
import { createContractIndex, type ContractEnrichmentPort } from '../../src/model/contract.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const digest = createNodeSha256Port()
const snapshot = Object.freeze({}) as TargetSnapshot
const targetFingerprint = `dsh-target-v2:${'c'.repeat(64)}`

function slotsProvider(): unknown {
  return {
    platform: 'client',
    id: 'Slots',
    methods: [{ name: 'listSubTree' }],
  }
}

function slotResult(): unknown {
  return {
    trees: [{
      name: 'root',
      kind: 'single',
      scope: 'root',
      purpose: 'Application render root.',
      replaceRisk: 'critical',
      registration: [{ name: 'order', type: 'number', required: false }],
      children: [{
        name: 'shell.overlay',
        kind: 'list',
        scope: 'root',
        purpose: 'Additive shell overlays.',
        replaceRisk: 'low',
        keyDomain: 'fixed by the dynamic Client Guard',
        allowedKeys: [{ value: 'self', description: 'Package self key.' }],
        children: [],
      }],
    }],
    referencedTypes: [],
  }
}

function createSlotsEnrichment(
  result: unknown,
  limits?: {
    readonly maxContracts?: number
    readonly maxFactsTotal?: number
  },
): {
  readonly enrichment: ContractEnrichmentPort
  readonly query: ReturnType<typeof vi.fn>
  readonly agent: unknown
  readonly signal: AbortSignal
} {
  const agent = Object.freeze({ id: 'client-slots-agent' })
  const controller = new AbortController()
  const query = vi.fn(async (
    platform: 'host' | 'client',
    providerId: string,
    methodName: string,
    input: unknown,
    actualAgent: unknown,
    signal: AbortSignal,
  ) => {
    expect(platform).toBe('client')
    expect(providerId).toBe('Slots')
    expect(methodName).toBe('listSubTree')
    expect(input).toEqual({})
    expect(actualAgent).toBe(agent)
    expect(signal).toBe(controller.signal)
    return result
  })
  const registry: DshCordisInspectRegistryPort = {
    list: () => [slotsProvider()],
    query,
  }
  const enrichment = createDshLiveContractEnrichment({
    registry,
    execution: Object.freeze({ agent, signal: controller.signal }),
    digest,
    ...(limits === undefined ? {} : { limits }),
  })
  if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
  return { enrichment, query, agent, signal: controller.signal }
}

async function indexFingerprint(enrichment: ContractEnrichmentPort): Promise<string> {
  const acquired = await enrichment.enrich(snapshot)
  const index = await createContractIndex(
    targetFingerprint,
    acquired.evidence,
    acquired.contracts,
    digest,
  )
  return index.fingerprint
}

describe('DSH live Client Slot normalization', () => {
  it('queries only the compact Client Slot tree and normalizes live topology contracts', async () => {
    const { enrichment, query } = createSlotsEnrichment(slotResult())
    const acquired = await enrichment.enrich(snapshot)

    expect(query).toHaveBeenCalledTimes(1)
    expect(acquired.evidence).toEqual([
      expect.objectContaining({
        id: 'runtime:cordis-inspect:client:Slots:listSubTree',
        kind: 'runtime',
        strength: 'observed',
        source: 'cordis-inspect:client/Slots/listSubTree',
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ])
    expect(acquired.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'client-slot:client:root',
        kind: 'client-slot',
        name: 'root',
        qualifiedName: 'slot:root',
        availability: 'available',
        summary: 'Application render root.',
        facts: expect.arrayContaining([
          expect.objectContaining({ key: 'slot-kind', value: 'single' }),
          expect.objectContaining({ key: 'slot-scope', value: 'root' }),
          expect.objectContaining({ key: 'replace-risk', value: 'critical' }),
          expect.objectContaining({
            key: 'registration-option',
            value: '{"name":"order","required":false,"type":"number"}',
          }),
        ]),
      }),
      expect.objectContaining({
        id: 'client-slot:client:shell.overlay',
        kind: 'client-slot',
        name: 'shell.overlay',
        qualifiedName: 'slot:shell.overlay',
        availability: 'available',
        summary: 'Additive shell overlays.',
        facts: expect.arrayContaining([
          expect.objectContaining({ key: 'slot-kind', value: 'list' }),
          expect.objectContaining({ key: 'slot-scope', value: 'root' }),
          expect.objectContaining({ key: 'parent-slot', value: 'root' }),
          expect.objectContaining({ key: 'replace-risk', value: 'low' }),
          expect.objectContaining({ key: 'key-domain', value: 'fixed by the dynamic Client Guard' }),
          expect.objectContaining({
            key: 'allowed-key',
            value: '{"description":"Package self key.","value":"self"}',
          }),
        ]),
      }),
    ]))
    expect(acquired.contracts).toHaveLength(2)
  })

  it('applies the shared normalized contract budget to every flattened Slot node', async () => {
    const { enrichment } = createSlotsEnrichment(slotResult(), { maxContracts: 1 })

    await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
      code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
    })
  })

  it('keeps Client Slot fingerprint identity stable across tree ordering only', async () => {
    const alpha = {
      name: 'alpha',
      kind: 'list',
      scope: 'root',
      children: [
        { name: 'alpha.z', kind: 'single', scope: 'root', children: [] },
        { name: 'alpha.a', kind: 'single', scope: 'root', children: [] },
      ],
    }
    const beta = { name: 'beta', kind: 'single', scope: 'root', children: [] }
    const left = createSlotsEnrichment({ trees: [alpha, beta], referencedTypes: [] }).enrichment
    const right = createSlotsEnrichment({
      trees: [beta, { ...alpha, children: alpha.children.toReversed() }],
      referencedTypes: [],
    }).enrichment

    await expect(indexFingerprint(left)).resolves.toBe(await indexFingerprint(right))
  })

  it('treats an absent Client Slots provider as no live evidence rather than unavailability', async () => {
    const agent = Object.freeze({ id: 'no-client-page' })
    const controller = new AbortController()
    const query = vi.fn(async () => {
      throw new Error('must not query an absent Client provider')
    })
    const registry: DshCordisInspectRegistryPort = {
      list: () => [],
      query,
    }
    const enrichment = createDshLiveContractEnrichment({
      registry,
      execution: Object.freeze({ agent, signal: controller.signal }),
      digest,
    })
    if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')

    await expect(enrichment.enrich(snapshot)).resolves.toEqual({ evidence: [], contracts: [] })
    expect(query).not.toHaveBeenCalled()
  })
})
