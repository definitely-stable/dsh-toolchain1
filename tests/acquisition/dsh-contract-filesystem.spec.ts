import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDshContractFilesystemAcquisition } from '../../src/acquisition/dsh-contract-filesystem.js'
import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import type { Evidence, TargetSnapshot } from '../../src/protocol/index.js'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-contract-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

interface PackageFixture {
  readonly name: string
  readonly version: string
  readonly manifest: Record<string, unknown>
  readonly files?: Readonly<Record<string, string>>
}

interface TestContractAcquisitionBudget {
  readonly maxDeclarationFilesPerPackage: number
  readonly maxDeclarationBytesPerFile: number
  readonly maxDeclarationBytesPerPackage: number
  readonly maxDeclarationReferenceEdgesPerPackage: number
  readonly maxDeclarationDepth: number
}

function budget(overrides: Partial<TestContractAcquisitionBudget> = {}): TestContractAcquisitionBudget {
  return {
    maxDeclarationFilesPerPackage: 100,
    maxDeclarationBytesPerFile: 1_000_000,
    maxDeclarationBytesPerPackage: 10_000_000,
    maxDeclarationReferenceEdgesPerPackage: 100,
    maxDeclarationDepth: 20,
    ...overrides,
  }
}

function acquisitionWithBudget(value: TestContractAcquisitionBudget) {
  const options = {
    digest: createNodeSha256Port(),
    budget: value,
  }
  return createDshContractFilesystemAcquisition(options)
}

