import { describe, expect, it } from 'vitest'
import { createContractSearchIndex, type ContractSearchIndex } from '../../src/model/contract-search-index.js'
import { createContractIndex, explainContractSearch, searchContractIndex } from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const digest: Sha256Port = {
  async sha256Utf8() {
    return 'd'.repeat(64)
  },
}

const evidence: Evidence[] = [
  {
    id: 'types:broker:a.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-broker/a.d.ts',
    contentHash: '1'.repeat(64),
  },
  {
    id: 'types:broker:z.d.ts',
    kind: 'type-declaration',
    strength: 'authoritative',
    source: '@deepseek-ai/dsh-broker/z.d.ts',
    contentHash: '2'.repeat(64),
  },
]

const contracts: ContractDefinition[] = [{
  id: 'service:remote-session-broker',
  kind: 'service',
  name: 'RemoteSessionBroker',
  qualifiedName: '@deepseek-ai/dsh-broker.RemoteSessionBroker',
  availability: 'available',
  summary: 'Coordinates broker operations.',
  facts: [
    {
      key: 'capability-profile',
      value: 'bounded transport relay',
      evidenceIds: ['types:broker:a.d.ts'],
    },
  ],
  evidenceIds: ['types:broker:a.d.ts'],
}]

async function fixture() {
  const index = await createContractIndex(
    `dsh-target-v2:${'e'.repeat(64)}`,
    evidence,
    contracts,
    digest,
  )
  return { index, derived: createContractSearchIndex(index) }
}

describe('Contract search fact-match fast path', () => {
  it('keeps singleton fact evidence isolated from returned search results', async () => {
    const { index, derived } = await fixture()
    const query = 'please bounded transport relay'

    const explanation = explainContractSearch(index, query, undefined, 5, derived)
    expect(explanation.lane).toBe('intent')

    const first = searchContractIndex(index, query, undefined, 5, derived)
    expect(first.matches[0]?.evidenceIds).toEqual(['types:broker:a.d.ts'])

    const returnedEvidenceIds = first.matches[0]?.evidenceIds as string[] | undefined
    expect(returnedEvidenceIds).toBeDefined()
    returnedEvidenceIds?.push('caller:mutation')

    const second = searchContractIndex(index, query, undefined, 5, derived)
    expect(second.matches[0]?.evidenceIds).toEqual(['types:broker:a.d.ts'])
  })

  it('preserves deterministic evidence normalization for a manually supplied multi-id derived fact', async () => {
    const { index, derived } = await fixture()
    const original = derived.documents.get('service:remote-session-broker')
    expect(original).toBeDefined()
    const originalFact = original?.facts[0]
    expect(originalFact).toBeDefined()
    if (original === undefined || originalFact === undefined) return

    const mutatedDocument = Object.freeze({
      ...original,
      facts: Object.freeze([
        Object.freeze({
          ...originalFact,
          evidenceIds: Object.freeze([
            'types:broker:z.d.ts',
            'types:broker:a.d.ts',
            'types:broker:z.d.ts',
          ]),
        }),
      ]),
    })
    const documents = new Map(derived.documents)
    documents.set(original.contractId, mutatedDocument)
    const manuallySuppliedDerived: ContractSearchIndex = Object.freeze({
      ...derived,
      documents,
    })

    const result = searchContractIndex(
      index,
      'please bounded transport relay',
      undefined,
      5,
      manuallySuppliedDerived,
    )

    expect(result.matches[0]?.evidenceIds).toEqual([
      'types:broker:a.d.ts',
      'types:broker:z.d.ts',
    ])
    expect(result.evidence.map(item => item.id)).toEqual([
      'types:broker:a.d.ts',
      'types:broker:z.d.ts',
    ])
  })
})
