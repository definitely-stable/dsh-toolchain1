import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { buildApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import {
  createOrdinaryWorkspace,
  type OrdinaryWorkspaceFileInput,
} from './m2-agent-ordinary-workspace.js'

const sha256 = createNodeSha256Port()
const TARGET = {
  package: '@deepseek-ai/dsh' as const,
  version: '0.1.1-rc.2' as const,
  profile: 'web' as const,
  targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
  contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
}

async function workspace(files: readonly OrdinaryWorkspaceFileInput[]) {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target: TARGET,
    packages: [{ name: '@example/pkg', version: '1.0.0' }],
    files,
  }, sha256)
}

function manifest(types = './index.d.ts'): OrdinaryWorkspaceFileInput {
  return {
    path: '/exact-target/node_modules/@example/pkg/package.json',
    mediaType: 'application/json',
    content: `${JSON.stringify({ name: '@example/pkg', version: '1.0.0', types })}\n`,
  }
}

describe('M2.3 independent API Truth v2', () => {
  it('derives reachable public exports and members without private/protected leakage', async () => {
    const input = await workspace([
      manifest(),
      {
        path: '/exact-target/node_modules/@example/pkg/index.d.ts',
        mediaType: 'text/typescript',
        content: [
          'export declare function top(): void',
          'export declare class Service {',
          '  run(): void',
          '  static create(): Service',
          '  protected inherited(): void',
          '  private secret(): void',
          '}',
          'export interface Profile { patchReload?: boolean }',
          'export type Options = { timeout?: number }',
          '',
        ].join('\n'),
      },
    ])

    const truth = await buildApiTruthUniverseV2(input, sha256)
    const symbols = truth.entries.map(entry => entry.qualifiedSymbol)
    const pkg = truth.packages.find(item => item.name === '@example/pkg')

    expect(pkg?.complete).toBe(true)
    expect(symbols).toEqual(expect.arrayContaining([
      'top',
      'Service',
      'Service.run',
      'Service.create',
      'Profile',
      'Profile.patchReload',
      'Options',
      'Options.timeout',
    ]))
    expect(symbols).not.toContain('Service.inherited')
    expect(symbols).not.toContain('Service.secret')
  })

  it('follows reachable relative declaration re-exports', async () => {
    const input = await workspace([
      manifest(),
      {
        path: '/exact-target/node_modules/@example/pkg/index.d.ts',
        mediaType: 'text/typescript',
        content: "export * from './service.js'\n",
      },
      {
        path: '/exact-target/node_modules/@example/pkg/service.d.ts',
        mediaType: 'text/typescript',
        content: 'export declare class Service { run(): void }\n',
      },
    ])

    const truth = await buildApiTruthUniverseV2(input, sha256)
    const pkg = truth.packages.find(item => item.name === '@example/pkg')

    expect(pkg?.complete).toBe(true)
    expect(pkg?.visitedDeclarations).toEqual([
      '/exact-target/node_modules/@example/pkg/index.d.ts',
      '/exact-target/node_modules/@example/pkg/service.d.ts',
    ])
    expect(truth.entries.map(entry => entry.qualifiedSymbol)).toEqual(expect.arrayContaining([
      'Service',
      'Service.run',
    ]))
  })

  it('fails absence completeness closed when a public re-export cannot be resolved', async () => {
    const input = await workspace([
      manifest(),
      {
        path: '/exact-target/node_modules/@example/pkg/index.d.ts',
        mediaType: 'text/typescript',
        content: "export * from './missing.js'\n",
      },
    ])

    const truth = await buildApiTruthUniverseV2(input, sha256)
    const pkg = truth.packages.find(item => item.name === '@example/pkg')

    expect(pkg?.complete).toBe(false)
    expect(pkg?.unresolvedPublicEdges).toHaveLength(1)
    expect(pkg?.unresolvedPublicEdges[0]).toContain('./missing.js')
  })

  it('content-addresses truth independently from acquisition ordering', async () => {
    const files: OrdinaryWorkspaceFileInput[] = [
      manifest(),
      {
        path: '/exact-target/node_modules/@example/pkg/index.d.ts',
        mediaType: 'text/typescript',
        content: 'export declare class Service { run(): void }\n',
      },
    ]
    const firstWorkspace = await workspace(files)
    const reorderedWorkspace = await workspace(files.toReversed())
    const changedWorkspace = await workspace([
      manifest(),
      {
        path: '/exact-target/node_modules/@example/pkg/index.d.ts',
        mediaType: 'text/typescript',
        content: 'export declare class Service { execute(): void }\n',
      },
    ])

    const first = await buildApiTruthUniverseV2(firstWorkspace, sha256)
    const reordered = await buildApiTruthUniverseV2(reorderedWorkspace, sha256)
    const changed = await buildApiTruthUniverseV2(changedWorkspace, sha256)

    expect(first.fingerprint).toMatch(/^dsh-api-truth-v2:[0-9a-f]{64}$/u)
    expect(reordered.fingerprint).toBe(first.fingerprint)
    expect(changed.fingerprint).not.toBe(first.fingerprint)
  })
})