async function writePackage(root: string, fixture: PackageFixture): Promise<{ manifestLocation: string; manifestContent: string }> {
  const packageRoot = path.join(root, ...fixture.name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  const manifestContent = `${JSON.stringify({ name: fixture.name, version: fixture.version, ...fixture.manifest }, null, 2)}\n`
  const manifestLocation = path.join(packageRoot, 'package.json')
  await writeFile(manifestLocation, manifestContent, 'utf8')
  for (const [relative, content] of Object.entries(fixture.files ?? {})) {
    const location = path.join(packageRoot, relative)
    await mkdir(path.dirname(location), { recursive: true })
    await writeFile(location, content, 'utf8')
  }
  return { manifestLocation, manifestContent }
}

function manifestEvidence(id: string, source: string, location: string, content: string): Evidence {
  return {
    id,
    kind: 'manifest',
    strength: 'authoritative',
    source,
    contentHash: sha256(content),
    location,
  }
}

function snapshot(evidence: readonly Evidence[]): TargetSnapshot {
  return {
    fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
    createdAt: '2026-08-27T00:00:00.000Z',
    dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
    profile: {
      name: 'web',
      bundles: [
        { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', patchHash: 'b'.repeat(64) },
      ],
      dependencies: [
        { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
      ],
      profilePatchHash: 'c'.repeat(64),
      homePatchHash: 'd'.repeat(64),
      overlayPatchHashes: [],
    },
    evidence: [...evidence],
  }
}

async function createFixture(): Promise<{
  root: string
  target: TargetSnapshot
  toolsManifestLocation: string
}> {
  const root = await temporaryRoot()
  const dsh = await writePackage(root, {
    name: '@deepseek-ai/dsh',
    version: '0.1.1-rc.2',
    manifest: { types: './index.d.ts' },
    files: { 'index.d.ts': 'export interface DshApplication {}\n' },
  })
  const base = await writePackage(root, {
    name: '@deepseek-ai/dsh-base',
    version: '0.1.1-rc.2',
    manifest: {},
  })
  const tools = await writePackage(root, {
    name: '@deepseek-ai/dsh-tools',
    version: '0.1.1-rc.2',
    manifest: {
      exports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      },
    },
    files: {
      'dist/index.d.ts': "export { ToolDefinition } from './tool.js'\n",
      'dist/tool.d.ts': 'export interface ToolDefinition { readonly name: string }\n',
      'dist/index.js': "throw new Error('declaration acquisition must never execute package JS')\n",
    },
  })
  return {
    root,
    target: snapshot([
      manifestEvidence('manifest:dsh', '@deepseek-ai/dsh', dsh.manifestLocation, dsh.manifestContent),
      manifestEvidence('manifest:bundle:0:@deepseek-ai/dsh-base', '@deepseek-ai/dsh-base', base.manifestLocation, base.manifestContent),
      manifestEvidence('manifest:dependency:@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tools', tools.manifestLocation, tools.manifestContent),
    ]),
    toolsManifestLocation: tools.manifestLocation,
  }
}

describe('DSH Contract filesystem acquisition', () => {
  it('uses exact target manifest locations and follows public declaration references without executing JavaScript', async () => {
    const fixture = await createFixture()
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    const result = await acquisition.acquire(fixture.target)

    expect(result.contracts.map(contract => contract.id)).toEqual([
      'package:@deepseek-ai/dsh',
      'package:@deepseek-ai/dsh-base',
      'package:@deepseek-ai/dsh-tools',
    ])
    const tools = result.contracts.find(contract => contract.id === 'package:@deepseek-ai/dsh-tools')
    expect(tools?.availability).toBe('unknown')
    expect(tools?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'version', value: '0.1.1-rc.2' }),
      expect.objectContaining({ key: 'declaration-entry', value: 'dist/index.d.ts' }),
      expect.objectContaining({ key: 'declaration-symbol', value: 'ToolDefinition' }),
    ]))
    expect(result.evidence.filter(item => item.kind === 'type-declaration').map(item => item.source)).toEqual([
      '@deepseek-ai/dsh-tools/dist/index.d.ts',
      '@deepseek-ai/dsh-tools/dist/tool.d.ts',
      '@deepseek-ai/dsh/index.d.ts',
    ])
  })

  it('keeps original M1 bundle evidence coordinates after observer bundles are excluded from semantic target identity', async () => {
    const fixture = await createFixture()
    const web = await writePackage(fixture.root, {
      name: '@deepseek-ai/dsh-web-app',
      version: '0.1.1-rc.2',
      manifest: {},
    })
    const target: TargetSnapshot = {
      ...fixture.target,
      profile: {
        ...fixture.target.profile,
        bundles: [
          ...fixture.target.profile.bundles,
          { name: '@deepseek-ai/dsh-web-app', version: '0.1.1-rc.2', patchHash: 'e'.repeat(64) },
        ],
      },
      evidence: [
        ...fixture.target.evidence,
        manifestEvidence(
          'manifest:bundle:2:@deepseek-ai/dsh-web-app',
          '@deepseek-ai/dsh-web-app',
          web.manifestLocation,
          web.manifestContent,
        ),
      ],
    }
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    const result = await acquisition.acquire(target)

    expect(result.contracts.map(contract => contract.id)).toContain('package:@deepseek-ai/dsh-web-app')
    expect(result.evidence).toContainEqual(expect.objectContaining({
      id: 'manifest:bundle:2:@deepseek-ai/dsh-web-app',
      source: '@deepseek-ai/dsh-web-app',
    }))
  })

  it('collapses one package resolved as both bundle and dependency while preserving both manifest evidence aliases', async () => {
    const fixture = await createFixture()
    const toolsManifest = await readFile(fixture.toolsManifestLocation, 'utf8')
    const target: TargetSnapshot = {
      ...fixture.target,
      profile: {
        ...fixture.target.profile,
        bundles: [
          ...fixture.target.profile.bundles,
          { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2', patchHash: 'e'.repeat(64) },
        ],
      },
      evidence: [
        ...fixture.target.evidence,
        manifestEvidence(
          'manifest:bundle:1:@deepseek-ai/dsh-tools',
          '@deepseek-ai/dsh-tools',
          fixture.toolsManifestLocation,
          toolsManifest,
        ),
      ],
    }
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    const result = await acquisition.acquire(target)
    const matching = result.contracts.filter(contract => contract.id === 'package:@deepseek-ai/dsh-tools')

    expect(matching).toHaveLength(1)
    expect(matching[0]?.evidenceIds).toEqual(expect.arrayContaining([
      'manifest:bundle:1:@deepseek-ai/dsh-tools',
      'manifest:dependency:@deepseek-ai/dsh-tools',
    ]))
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manifest:bundle:1:@deepseek-ai/dsh-tools' }),
      expect.objectContaining({ id: 'manifest:dependency:@deepseek-ai/dsh-tools' }),
    ]))
  })

  it('reports stale when a target-captured manifest changes before contract acquisition', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.toolsManifestLocation, '{"name":"@deepseek-ai/dsh-tools","version":"0.1.1-rc.2"}\n', 'utf8')
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    await expect(acquisition.acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_EVIDENCE_STALE',
    })
  })

  it('captures same-version declaration drift as new evidence instead of pretending target identity changed', async () => {
    const fixture = await createFixture()
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })
    const first = await acquisition.acquire(fixture.target)
    const declaration = path.join(path.dirname(fixture.toolsManifestLocation), 'dist', 'tool.d.ts')

    await writeFile(declaration, 'export interface ToolDefinition { readonly name: string; readonly version: number }\n', 'utf8')
    const second = await acquisition.acquire(fixture.target)

    expect(fixture.target.fingerprint).toBe(`dsh-target-v2:${'a'.repeat(64)}`)
    expect(
      first.evidence.find(item => item.source?.endsWith('/dist/tool.d.ts'))?.contentHash,
    ).not.toBe(
      second.evidence.find(item => item.source?.endsWith('/dist/tool.d.ts'))?.contentHash,
    )
  })

  it('accepts exactly the declaration file budget and rejects one file beyond it', async () => {
    const fixture = await createFixture()

    await expect(acquisitionWithBudget(budget({ maxDeclarationFilesPerPackage: 2 })).acquire(fixture.target)).resolves.toBeDefined()
    await expect(acquisitionWithBudget(budget({ maxDeclarationFilesPerPackage: 1 })).acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts exactly the per-file byte budget and rejects one byte beyond it', async () => {
    const fixture = await createFixture()
    const declaration = path.join(path.dirname(fixture.toolsManifestLocation), 'dist', 'tool.d.ts')
    const content = `export interface ToolDefinition { readonly payload: '${'x'.repeat(1024)}' }\n`
    await writeFile(declaration, content, 'utf8')
    const bytes = Buffer.byteLength(content, 'utf8')

    await expect(acquisitionWithBudget(budget({ maxDeclarationBytesPerFile: bytes })).acquire(fixture.target)).resolves.toBeDefined()
    await expect(acquisitionWithBudget(budget({ maxDeclarationBytesPerFile: bytes - 1 })).acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts exactly the package byte budget and rejects one byte beyond it', async () => {
    const fixture = await createFixture()
    const packageRoot = path.dirname(fixture.toolsManifestLocation)
    const indexContent = await readFile(path.join(packageRoot, 'dist', 'index.d.ts'), 'utf8')
    const toolContent = await readFile(path.join(packageRoot, 'dist', 'tool.d.ts'), 'utf8')
    const bytes = Buffer.byteLength(indexContent, 'utf8') + Buffer.byteLength(toolContent, 'utf8')

    await expect(acquisitionWithBudget(budget({ maxDeclarationBytesPerPackage: bytes })).acquire(fixture.target)).resolves.toBeDefined()
    await expect(acquisitionWithBudget(budget({ maxDeclarationBytesPerPackage: bytes - 1 })).acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts exactly the declaration graph edge budget and rejects one edge beyond it', async () => {
    const fixture = await createFixture()

    await expect(acquisitionWithBudget(budget({ maxDeclarationReferenceEdgesPerPackage: 1 })).acquire(fixture.target)).resolves.toBeDefined()
    await expect(acquisitionWithBudget(budget({ maxDeclarationReferenceEdgesPerPackage: 0 })).acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts exactly the declaration graph depth budget and rejects one level beyond it', async () => {
    const fixture = await createFixture()

    await expect(acquisitionWithBudget(budget({ maxDeclarationDepth: 1 })).acquire(fixture.target)).resolves.toBeDefined()
    await expect(acquisitionWithBudget(budget({ maxDeclarationDepth: 0 })).acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('rejects declaration entrypoints that escape the exact package root', async () => {
    const fixture = await createFixture()
    const manifest = JSON.parse(await readFile(fixture.toolsManifestLocation, 'utf8')) as Record<string, unknown>
    manifest.exports = { '.': { types: '../outside.d.ts' } }
    const changed = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(fixture.toolsManifestLocation, changed, 'utf8')
    const target = snapshot(fixture.target.evidence.map(item =>
      item.id === 'manifest:dependency:@deepseek-ai/dsh-tools'
        ? manifestEvidence(item.id, item.source ?? '', fixture.toolsManifestLocation, changed)
        : item,
    ))
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    await expect(acquisition.acquire(target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_INVALID',
    })
  })

  it('rejects declaration references whose in-package path is a symlink to outside', async () => {
    const fixture = await createFixture()
    const packageRoot = path.dirname(fixture.toolsManifestLocation)
    const outside = path.join(fixture.root, 'outside.d.ts')
    const insideLink = path.join(packageRoot, 'dist', 'outside-link.d.ts')
    await writeFile(outside, 'export interface OutsideContract {}\n', 'utf8')
    await symlink(outside, insideLink, 'file')
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      "export { OutsideContract } from './outside-link.js'\n",
      'utf8',
    )
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    await expect(acquisition.acquire(fixture.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_INVALID',
    })
  })

  it('fails loud when a manifest declares a missing public declaration entrypoint', async () => {
    const fixture = await createFixture()
    const manifest = JSON.parse(await readFile(fixture.toolsManifestLocation, 'utf8')) as Record<string, unknown>
    manifest.exports = { '.': { types: './missing.d.ts' } }
    const changed = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(fixture.toolsManifestLocation, changed, 'utf8')
    const target = snapshot(fixture.target.evidence.map(item =>
      item.id === 'manifest:dependency:@deepseek-ai/dsh-tools'
        ? manifestEvidence(item.id, item.source ?? '', fixture.toolsManifestLocation, changed)
        : item,
    ))
    const acquisition = createDshContractFilesystemAcquisition({ digest: createNodeSha256Port() })

    await expect(acquisition.acquire(target)).rejects.toMatchObject({
      code: 'CONTRACT_EVIDENCE_READ_FAILED',
    })
  })
})
