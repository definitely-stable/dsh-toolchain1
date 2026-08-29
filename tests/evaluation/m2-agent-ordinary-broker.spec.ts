import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  validateCapabilityManifests,
  validateTraceReceipt,
} from './m2-agent-execution-evidence.js'
import {
  createFrozenOrdinaryBroker,
  createFrozenP0CapabilityManifests,
} from './m2-agent-ordinary-broker.js'
import { createOrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

const sha256 = createNodeSha256Port()

async function workspace() {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
      contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
    },
    packages: [
      { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
    ],
    files: [
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
        mediaType: 'application/json',
        content: '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
        mediaType: 'text/typescript',
        content: 'export declare function defineTool(): unknown\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        mediaType: 'text/plain',
        content: '# dsh-tools\ndefineTool docs\n',
      },
    ],
  }, sha256)
}

describe('M2.3 runner-owned ordinary evidence broker', () => {
  it('constructs exact A/B/C manifests with C equal to B plus only production Toolchain search/inspect', async () => {
    const frozen = await workspace()
    const toolchain = await createFrozenToolchainBroker('0'.repeat(64))
    const manifests = createFrozenP0CapabilityManifests(frozen, {
      searchTool: toolchain.searchTool,
      inspectTool: toolchain.inspectTool,
    })

    expect(() => validateCapabilityManifests(manifests)).not.toThrow()
    expect(manifests.A).toEqual({
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'A',
      ordinaryEvidence: null,
      tools: [],
    })
    expect(manifests.B.ordinaryEvidence).toEqual({
      workspaceSnapshotSha256: frozen.workspaceSnapshotSha256,
      roots: ['/exact-target'],
      readOnly: true,
      staticDocsSha256: frozen.documentationSha256,
      networkPolicy: 'provider-only',
      search: {
        backend: 'virtual-literal-search',
        version: '1',
        maxResults: 50,
      },
    })
    expect(manifests.C.ordinaryEvidence).toEqual(manifests.B.ordinaryEvidence)
    expect(manifests.B.tools.map(tool => [tool.family, tool.name])).toEqual([
      ['ordinary', 'read_file'],
      ['ordinary', 'search_text'],
    ])
    expect(manifests.C.tools.map(tool => [tool.family, tool.name])).toEqual([
      ['ordinary', 'read_file'],
      ['ordinary', 'search_text'],
      ['toolchain', 'toolchain_contract_search'],
      ['toolchain', 'toolchain_contract_inspect'],
    ])
    expect(manifests.C.tools.slice(0, 2)).toEqual(manifests.B.tools)
  })

  it('dispatches only frozen ordinary tools and records authoritative runner trace evidence', async () => {
    const frozen = await workspace()
    const runControlSha256 = '3'.repeat(64)
    const broker = await createFrozenOrdinaryBroker(runControlSha256, frozen)

    const read = await broker.dispatchToolCall({
      id: 'read-1',
      name: 'read_file',
      input: {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        startLine: 2,
        lineCount: 1,
      },
    })
    expect(read).toMatchObject({ content: 'defineTool docs' })

    const search = await broker.dispatchToolCall({
      id: 'search-1',
      name: 'search_text',
      input: { query: 'defineTool' },
    })
    expect(search).toMatchObject({ truncated: false })

    const trace = await broker.traceReceipt()
    expect(trace.runControlSha256).toBe(runControlSha256)
    expect(trace.entries.map(entry => [entry.sequence, entry.family, entry.name, entry.status])).toEqual([
      [1, 'ordinary', 'read_file', 'ok'],
      [2, 'ordinary', 'search_text', 'ok'],
    ])
    await expect(validateTraceReceipt(trace, 'B', sha256)).resolves.toBeUndefined()
  })

  it('does not dispatch undeclared tools or leak a Toolchain-only operation through the ordinary broker', async () => {
    const broker = await createFrozenOrdinaryBroker('4'.repeat(64), await workspace())

    await expect(broker.dispatchToolCall({
      id: 'bad-1',
      name: 'toolchain_contract_search',
      input: { query: 'defineTool' },
    })).rejects.toThrow(/ordinary|unexpected|unavailable/i)

    const trace = await broker.traceReceipt()
    expect(trace.entries).toEqual([])
  })
})
