import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createFrozenP0CapabilityManifests } from './m2-agent-ordinary-broker.js'
import {
  createOrdinaryReadToolDefinition,
  createOrdinarySearchToolDefinition,
} from './m2-agent-ordinary-tools.js'
import {
  validateOrdinaryWorkspace,
  type OrdinaryWorkspace,
} from './m2-agent-ordinary-workspace.js'
import { M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

interface OrdinaryFixtureManifest {
  readonly expected: {
    readonly targetFingerprint: string
    readonly contractIndexFingerprint: string
    readonly ordinaryWorkspaceSnapshotSha256: string
    readonly ordinaryDocumentationSha256: string
    readonly ordinaryFileCount: number
  }
  readonly packages: readonly { readonly name: string; readonly version: string }[]
}

const fixtureRoot = new URL('./fixtures/m2/rc2-web-v1/', import.meta.url)

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(new URL(name, fixtureRoot), 'utf8')) as T
}

describe('M2.3 frozen ordinary rc.2 workspace', () => {
  it('validates committed registry-derived bytes and preserves the B/C causal boundary', async () => {
    const [manifest, workspace] = await Promise.all([
      readJson<OrdinaryFixtureManifest>('manifest.json'),
      readJson<OrdinaryWorkspace>('ordinary-workspace.json'),
    ])

    await expect(validateOrdinaryWorkspace(workspace, createNodeSha256Port())).resolves.toBeUndefined()
    expect(workspace.target.targetFingerprint).toBe(M2_RETRIEVAL_TARGET.targetFingerprint)
    expect(workspace.target.contractIndexFingerprint).toBe(M2_RETRIEVAL_TARGET.contractIndexFingerprint)
    expect(workspace.workspaceSnapshotSha256).toBe(manifest.expected.ordinaryWorkspaceSnapshotSha256)
    expect(workspace.documentationSha256).toBe(manifest.expected.ordinaryDocumentationSha256)
    expect(workspace.files).toHaveLength(manifest.expected.ordinaryFileCount)
    expect(workspace.packages).toEqual(manifest.packages)

    expect(workspace.files.some(file => file.mediaType === 'text/typescript')).toBe(true)
    expect(workspace.packages.every(item => workspace.files.some(file =>
      file.path === `/exact-target/node_modules/${item.name}/package.json`,
    ))).toBe(true)
    expect(workspace.files.some(file => /(?:contract-facts|target-facts|ordinary-workspace|docs\/evaluation\/m2|api-oracle|agent-holdout|agent-pilot)/iu.test(file.path))).toBe(false)

    const readTool = createOrdinaryReadToolDefinition(workspace)
    const searchTool = createOrdinarySearchToolDefinition(workspace)
    const packageManifest = workspace.files.find(file => file.path === '/exact-target/node_modules/@deepseek-ai/dsh/package.json')
    expect(packageManifest).toBeDefined()
    if (packageManifest === undefined) throw new Error('frozen DSH package manifest is missing')
    await expect(readTool.execute({ path: packageManifest.path })).resolves.toMatchObject({ path: packageManifest.path })
    const searchResult = await searchTool.execute({ query: '@deepseek-ai/dsh', maxResults: 5 })
    expect(searchResult.matches.length).toBeGreaterThan(0)

    const manifests = createFrozenP0CapabilityManifests(workspace, {
      searchTool: {
        name: 'toolchain_contract_search',
        description: 'Production Toolchain contract search.',
        parameters: { type: 'object' },
      },
      inspectTool: {
        name: 'toolchain_contract_inspect',
        description: 'Production Toolchain contract inspect.',
        parameters: { type: 'object' },
      },
    })
    expect(manifests.A.ordinaryEvidence).toBeNull()
    expect(manifests.A.tools).toEqual([])
    expect(manifests.B.ordinaryEvidence).toEqual(manifests.C.ordinaryEvidence)
    expect(manifests.C.tools.slice(0, manifests.B.tools.length)).toEqual(manifests.B.tools)
    expect(manifests.C.tools.slice(manifests.B.tools.length).map(tool => tool.name)).toEqual([
      'toolchain_contract_search',
      'toolchain_contract_inspect',
    ])
  })
})
