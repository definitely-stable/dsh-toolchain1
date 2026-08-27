import { describe, expect, it, vi } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createDshLiveContractEnrichment,
  type DshCordisInspectRegistryPort,
  type DshLiveContractLimits,
} from '../../src/integrations/dsh/live-inspect.js'
import type { TargetSnapshot } from '../../src/protocol/index.js'

const snapshot = Object.freeze({}) as TargetSnapshot

function createEnrichment(
  providers: readonly unknown[],
  query: DshCordisInspectRegistryPort['query'],
  limits?: Partial<DshLiveContractLimits>,
) {
  const controller = new AbortController()
  const registry: DshCordisInspectRegistryPort = {
    list: () => providers,
    query,
  }
  const enrichment = createDshLiveContractEnrichment({
    registry,
    execution: Object.freeze({
      agent: Object.freeze({ id: 'provider-directory-agent' }),
      signal: controller.signal,
    }),
    digest: createNodeSha256Port(),
    ...(limits === undefined ? {} : { limits }),
  })
  if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
  return enrichment
}

describe('DSH live Inspect provider directory hardening', () => {
  it('does not traverse method manifests for unsupported providers', async () => {
    const unsupported = {
      platform: 'host',
      id: 'UnrelatedPluginProvider',
      get methods(): never {
        throw new Error('unsupported provider methods must remain unobserved')
      },
    }
    const query = vi.fn<DshCordisInspectRegistryPort['query']>(async () => {
      throw new Error('unsupported provider must not be queried')
    })
    const enrichment = createEnrichment([unsupported], query)

    await expect(enrichment.enrich(snapshot)).resolves.toEqual({
      evidence: [],
      contracts: [],
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('fails before query when a supported provider advertises too many methods', async () => {
    const query = vi.fn<DshCordisInspectRegistryPort['query']>(async () => ({ tools: [] }))
    const limits: Partial<DshLiveContractLimits> & { readonly maxMethodsPerRelevantProvider: number } = {
      maxMethodsPerRelevantProvider: 1,
    }
    const enrichment = createEnrichment([{
      platform: 'host',
      id: 'Tool',
      methods: [
        { name: 'listTools' },
        { name: 'unexpectedSecondMethod' },
      ],
    }], query, limits)

    await expect(enrichment.enrich(snapshot)).rejects.toMatchObject({
      name: 'ContractAcquisitionError',
      code: 'CONTRACT_LIVE_EVIDENCE_LIMIT_EXCEEDED',
    })
    expect(query).not.toHaveBeenCalled()
  })
})
