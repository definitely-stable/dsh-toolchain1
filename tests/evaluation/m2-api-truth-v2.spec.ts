import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createOrdinaryWorkspace,
  type OrdinaryWorkspaceFileInput,
} from './m2-agent-ordinary-workspace.js'
import { createApiTruthUniverseV2 } from './m2-api-truth-v2.js'

const target = {
  package: '@deepseek-ai/dsh' as const,
  version: '0.1.1-rc.2' as const,
  profile: 'web' as const,
  targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
  contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
}

const files: OrdinaryWorkspaceFileInput[] = [
  {
    path: '/exact-target/node_modules/@example/api/package.json',
    mediaType: 'application/json',
    content: JSON.stringify({ name: '@example/api', version: '1.0.0', types: './index.d.ts' }),
  },
  {
    path: '/exact-target/node_modules/@example/api/index.d.ts',
    mediaType: 'text/typescript',
    content: `
export declare class Service {
  run(): void
  public visible(): void
  protected inherited(): void
  private secret(): void
  static version(): string
}

declare class Internal {
  execute(): void
}
export { Internal as Public }

export interface Config {
  enabled: boolean
  readonly name?: string
}

export type Options = {
  flag?: boolean
  nested: string
}

export * from './extra.js'
`,
  },
  {
    path: '/exact-target/node_modules/@example/api/extra.d.ts',
    mediaType: 'text/typescript',
    content: 'export interface Extra { value: string }\n',
  },
  {
    path: '/exact-target/node_modules/@example/incomplete/package.json',
    mediaType: 'application/json',
    content: JSON.stringify({ name: '@example/incomplete', version: '1.0.0', types: './index.d.ts' }),
  },
  {
    path: '/exact-target/node_modules/@example/incomplete/index.d.ts',
    mediaType: 'text/typescript',
    content: "export * from './missing.js'\n",
  },
]

async function syntheticWorkspace(inputFiles = files) {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target,
    packages: [
      { name: '@example/api', version: '1.0.0' },
      { name: '@example/incomplete', version: '1.0.0' },
    ],
    files: inputFiles,
  }, createNodeSha256Port())
}

function symbolsFor(
  universe: Awaited<ReturnType<typeof createApiTruthUniverseV2>>,
  packageName: string,
): readonly string[] {
  return universe.entries
    .filter(entry => entry.package === packageName)
    .map(entry => entry.qualifiedSymbol)
    .toSorted()
}

describe('M2 API Truth v2', () => {
  it('derives reachable exports and public members without exposing non-public members', async () => {
    const universe = await createApiTruthUniverseV2(await syntheticWorkspace(), createNodeSha256Port())

    expect(symbolsFor(universe, '@example/api')).toEqual([
      'Config',
      'Config.enabled',
      'Config.name',
      'Extra',
      'Extra.value',
      'Options',
      'Options.flag',
      'Options.nested',
      'Public',
      'Public.execute',
      'Service',
      'Service.run',
      'Service.version',
      'Service.visible',
    ])
    expect(symbolsFor(universe, '@example/api')).not.toContain('Service.secret')
    expect(symbolsFor(universe, '@example/api')).not.toContain('Service.inherited')
    expect(universe.packages.find(item => item.name === '@example/api')).toMatchObject({
      complete: true,
      unresolvedPublicEdges: [],
    })
  })

  it('fails closed when a reachable public declaration edge cannot be resolved', async () => {
    const universe = await createApiTruthUniverseV2(await syntheticWorkspace(), createNodeSha256Port())
    const incomplete = universe.packages.find(item => item.name === '@example/incomplete')

    expect(incomplete?.complete).toBe(false)
    expect(incomplete?.unresolvedPublicEdges).toEqual([
      '/exact-target/node_modules/@example/incomplete/index.d.ts -> ./missing.js',
    ])
  })

  it('has order-independent semantic identity', async () => {
    const sha256 = createNodeSha256Port()
    const left = await createApiTruthUniverseV2(await syntheticWorkspace(files), sha256)
    const right = await createApiTruthUniverseV2(await syntheticWorkspace([...files].toReversed()), sha256)

    expect(left.fingerprint).toMatch(/^dsh-api-truth-v2:[0-9a-f]{64}$/u)
    expect(right.fingerprint).toBe(left.fingerprint)
    expect(right.entries).toEqual(left.entries)
    expect(right.packages).toEqual(left.packages)
  })
})
