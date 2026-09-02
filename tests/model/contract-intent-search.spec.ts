import { describe, expect, it } from 'vitest'

import {
  createContractIndex,
  searchContractIndex,
} from '../../src/model/contract.js'
import type { Sha256Port } from '../../src/model/digest.js'
import type { ContractDefinition, Evidence } from '../../src/protocol/index.js'

const digest: Sha256Port = {
  async sha256Utf8(value) {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0').repeat(8)
  },
}

const TARGET = `dsh-target-v2:${'c'.repeat(64)}`

const evidence: Evidence[] = [
  {
    id: 'types:approval',
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: '1'.repeat(64),
  },
  {
    id: 'types:subagent',
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: '2'.repeat(64),
  },
  {
    id: 'types:tools',
    kind: 'type-declaration',
    strength: 'authoritative',
    contentHash: '3'.repeat(64),
  },
]

const contracts: ContractDefinition[] = [
  {
    id: 'package:@deepseek-ai/dsh-user-approval',
    kind: 'package',
    name: '@deepseek-ai/dsh-user-approval',
    qualifiedName: 'package:@deepseek-ai/dsh-user-approval',
    availability: 'unknown',
    summary: 'Approval policy controls for agents.',
    facts: [
      { key: 'declaration-symbol', value: 'ApprovalService', evidenceIds: ['types:approval'] },
      { key: 'declaration-symbol', value: 'setPolicy', evidenceIds: ['types:approval'] },
    ],
    evidenceIds: ['types:approval'],
  },
  {
    id: 'package:@deepseek-ai/dsh-subagent',
    kind: 'package',
    name: '@deepseek-ai/dsh-subagent',
    qualifiedName: 'package:@deepseek-ai/dsh-subagent',
    availability: 'unknown',
    summary: 'Subagent depth controls.',
    facts: [
      { key: 'declaration-symbol', value: 'resolveChildDepth', evidenceIds: ['types:subagent'] },
      { key: 'declaration-symbol', value: 'SubagentDepthError', evidenceIds: ['types:subagent'] },
    ],
    evidenceIds: ['types:subagent'],
  },
  {
    id: 'package:@deepseek-ai/dsh-tools',
    kind: 'package',
    name: '@deepseek-ai/dsh-tools',
    qualifiedName: 'package:@deepseek-ai/dsh-tools',
    availability: 'unknown',
    summary: 'Tool definitions and schemas.',
    facts: [
      { key: 'declaration-symbol', value: 'ToolDefinition', evidenceIds: ['types:tools'] },
    ],
    evidenceIds: ['types:tools'],
  },
]

async function index() {
  return createContractIndex(TARGET, evidence, contracts, digest)
}

describe('Contract Intelligence intent retrieval', () => {
  it('retrieves a contract from a natural-language question without requiring every filler word to occur', async () => {
    const result = searchContractIndex(
      await index(),
      'How do I set the approval policy for an agent before continuing?',
      undefined,
      3,
    )

    expect(result.matches[0]?.id).toBe('package:@deepseek-ai/dsh-user-approval')
    expect(result.matches[0]?.evidenceIds).toContain('types:approval')
  })

  it('retrieves an indirect intent when multiple high-signal contract tokens agree', async () => {
    const result = searchContractIndex(
      await index(),
      'Which API enforces child agent nesting depth?',
      undefined,
      3,
    )

    expect(result.matches[0]?.id).toBe('package:@deepseek-ai/dsh-subagent')
  })

  it('preserves exact-symbol/package strength over weaker intent overlap', async () => {
    const current = await index()

    expect(searchContractIndex(current, '@deepseek-ai/dsh-tools').matches[0]?.id)
      .toBe('package:@deepseek-ai/dsh-tools')
    expect(searchContractIndex(current, 'ToolDefinition').matches[0]?.id)
      .toBe('package:@deepseek-ai/dsh-tools')
  })

  it('does not turn one incidental or unrelated token into a result', async () => {
    const current = await index()

    expect(searchContractIndex(current, 'banana orbital launcher').matches).toEqual([])
    expect(searchContractIndex(current, 'how can I continue this work safely').matches).toEqual([])
  })

  it('remains deterministic when semantically equivalent index inputs are reordered', async () => {
    const left = await createContractIndex(TARGET, evidence, contracts, digest)
    const right = await createContractIndex(TARGET, evidence.toReversed(), contracts.toReversed(), digest)
    const query = 'Which API enforces child agent nesting depth?'

    expect(searchContractIndex(right, query)).toEqual(searchContractIndex(left, query))
  })
})
