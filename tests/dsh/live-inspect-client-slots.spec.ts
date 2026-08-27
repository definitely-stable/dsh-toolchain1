import { describe, expect, it, vi } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createDshLiveContractEnrichment,
  type DshCordisInspectRegistryPort,
} from '../../src/integrations/dsh/live-inspect.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const snapshot = Object.freeze({}) as TargetSnapshot

function slotsProvider(): unknown {
  return {
    platform: 'client',
    id: 'Slots',
    methods: [{ name: 'listSubTree' }],
  }
}

describe('DSH M2.2 Client provider scope', () => {
  it('does not query or index mirrored Client Slots until deterministic page identity is specified', async () => {
    const agent = Object.freeze({ id: 'client-page-race-agent' })
    const controller = new AbortController()
    const query = vi.fn(async () => {
      throw new Error('M2.2 must not create a pending Client Slots query')
    })
    const registry: DshCordisInspectRegistryPort = {
      list: () => [slotsProvider()],
      query,
    }
    const enrichment = createDshLiveContractEnrichment({
      registry,
      execution: Object.freeze({ agent, signal: controller.signal }),
      digest: createNodeSha256Port(),
    })
    if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')

    await expect(enrichment.enrich(snapshot)).resolves.toEqual({
      evidence: [],
      contracts: [],
    })
    expect(query).not.toHaveBeenCalled()
  })
})
