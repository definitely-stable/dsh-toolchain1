import { describe, expect, it } from 'vitest'

import {
  CONTRACT_INSPECT_TOOL_NAME,
  CONTRACT_SEARCH_TOOL_NAME,
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

const TOOLS_CONTRACT = 'package:@deepseek-ai/dsh-tools'

describe('M2.3 production-faithful Toolchain broker', () => {
  it('exposes exactly the production model-facing search and inspect definitions', async () => {
    const broker = await createFrozenToolchainBroker('a'.repeat(64))
    const expectedSearch = createContractSearchToolDefinition(async () => { throw new Error('not executed') })
    const expectedInspect = createContractInspectToolDefinition(async () => { throw new Error('not executed') })

    expect(broker.searchTool.name).toBe(CONTRACT_SEARCH_TOOL_NAME)
    expect(broker.searchTool.description).toBe(expectedSearch.description)
    expect(broker.searchTool.parameters).toEqual(expectedSearch.parameters)
    expect(broker.inspectTool.name).toBe(CONTRACT_INSPECT_TOOL_NAME)
    expect(broker.inspectTool.description).toBe(expectedInspect.description)
    expect(broker.inspectTool.parameters).toEqual(expectedInspect.parameters)
  })

  it('executes production search then inspect and preserves target/index continuity', async () => {
    const broker = await createFrozenToolchainBroker('b'.repeat(64))

    const search = await broker.searchTool.execute({
      target: { profile: 'web' },
      query: 'ToolRuntimeScheduler',
      limit: 5,
    }) as {
      status: string
      snapshotFingerprint?: string
      data?: { contractIndexFingerprint: string; matches: Array<{ id: string }> }
    }

    expect(search.status).toBe('ok')
    expect(search.snapshotFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(search.data?.contractIndexFingerprint).toBe(M2_RETRIEVAL_TARGET.contractIndexFingerprint)
    expect(search.data?.matches.map(match => match.id)).toContain(TOOLS_CONTRACT)

    const inspect = await broker.inspectTool.execute({
      target: { profile: 'web' },
      contractIndexFingerprint: search.data!.contractIndexFingerprint,
      contractId: TOOLS_CONTRACT,
    }) as {
      status: string
      snapshotFingerprint?: string
      data?: { contractIndexFingerprint: string; contract: { id: string } }
    }

    expect(inspect.status).toBe('ok')
    expect(inspect.snapshotFingerprint).toBe(search.snapshotFingerprint)
    expect(inspect.data?.contractIndexFingerprint).toBe(search.data?.contractIndexFingerprint)
    expect(inspect.data?.contract.id).toBe(TOOLS_CONTRACT)
  })

  it('records request/response evidence in the runner-owned broker trace', async () => {
    const control = 'c'.repeat(64)
    const broker = await createFrozenToolchainBroker(control)

    await broker.searchTool.execute({
      target: { profile: 'web' },
      query: 'ToolRuntimeScheduler',
      limit: 5,
    })

    const trace = await broker.traceReceipt()
    expect(trace.runControlSha256).toBe(control)
    expect(trace.entries).toHaveLength(1)
    expect(trace.entries[0]).toMatchObject({
      sequence: 1,
      family: 'toolchain',
      name: CONTRACT_SEARCH_TOOL_NAME,
      status: 'ok',
      targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
      contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
    })
    expect(trace.entries[0]!.request.inline).toContain('ToolRuntimeScheduler')
    expect(trace.entries[0]!.response.inline).toContain(M2_RETRIEVAL_TARGET.contractIndexFingerprint)
  })
})
