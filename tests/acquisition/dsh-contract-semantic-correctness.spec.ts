import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDshContractFilesystemAcquisition } from '../../src/acquisition/dsh-contract-filesystem.js'
import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { parseTypeScriptDeclarationSyntax } from '../../src/acquisition/typescript-declaration-syntax.js'
import type { Evidence, TargetSnapshot } from '../../src/protocol/index.js'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-semantic-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

interface InstalledPackageFixture {
  readonly name: string
  readonly version?: string
  readonly manifest?: Record<string, unknown>
  readonly files?: Readonly<Record<string, string>>
}

async function writeInstalledPackage(
  modulesRoot: string,
  fixture: InstalledPackageFixture,
): Promise<{ manifestLocation: string; manifestContent: string }> {
  const packageRoot = path.join(modulesRoot, ...fixture.name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  const manifestContent = `${JSON.stringify({
    name: fixture.name,
    version: fixture.version ?? '0.1.1-rc.2',
    ...fixture.manifest,
  }, null, 2)}\n`
  const manifestLocation = path.join(packageRoot, 'package.json')
  await writeFile(manifestLocation, manifestContent, 'utf8')
  for (const [relative, content] of Object.entries(fixture.files ?? {})) {
    const location = path.join(packageRoot, relative)
    await mkdir(path.dirname(location), { recursive: true })
    await writeFile(location, content, 'utf8')
  }
  return { manifestLocation, manifestContent }
}

function manifestEvidence(
  id: string,
  source: string,
  location: string,
  content: string,
): Evidence {
  return {
    id,
    kind: 'manifest',
    strength: 'authoritative',
    source,
    contentHash: sha256(content),
    location,
  }
}

function targetSnapshot(
  evidence: readonly Evidence[],
  options: {
    readonly bundles?: TargetSnapshot['profile']['bundles']
    readonly dependencies?: TargetSnapshot['profile']['dependencies']
  } = {},
): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-08-27T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: options.bundles ?? [],
      dependencies: options.dependencies ?? [],
      profilePatchHash: 'b'.repeat(64),
      homePatchHash: 'c'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [...evidence],
  }
}

