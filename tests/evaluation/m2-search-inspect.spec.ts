import { describe, expect, it } from 'vitest'

import { inspectContractResponse } from '../../src/kernel/index.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

const TOOLS_CONTRACT = 'package:@deepseek-ai/dsh-tools'
const TOOLS_TYPES_EVIDENCE = 'types:@deepseek-ai/dsh-tools:lib/types/index.d.ts'

describe('M2.3 real-kernel search -> inspect conformance', () => {
  it('preserves exact target/index identity and resolves returned contract evidence through production kernel', async () => {
    const harness = await createFrozenM2KernelHarness()

    const search = await harness.kernel.searchContracts({
      target: { profile: 'web' },
      query: 'ToolRuntimeScheduler',
      limit: 5,
    })

    expect(search.snapshotFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(search.data.contractIndexFingerprint).toBe(M2_RETRIEVAL_TARGET.contractIndexFingerprint)
    expect(search.data.matches.map(match => match.id)).toContain(TOOLS_CONTRACT)

    const inspected = await harness.kernel.inspectContract({
      target: { profile: 'web' },
      contractIndexFingerprint: search.data.contractIndexFingerprint,
      contractId: TOOLS_CONTRACT,
    })

    expect(inspected.snapshotFingerprint).toBe(search.snapshotFingerprint)
    expect(inspected.data.contractIndexFingerprint).toBe(search.data.contractIndexFingerprint)
    expect(inspected.data.contract.id).toBe(TOOLS_CONTRACT)
    expect(inspected.data.contract.evidenceIds).toContain(TOOLS_TYPES_EVIDENCE)

    const returnedEvidenceIds = new Set(inspected.data.evidence.map(item => item.id))
    for (const evidenceId of inspected.data.contract.evidenceIds) {
      expect(returnedEvidenceIds.has(evidenceId), `inspect omitted evidence ${evidenceId}`).toBe(true)
    }
  })

  it('returns existing stale semantics when contract evidence changes after search', async () => {
    const harness = await createFrozenM2KernelHarness()
    const search = await harness.kernel.searchContracts({
      target: { profile: 'web' },
      query: 'ToolRuntimeScheduler',
      limit: 5,
    })

    harness.replaceEvidenceContentHash(TOOLS_TYPES_EVIDENCE, '0'.repeat(64))

    const response = await inspectContractResponse(
      harness.kernel,
      {
        target: { profile: 'web' },
        contractIndexFingerprint: search.data.contractIndexFingerprint,
        contractId: TOOLS_CONTRACT,
      },
      'm2-search-inspect-stale',
    )

    expect(response).toMatchObject({
      status: 'stale',
      snapshotFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      diagnostics: [{ code: 'CONTRACT_INDEX_STALE', domain: 'contract' }],
    })
  })
})
