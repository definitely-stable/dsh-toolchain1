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
const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`

function toolProvider(): unknown {
  return {
    platform: 'host',
    id: 'Tool',
    methods: [{ name: 'listTools' }],
  }
}

function eventProvider(): unknown {
  return {
    platform: 'host',
    id: 'Event',
    methods: [{ name: 'listEvents' }],
  }
}

function serviceProvider(): unknown {
  return {
    platform: 'host',
    id: 'Service',
    methods: [{ name: 'listService' }],
  }
}

function toolResult(
  name: string,
  parameters: Record<string, unknown> = { type: 'object', properties: {} },
): unknown {
  return {
    tools: [{
      name,
      description: `${name} tool`,
      parameters,
    }],
  }
}

function createToolEnrichment(
  agent: unknown,
  signal: AbortSignal,
  result: unknown,
): ContractEnrichmentPort {
  const registry: DshCordisInspectRegistryPort = {
    list: () => [toolProvider()],
    query: async () => result,
  }
  const enrichment = createDshLiveContractEnrichment({
    registry,
    execution: Object.freeze({ agent, signal }),
    digest,
  })
  if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
  return enrichment
}

async function fingerprint(enrichment: ContractEnrichmentPort): Promise<string> {
  const acquired = await enrichment.enrich(snapshot)
  const index = await createContractIndex(
    targetFingerprint,
    acquired.evidence,
    acquired.contracts,
    digest,
  )
  return index.fingerprint
}

describe('DSH live Inspect fingerprint invariants', () => {
  it('does not include Agent object identity when observable contracts are identical', async () => {
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const surface = toolResult('same_tool', {
      type: 'object',
      properties: { path: { type: 'string' } },
    })

    const left = createToolEnrichment(Object.freeze({ id: 'agent-a' }), controllerA.signal, surface)
    const right = createToolEnrichment(Object.freeze({ id: 'agent-b' }), controllerB.signal, surface)

    await expect(fingerprint(left)).resolves.toBe(await fingerprint(right))
  })

  it('changes only the Contract Index identity when Agent-visible Tool semantics differ', async () => {
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const left = createToolEnrichment(
      Object.freeze({ id: 'agent-a' }),
      controllerA.signal,
      toolResult('tool_a'),
    )
    const right = createToolEnrichment(
      Object.freeze({ id: 'agent-b' }),
      controllerB.signal,
      toolResult('tool_b'),
    )

    const leftFingerprint = await fingerprint(left)
    const rightFingerprint = await fingerprint(right)
    expect(leftFingerprint).toMatch(/^dsh-contract-index-v1:[0-9a-f]{64}$/)
    expect(rightFingerprint).toMatch(/^dsh-contract-index-v1:[0-9a-f]{64}$/)
    expect(leftFingerprint).not.toBe(rightFingerprint)
    expect(targetFingerprint).toBe(`dsh-target-v2:${'a'.repeat(64)}`)
  })

  it('canonicalizes Tool parameter object key order before evidence hashing and fact storage', async () => {
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const left = createToolEnrichment(
      Object.freeze({ id: 'agent-a' }),
      controllerA.signal,
      toolResult('ordered', {
        type: 'object',
        properties: {
          zeta: { type: 'number', minimum: 0 },
          alpha: { minLength: 1, type: 'string' },
        },
      }),
    )
    const right = createToolEnrichment(
      Object.freeze({ id: 'agent-b' }),
      controllerB.signal,
      toolResult('ordered', {
        properties: {
          alpha: { type: 'string', minLength: 1 },
          zeta: { minimum: 0, type: 'number' },
        },
        type: 'object',
      }),
    )

    await expect(fingerprint(left)).resolves.toBe(await fingerprint(right))
  })

  it('is independent of Inspect provider directory order for the same observed Host surface', async () => {
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const providerResult = (providerId: string): unknown => {
      if (providerId === 'Service') {
        return {
          mode: 'catalog',
          services: [{ key: 'alpha', methods: [{ signature: 'ping(): string' }] }],
        }
      }
      if (providerId === 'Event') {
        return {
          mode: 'catalog',
          events: [{ name: 'alpha/change', mode: 'emit', signature: '(): void' }],
        }
      }
      if (providerId === 'Tool') return toolResult('alpha_tool')
      throw new Error(`unexpected provider ${providerId}`)
    }
    const make = (
      agent: unknown,
      signal: AbortSignal,
      providers: readonly unknown[],
    ): ContractEnrichmentPort => {
      const registry: DshCordisInspectRegistryPort = {
        list: () => providers,
        query: async (_platform, providerId) => providerResult(providerId),
      }
      const enrichment = createDshLiveContractEnrichment({
        registry,
        execution: Object.freeze({ agent, signal }),
        digest,
      })
      if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
      return enrichment
    }

    const left = make(
      Object.freeze({ id: 'agent-a' }),
      controllerA.signal,
      [serviceProvider(), eventProvider(), toolProvider()],
    )
    const right = make(
      Object.freeze({ id: 'agent-b' }),
      controllerB.signal,
      [toolProvider(), serviceProvider(), eventProvider()],
    )

    await expect(fingerprint(left)).resolves.toBe(await fingerprint(right))
  })
})

describe('DSH live Inspect invocation isolation', () => {
  it('keeps overlapping Agent and AbortSignal capabilities isolated without ambient state', async () => {
    const agentA = Object.freeze({ id: 'agent-a' })
    const agentB = Object.freeze({ id: 'agent-b' })
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const calls: Array<{ readonly agent: unknown; readonly signal: AbortSignal }> = []
    let release!: () => void
    const bothStarted = new Promise<void>(resolve => { release = resolve })

    const registry: DshCordisInspectRegistryPort = {
      list: () => [toolProvider()],
      async query(_platform, _providerId, _methodName, _input, agent, signal) {
        calls.push({ agent, signal })
        if (calls.length === 2) release()
        await bothStarted
        const id = (agent as { readonly id: string }).id
        return toolResult(`${id}_tool`)
      },
    }
    const make = (agent: unknown, signal: AbortSignal): ContractEnrichmentPort => {
      const enrichment = createDshLiveContractEnrichment({
        registry,
        execution: Object.freeze({ agent, signal }),
        digest,
      })
      if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')
      return enrichment
    }

    const [left, right] = await Promise.all([
      make(agentA, controllerA.signal).enrich(snapshot),
      make(agentB, controllerB.signal).enrich(snapshot),
    ])

    expect(calls).toEqual(expect.arrayContaining([
      { agent: agentA, signal: controllerA.signal },
      { agent: agentB, signal: controllerB.signal },
    ]))
    expect(left.contracts.map(contract => contract.id)).toEqual(['tool:host:agent-a_tool'])
    expect(right.contracts.map(contract => contract.id)).toEqual(['tool:host:agent-b_tool'])
  })

  it('forwards the exact caller signal and waits for an aborting provider promise to settle', async () => {
    const agent = Object.freeze({ id: 'cancel-agent' })
    const controller = new AbortController()
    let providerSettled = false
    const query = vi.fn(async (
      _platform: 'host' | 'client',
      _providerId: string,
      _methodName: string,
      _input: unknown,
      actualAgent: unknown,
      signal: AbortSignal,
    ) => {
      expect(actualAgent).toBe(agent)
      expect(signal).toBe(controller.signal)
      return await new Promise<unknown>((_resolve, reject) => {
        const abort = () => {
          providerSettled = true
          reject(new Error('provider observed abort'))
        }
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener('abort', abort, { once: true })
      })
    })
    const registry: DshCordisInspectRegistryPort = {
      list: () => [toolProvider()],
      query,
    }
    const enrichment = createDshLiveContractEnrichment({
      registry,
      execution: Object.freeze({ agent, signal: controller.signal }),
      digest,
    })
    if (enrichment === undefined) throw new Error('live enrichment unexpectedly unavailable')

    const pending = enrichment.enrich(snapshot)
    await Promise.resolve()
    expect(query).toHaveBeenCalledTimes(1)
    controller.abort()

    await expect(pending).rejects.toThrow('provider observed abort')
    expect(providerSettled).toBe(true)
  })
})