describe('M2.1 semantic correctness regressions', () => {
  it('discovers DSH API authorities from explicit DSH roots without crawling third-party packages', async () => {
    const root = await temporaryRoot()
    const modulesRoot = path.join(root, 'runner', 'node_modules')

    const dsh = await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh',
    })
    const base = await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh-base',
      manifest: {
        dependencies: {
          '@deepseek-ai/dsh-tools': '0.1.1-rc.2',
          'third-party-runtime': '1.0.0',
        },
      },
    })
    const web = await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh-web-app',
    })
    await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh-tools',
      manifest: { types: './index.d.ts' },
      files: { 'index.d.ts': 'export interface ToolDefinition { readonly name: string }\n' },
    })
    await writeInstalledPackage(modulesRoot, {
      name: 'third-party-runtime',
      version: '1.0.0',
      manifest: { types: './index.d.ts' },
      files: { 'index.d.ts': 'export interface ThirdPartyContract {}\n' },
    })

    const target = targetSnapshot([
      manifestEvidence('manifest:dsh', '@deepseek-ai/dsh', dsh.manifestLocation, dsh.manifestContent),
      manifestEvidence(
        'manifest:bundle:0:@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-base',
        base.manifestLocation,
        base.manifestContent,
      ),
      manifestEvidence(
        'manifest:bundle:1:@deepseek-ai/dsh-web-app',
        '@deepseek-ai/dsh-web-app',
        web.manifestLocation,
        web.manifestContent,
      ),
    ], {
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: 'd'.repeat(64) },
        { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', patchHash: 'e'.repeat(64) },
      ],
      dependencies: [],
    })

    const result = await createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
    }).acquire(target)

    expect(result.contracts.map(contract => contract.id)).toContain('package:@deepseek-ai/dsh-tools')
    expect(result.contracts.map(contract => contract.id)).not.toContain('package:third-party-runtime')
    expect(
      result.contracts
        .find(contract => contract.id === 'package:@deepseek-ai/dsh-tools')
        ?.facts,
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'declaration-export', value: 'ToolDefinition' }),
    ]))

    await expect(createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
      budget: { maxContractPackages: 4 },
    }).acquire(target)).resolves.toBeDefined()
    await expect(createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
      budget: { maxContractPackages: 3 },
    }).acquire(target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('normalizes only the effective public export surface of package entrypoints', async () => {
    const root = await temporaryRoot()
    const modulesRoot = path.join(root, 'runner', 'node_modules')
    const dsh = await writeInstalledPackage(modulesRoot, { name: '@deepseek-ai/dsh' })
    const base = await writeInstalledPackage(modulesRoot, { name: '@deepseek-ai/dsh-base' })
    const tools = await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh-tools',
      manifest: { types: './index.d.ts' },
      files: {
        'index.d.ts': [
          '/// <reference path="./ambient.d.ts" />',
          "export { Public as Renamed } from './named.js'",
          "export * as namespaceApi from './namespace.js'",
          "export * from './star.js'",
          '',
        ].join('\n'),
        'named.d.ts': [
          'export interface Public {}',
          'export interface SiblingLeak {}',
          '',
        ].join('\n'),
        'namespace.d.ts': [
          'export interface NamespaceMemberLeak {}',
          'export default class NamespaceDefaultLeak {}',
          '',
        ].join('\n'),
        'star.d.ts': [
          'export interface StarPublic {}',
          'export default class StarDefaultLeak {}',
          '',
        ].join('\n'),
        'ambient.d.ts': 'export interface AmbientLeak {}\n',
      },
    })

    const target = targetSnapshot([
      manifestEvidence('manifest:dsh', '@deepseek-ai/dsh', dsh.manifestLocation, dsh.manifestContent),
      manifestEvidence(
        'manifest:bundle:0:@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-base',
        base.manifestLocation,
        base.manifestContent,
      ),
      manifestEvidence(
        'manifest:dependency:@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-tools',
        tools.manifestLocation,
        tools.manifestContent,
      ),
    ], {
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: 'd'.repeat(64) },
      ],
      dependencies: [{ name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' }],
    })

    const result = await createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
    }).acquire(target)
    const toolsContract = result.contracts.find(contract => contract.id === 'package:@deepseek-ai/dsh-tools')
    const exportedNames = toolsContract?.facts
      .filter(fact => fact.key === 'declaration-export')
      .map(fact => fact.value)
      .toSorted()

    expect(exportedNames).toEqual(['Renamed', 'StarPublic', 'namespaceApi'])

    await expect(createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
      budget: { maxNormalizedFactsPerPackage: 5 },
    }).acquire(target)).resolves.toBeDefined()
    await expect(createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
      budget: { maxNormalizedFactsPerPackage: 4 },
    }).acquire(target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('uses concrete exports types entrypoints without treating wildcard templates as files', async () => {
    const root = await temporaryRoot()
    const modulesRoot = path.join(root, 'runner', 'node_modules')
    const dsh = await writeInstalledPackage(modulesRoot, { name: '@deepseek-ai/dsh' })
    const apiProxy = await writeInstalledPackage(modulesRoot, {
      name: '@deepseek-ai/dsh-host-apiproxy',
      manifest: {
        exports: {
          '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
          './api': { types: './lib/types/api/index.d.ts', default: './lib/types/api/index.js' },
          './api/*': { types: './lib/types/api/*.d.ts', default: './lib/types/api/*.js' },
          './client': { types: './lib/types/fetch/client.d.ts', default: './lib/types/fetch/client.js' },
        },
      },
      files: {
        'lib/types/index.d.ts': 'export interface ApiProxyRoot {}\n',
        'lib/types/api/index.d.ts': 'export interface ApiProxyApi {}\n',
        'lib/types/fetch/client.d.ts': 'export interface ApiProxyClient {}\n',
      },
    })

    const target = targetSnapshot([
      manifestEvidence('manifest:dsh', '@deepseek-ai/dsh', dsh.manifestLocation, dsh.manifestContent),
      manifestEvidence(
        'manifest:dependency:@deepseek-ai/dsh-host-apiproxy',
        '@deepseek-ai/dsh-host-apiproxy',
        apiProxy.manifestLocation,
        apiProxy.manifestContent,
      ),
    ], {
      dependencies: [{ name: '@deepseek-ai/dsh-host-apiproxy', version: '0.1.1-rc.2' }],
    })

    const result = await createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
    }).acquire(target)
    const contract = result.contracts.find(item => item.id === 'package:@deepseek-ai/dsh-host-apiproxy')

    expect(contract?.facts.filter(fact => fact.key === 'declaration-entry').map(fact => fact.value)).toEqual([
      'lib/types/api/index.d.ts',
      'lib/types/fetch/client.d.ts',
      'lib/types/index.d.ts',
    ])
    expect(contract?.facts.filter(fact => fact.key === 'declaration-export').map(fact => fact.value).toSorted()).toEqual([
      'ApiProxyApi',
      'ApiProxyClient',
      'ApiProxyRoot',
    ])
    expect(result.evidence.map(item => item.source)).not.toContain('@deepseek-ai/dsh-host-apiproxy/lib/types/api/*.d.ts')
  })

  it('rejects parser-recovery ASTs for syntactically malformed declarations', () => {
    expect(() => parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      'export interface ToolDefinition {\n',
    )).toThrow()
  })
})
