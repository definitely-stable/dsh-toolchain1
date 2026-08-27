import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { Sha256Port } from '../model/digest.js'
import {
  ContractAcquisitionError,
  type AcquiredContractFacts,
  type ContractAcquisitionErrorCode,
  type ContractAcquisitionPort,
} from '../model/contract.js'
import type {
  ContractDefinition,
  ContractFact,
  Evidence,
  TargetSnapshot,
} from '../protocol/index.js'
import { createNodeSha256Port } from './node-sha256.js'

interface AcquisitionOptions {
  readonly digest?: Sha256Port
}

interface ExpectedPackage {
  readonly name: string
  readonly version: string
  readonly manifestEvidenceId: string
}

interface ManifestRecord {
  readonly evidence: Evidence
  readonly packageRoot: string
  readonly canonicalPackageRoot: string
  readonly value: Record<string, unknown>
}

interface DeclarationRecord {
  readonly location: string
  readonly relativePath: string
  readonly evidence: Evidence
  readonly symbols: readonly string[]
  readonly references: readonly string[]
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function acquisitionError(
  code: ContractAcquisitionErrorCode,
  message: string,
  locations: readonly string[],
  cause?: unknown,
): ContractAcquisitionError {
  return new ContractAcquisitionError(code, message, locations, cause === undefined ? undefined : { cause })
}

function bundleManifestEvidenceIds(snapshot: TargetSnapshot): Map<string, string[]> {
  const byName = new Map<string, Array<{ readonly index: number; readonly id: string }>>()
  for (const evidence of snapshot.evidence) {
    const match = /^manifest:bundle:(\d+):(.+)$/u.exec(evidence.id)
    if (match === null) continue
    const indexText = match[1]
    const name = match[2]
    if (indexText === undefined || name === undefined) continue
    const index = Number(indexText)
    const entries = byName.get(name) ?? []
    entries.push({ index, id: evidence.id })
    byName.set(name, entries)
  }

  return new Map(
    [...byName.entries()].map(([name, entries]) => [
      name,
      entries.toSorted((left, right) => left.index - right.index).map(entry => entry.id),
    ]),
  )
}

function expectedPackages(snapshot: TargetSnapshot): readonly ExpectedPackage[] {
  const bundleEvidenceIds = bundleManifestEvidenceIds(snapshot)
  const bundles = snapshot.profile.bundles.map(bundle => {
    const candidates = bundleEvidenceIds.get(bundle.name)
    const manifestEvidenceId = candidates?.shift()
    if (manifestEvidenceId === undefined) {
      throw acquisitionError(
        'CONTRACT_EVIDENCE_READ_FAILED',
        `Target snapshot has no original bundle manifest evidence for ${bundle.name}`,
        [],
      )
    }
    return {
      name: bundle.name,
      version: bundle.version,
      manifestEvidenceId,
    }
  })

  return [
    {
      name: snapshot.dsh.name,
      version: snapshot.dsh.version,
      manifestEvidenceId: 'manifest:dsh',
    },
    ...bundles,
    ...snapshot.profile.dependencies.map(dependency => ({
      name: dependency.name,
      version: dependency.version,
      manifestEvidenceId: `manifest:dependency:${dependency.name}`,
    })),
  ]
}

async function readUtf8(location: string): Promise<string> {
  try {
    return await readFile(location, 'utf8')
  } catch (cause) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Could not read contract evidence: ${location}`,
      [location],
      cause,
    )
  }
}

async function acquireManifest(
  snapshot: TargetSnapshot,
  expected: ExpectedPackage,
  digest: Sha256Port,
): Promise<ManifestRecord> {
  const evidence = snapshot.evidence.find(item => item.id === expected.manifestEvidenceId)
  if (
    evidence === undefined
    || evidence.kind !== 'manifest'
    || evidence.location === undefined
    || evidence.contentHash === undefined
  ) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Target snapshot has no usable manifest evidence for ${expected.name}`,
      evidence?.location === undefined ? [] : [evidence.location],
    )
  }

  const content = await readUtf8(evidence.location)
  const currentHash = await digest.sha256Utf8(content)
  if (currentHash !== evidence.contentHash) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_STALE',
      `Target-captured manifest evidence changed for ${expected.name}`,
      [evidence.location],
    )
  }

  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch (cause) {
    throw acquisitionError(
      'CONTRACT_MANIFEST_INVALID',
      `Contract package manifest is invalid: ${evidence.location}`,
      [evidence.location],
      cause,
    )
  }
  if (
    !isRecord(value)
    || value.name !== expected.name
    || value.version !== expected.version
  ) {
    throw acquisitionError(
      'CONTRACT_MANIFEST_INVALID',
      `Expected exact package ${expected.name}@${expected.version} in ${evidence.location}`,
      [evidence.location],
    )
  }

  const packageRoot = path.dirname(evidence.location)
  let canonicalPackageRoot: string
  try {
    canonicalPackageRoot = await realpath(packageRoot)
  } catch (cause) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Could not resolve contract package root: ${packageRoot}`,
      [packageRoot],
      cause,
    )
  }
  return { evidence: Object.freeze({ ...evidence }), packageRoot, canonicalPackageRoot, value }
}

function collectExportTypePaths(value: unknown, result: Set<string>): void {
  if (!isRecord(value)) return
  if (typeof value.types === 'string' && value.types.length > 0) result.add(value.types)
  for (const child of Object.values(value)) collectExportTypePaths(child, result)
}

function declarationEntrypoints(manifest: Record<string, unknown>): readonly string[] {
  const result = new Set<string>()
  if (typeof manifest.types === 'string' && manifest.types.length > 0) result.add(manifest.types)
  if (typeof manifest.typings === 'string' && manifest.typings.length > 0) result.add(manifest.typings)
  collectExportTypePaths(manifest.exports, result)
  return Object.freeze([...result].toSorted(compareCodePoints))
}

function portableRelative(root: string, location: string): string {
  return path.relative(root, location).split(path.sep).join('/')
}

function escapesRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

function assertLexicallyInsidePackage(packageRoot: string, requested: string, candidate: string): void {
  if (!escapesRoot(packageRoot, candidate)) return
  throw acquisitionError(
    'CONTRACT_DECLARATION_INVALID',
    `Declaration reference escapes package root: ${requested}`,
    [candidate],
  )
}

function assertCanonicallyInsidePackage(
  canonicalPackageRoot: string,
  requested: string,
  candidate: string,
  canonicalCandidate: string,
): void {
  if (!escapesRoot(canonicalPackageRoot, canonicalCandidate)) return
  throw acquisitionError(
    'CONTRACT_DECLARATION_INVALID',
    `Declaration reference escapes package root through a symlink: ${requested}`,
    [candidate],
  )
}

function declarationCandidates(base: string, specifier: string): readonly string[] {
  const resolved = path.resolve(base, specifier)
  if (specifier.endsWith('.d.ts') || specifier.endsWith('.d.mts') || specifier.endsWith('.d.cts')) {
    return [resolved]
  }
  if (specifier.endsWith('.js')) return [`${resolved.slice(0, -3)}.d.ts`]
  if (specifier.endsWith('.mjs')) return [`${resolved.slice(0, -4)}.d.mts`]
  if (specifier.endsWith('.cjs')) return [`${resolved.slice(0, -4)}.d.cts`]
  if (path.extname(specifier) !== '') return []
  return [
    `${resolved}.d.ts`,
    `${resolved}.d.mts`,
    `${resolved}.d.cts`,
    path.join(resolved, 'index.d.ts'),
    path.join(resolved, 'index.d.mts'),
    path.join(resolved, 'index.d.cts'),
  ]
}

async function resolveDeclaration(
  manifest: ManifestRecord,
  base: string,
  specifier: string,
): Promise<string> {
  const candidates = declarationCandidates(base, specifier)
  if (candidates.length === 0) {
    throw acquisitionError(
      'CONTRACT_DECLARATION_INVALID',
      `Unsupported declaration reference ${specifier}`,
      [path.resolve(base, specifier)],
    )
  }

  for (const candidate of candidates) {
    // Reject lexical traversal before touching the filesystem so a nonexistent
    // escape is not misreported as ordinary missing declaration evidence.
    assertLexicallyInsidePackage(manifest.packageRoot, specifier, candidate)

    let canonicalCandidate: string
    try {
      canonicalCandidate = await realpath(candidate)
    } catch (cause) {
      if (isMissing(cause)) continue
      throw acquisitionError(
        'CONTRACT_EVIDENCE_READ_FAILED',
        `Could not resolve declaration evidence: ${candidate}`,
        [candidate],
        cause,
      )
    }
    assertCanonicallyInsidePackage(
      manifest.canonicalPackageRoot,
      specifier,
      candidate,
      canonicalCandidate,
    )
    return candidate
  }

  const location = candidates[0] ?? path.resolve(base, specifier)
  throw acquisitionError(
    'CONTRACT_EVIDENCE_READ_FAILED',
    `Declared contract evidence was not found: ${location}`,
    [location],
  )
}

function declarationSymbols(content: string): readonly string[] {
  const symbols = new Set<string>()
  const pattern = /\b(?:export\s+)?(?:declare\s+)?(?:interface|type|class|function|const|let|var|enum|namespace)\s+([A-Za-z_$][\w$]*)/gu
  for (const match of content.matchAll(pattern)) {
    const symbol = match[1]
    if (symbol !== undefined) symbols.add(symbol)
  }
  return Object.freeze([...symbols].toSorted(compareCodePoints))
}

function declarationReferences(content: string): readonly string[] {
  const references = new Set<string>()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/gu,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\/\/\/\s*<reference\s+path=['"]([^'"]+)['"]/gu,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier?.startsWith('.')) references.add(specifier)
    }
  }
  return Object.freeze([...references].toSorted(compareCodePoints))
}

async function readDeclarationGraph(
  manifest: ManifestRecord,
  packageName: string,
  entrypoints: readonly string[],
  digest: Sha256Port,
): Promise<{
  readonly records: readonly DeclarationRecord[]
  readonly entries: readonly { relativePath: string; evidenceId: string }[]
}> {
  const queue: string[] = []
  const entryLocations = new Map<string, string>()
  for (const entrypoint of entrypoints) {
    const location = await resolveDeclaration(manifest, manifest.packageRoot, entrypoint)
    entryLocations.set(entrypoint, location)
    queue.push(location)
  }

  const records = new Map<string, DeclarationRecord>()
  while (queue.length > 0) {
    const location = queue.shift()!
    if (records.has(location)) continue
    const content = await readUtf8(location)
    const relativePath = portableRelative(manifest.packageRoot, location)
    const evidenceId = `types:${packageName}:${relativePath}`
    const evidence: Evidence = {
      id: evidenceId,
      kind: 'type-declaration',
      strength: 'authoritative',
      source: `${packageName}/${relativePath}`,
      contentHash: await digest.sha256Utf8(content),
      location,
    }
    const record: DeclarationRecord = {
      location,
      relativePath,
      evidence,
      symbols: declarationSymbols(content),
      references: declarationReferences(content),
    }
    records.set(location, record)

    for (const specifier of record.references) {
      const referenced = await resolveDeclaration(manifest, path.dirname(location), specifier)
      if (!records.has(referenced) && !queue.includes(referenced)) queue.push(referenced)
    }
  }

  const entries = [...entryLocations.values()].map(location => {
    const record = records.get(location)
    if (record === undefined) throw new Error(`Declaration graph lost entrypoint ${location}`)
    return { relativePath: record.relativePath, evidenceId: record.evidence.id }
  })

  return {
    records: Object.freeze([...records.values()].toSorted((left, right) => compareCodePoints(left.relativePath, right.relativePath))),
    entries: Object.freeze(entries.toSorted((left, right) => compareCodePoints(left.relativePath, right.relativePath))),
  }
}

async function acquirePackage(
  snapshot: TargetSnapshot,
  expected: ExpectedPackage,
  digest: Sha256Port,
): Promise<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> {
  const manifest = await acquireManifest(snapshot, expected, digest)
  const entrypoints = declarationEntrypoints(manifest.value)
  const declarations = await readDeclarationGraph(manifest, expected.name, entrypoints, digest)
  const facts: ContractFact[] = [{
    key: 'version',
    value: expected.version,
    evidenceIds: [manifest.evidence.id],
  }]
  for (const entry of declarations.entries) {
    facts.push({ key: 'declaration-entry', value: entry.relativePath, evidenceIds: [entry.evidenceId] })
  }
  for (const declaration of declarations.records) {
    for (const symbol of declaration.symbols) {
      facts.push({ key: 'declaration-symbol', value: symbol, evidenceIds: [declaration.evidence.id] })
    }
  }

  const declarationEvidence = declarations.records.map(record => record.evidence)
  const evidence = Object.freeze([manifest.evidence, ...declarationEvidence])
  const evidenceIds = Object.freeze(evidence.map(item => item.id).toSorted(compareCodePoints))
  return {
    contract: Object.freeze({
      id: `package:${expected.name}`,
      kind: 'package',
      name: expected.name,
      qualifiedName: `package:${expected.name}`,
      availability: 'unknown',
      summary: `Installed package ${expected.name}@${expected.version}`,
      facts: [...facts],
      evidenceIds: [...evidenceIds],
    }),
    evidence,
  }
}

export function createDshContractFilesystemAcquisition(
  options: AcquisitionOptions = {},
): ContractAcquisitionPort {
  const digest = options.digest ?? createNodeSha256Port()
  return {
    async acquire(snapshot): Promise<AcquiredContractFacts> {
      const acquired: Array<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> = []
      for (const expected of expectedPackages(snapshot)) {
        acquired.push(await acquirePackage(snapshot, expected, digest))
      }

      return Object.freeze({
        contracts: Object.freeze(acquired.map(item => item.contract).toSorted((left, right) => compareCodePoints(left.id, right.id))),
        evidence: Object.freeze(
          acquired.flatMap(item => item.evidence).toSorted((left, right) => compareCodePoints(left.id, right.id)),
        ),
      })
    },
  }
}
