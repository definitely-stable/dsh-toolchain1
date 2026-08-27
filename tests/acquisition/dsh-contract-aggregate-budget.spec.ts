import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDshContractFilesystemAcquisition } from '../../src/acquisition/dsh-contract-filesystem.js'
import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import type { DeclarationSyntaxPort } from '../../src/acquisition/typescript-declaration-syntax.js'
import type { Evidence, TargetSnapshot } from '../../src/protocol/index.js'

const temporaryRoots: string[] = []

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-total-budget-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function writePackage(
  modulesRoot: string,
  name: string,
  declaration: string,
): Promise<{ readonly manifestLocation: string; readonly manifestContent: string; readonly declarationBytes: number }> {
  const packageRoot = path.join(modulesRoot, ...name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  const manifestContent = `${JSON.stringify({ name, version: '0.1.1-rc.2', types: './index.d.ts' }, null, 2)}\n`
  const manifestLocation = path.join(packageRoot, 'package.json')
  await writeFile(manifestLocation, manifestContent, 'utf8')
  await writeFile(path.join(packageRoot, 'index.d.ts'), declaration, 'utf8')
  return {
    manifestLocation,
    manifestContent,
    declarationBytes: Buffer.byteLength(declaration, 'utf8'),
  }
}

function evidence(id: string, source: string, location: string, content: string): Evidence {
  return {
    id,
    kind: 'manifest',
    strength: 'authoritative',
    source,
    contentHash: sha256(content),
    location,
  }
}

async function fixture(): Promise<{
  readonly target: TargetSnapshot
  readonly declarationFiles: number
  readonly declarationBytes: number
}> {
  const root = await temporaryRoot()
  const modulesRoot = path.join(root, 'node_modules')
  const dsh = await writePackage(
    modulesRoot,
    '@deepseek-ai/dsh',
    'export interface DshApplication {}\n',
  )
  const tools = await writePackage(
    modulesRoot,
    '@deepseek-ai/dsh-tools',
    'export interface ToolDefinition { readonly name: string }\n',
  )

  return {
    declarationFiles: 2,
    declarationBytes: dsh.declarationBytes + tools.declarationBytes,
    target: {
      fingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      createdAt: '2026-08-27T00:00:00.000Z',
      dsh: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      runtime: { nodeVersion: '24.19.0', platform: 'linux', arch: 'x64' },
      profile: {
        name: 'web',
        bundles: [],
        dependencies: [{ name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' }],
        profilePatchHash: 'b'.repeat(64),
        homePatchHash: 'c'.repeat(64),
        overlayPatchHashes: [],
      },
      evidence: [
        evidence('manifest:dsh', '@deepseek-ai/dsh', dsh.manifestLocation, dsh.manifestContent),
        evidence(
          'manifest:dependency:@deepseek-ai/dsh-tools',
          '@deepseek-ai/dsh-tools',
          tools.manifestLocation,
          tools.manifestContent,
        ),
      ],
    },
  }
}

function acquisitionWithTotals(overrides: Record<string, number>) {
  const limits = {
    maxDeclarationFilesPerPackage: 10_000,
    maxTotalDeclarationFiles: 10_000,
    maxTotalDeclarationBytes: 256 * 1024 * 1024,
    maxTotalNormalizedFacts: 100_000,
    ...overrides,
  }
  return createDshContractFilesystemAcquisition({
    digest: createNodeSha256Port(),
    budget: limits,
  })
}

describe('DSH Contract aggregate acquisition budgets', () => {
  it('accepts the exact total declaration file budget and rejects one file below it', async () => {
    const value = await fixture()

    await expect(acquisitionWithTotals({
      maxTotalDeclarationFiles: value.declarationFiles,
    }).acquire(value.target)).resolves.toBeDefined()
    await expect(acquisitionWithTotals({
      maxTotalDeclarationFiles: value.declarationFiles - 1,
    }).acquire(value.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts the exact total declaration byte budget and rejects one byte below it', async () => {
    const value = await fixture()

    await expect(acquisitionWithTotals({
      maxTotalDeclarationBytes: value.declarationBytes,
    }).acquire(value.target)).resolves.toBeDefined()
    await expect(acquisitionWithTotals({
      maxTotalDeclarationBytes: value.declarationBytes - 1,
    }).acquire(value.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('accepts the exact total normalized fact budget and rejects one fact below it', async () => {
    const value = await fixture()
    const baseline = await createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
    }).acquire(value.target)
    const facts = baseline.contracts.reduce((total, contract) => total + contract.facts.length, 0)

    await expect(acquisitionWithTotals({
      maxTotalNormalizedFacts: facts,
    }).acquire(value.target)).resolves.toBeDefined()
    await expect(acquisitionWithTotals({
      maxTotalNormalizedFacts: facts - 1,
    }).acquire(value.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })

  it('rejects an oversized parsed export list before materializing its iterator', async () => {
    const value = await fixture()
    const names = ['One', 'Two', 'Three', 'Four']
    const exports = new Proxy(names, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error('parsed export list was materialized before its structural budget check')
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const syntax: DeclarationSyntaxPort = Object.freeze({
      parse() {
        return Object.freeze({
          exports,
          relativeReexports: Object.freeze([]),
          relativePathReferences: Object.freeze([]),
        })
      },
    })

    await expect(createDshContractFilesystemAcquisition({
      digest: createNodeSha256Port(),
      syntax,
      budget: { maxNormalizedFactsPerPackage: 3 },
    }).acquire(value.target)).rejects.toMatchObject({
      code: 'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    })
  })
})
