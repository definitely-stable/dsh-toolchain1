import { open, readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
import type {
  DeclarationReexportEdge,
  DeclarationSyntaxPort,
} from './typescript-declaration-syntax.js'

export interface ContractAcquisitionBudgetV1 {
  readonly maxContractPackages: number
  readonly maxDeclarationFilesPerPackage: number
  readonly maxDeclarationBytesPerFile: number
  readonly maxDeclarationBytesPerPackage: number
  readonly maxDeclarationReferenceEdgesPerPackage: number
  readonly maxDeclarationDepth: number
  readonly maxNormalizedFactsPerPackage: number
}

interface AcquisitionOptions {
  readonly digest?: Sha256Port
  readonly budget?: Partial<ContractAcquisitionBudgetV1>
  readonly syntax?: DeclarationSyntaxPort
}

interface ExpectedPackage {
  readonly name: string
  readonly version: string
  readonly manifestEvidenceIds: readonly string[]
}

interface PackageCandidate {
  readonly name: string
  readonly version: string
  readonly manifestEvidenceId: string
}

interface ManifestRecord {
  readonly name: string
  readonly version: string
  readonly evidence: Evidence
  readonly packageRoot: string
  readonly canonicalPackageRoot: string
  readonly value: Record<string, unknown>
}

type ResolvedDeclarationReexportEdge = DeclarationReexportEdge & {
  readonly location: string
}

interface ResolvedPathReference {
  readonly specifier: string
  readonly location: string
}

interface DeclarationRecord {
  readonly location: string
  readonly relativePath: string
  readonly evidence: Evidence
  readonly exports: readonly string[]
  readonly reexports: readonly ResolvedDeclarationReexportEdge[]
  readonly pathReferences: readonly ResolvedPathReference[]
}

interface DeclarationQueueItem {
  readonly location: string
  readonly depth: number
}

interface DeclarationEntry {
  readonly location: string
  readonly relativePath: string
  readonly evidenceId: string
}

interface DeclarationGraph {
  readonly records: readonly DeclarationRecord[]
  readonly entries: readonly DeclarationEntry[]
}

type ExportWitnessMap = Map<string, readonly string[]>

const DEFAULT_CONTRACT_ACQUISITION_BUDGET_V1: ContractAcquisitionBudgetV1 = Object.freeze({
  maxContractPackages: 512,
  maxDeclarationFilesPerPackage: 2_048,
  maxDeclarationBytesPerFile: 4 * 1024 * 1024,
  maxDeclarationBytesPerPackage: 64 * 1024 * 1024,
  maxDeclarationReferenceEdgesPerPackage: 8_192,
  maxDeclarationDepth: 64,
  maxNormalizedFactsPerPackage: 16_384,
})

const DECLARATION_READ_CHUNK_BYTES = 64 * 1024
const DSH_AUTHORITY_PREFIX = '@deepseek-ai/'

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

function resourceLimitError(
  subject: string,
  limit: keyof ContractAcquisitionBudgetV1,
  location: string,
): ContractAcquisitionError {
  return acquisitionError(
    'CONTRACT_DECLARATION_LIMIT_EXCEEDED',
    `Contract acquisition exceeded ${limit} for ${subject}`,
    location === '' ? [] : [location],
  )
}

function normalizeBudget(budget: Partial<ContractAcquisitionBudgetV1> | undefined): ContractAcquisitionBudgetV1 {
  const value: ContractAcquisitionBudgetV1 = {
    ...DEFAULT_CONTRACT_ACQUISITION_BUDGET_V1,
    ...budget,
  }
  for (const [name, limit] of Object.entries(value)) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError(`Contract acquisition budget ${name} must be a non-negative safe integer`)
    }
  }
  return Object.freeze(value)
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

function groupPackageCandidates(candidates: readonly PackageCandidate[]): readonly ExpectedPackage[] {
  const grouped = new Map<string, { version: string; manifestEvidenceIds: Set<string> }>()
  for (const candidate of candidates) {
    const existing = grouped.get(candidate.name)
    if (existing === undefined) {
      grouped.set(candidate.name, {
        version: candidate.version,
        manifestEvidenceIds: new Set([candidate.manifestEvidenceId]),
      })
      continue
    }
    if (existing.version !== candidate.version) {
      throw acquisitionError(
        'CONTRACT_MANIFEST_INVALID',
        `Target snapshot resolves ${candidate.name} at multiple versions: ${existing.version} and ${candidate.version}`,
        [],
      )
    }
    existing.manifestEvidenceIds.add(candidate.manifestEvidenceId)
  }

  return Object.freeze(
    [...grouped.entries()]
      .map(([name, value]) => Object.freeze({
        name,
        version: value.version,
        manifestEvidenceIds: Object.freeze([...value.manifestEvidenceIds].toSorted(compareCodePoints)),
      }))
      .toSorted((left, right) => compareCodePoints(left.name, right.name)),
  )
}

function expectedPackages(snapshot: TargetSnapshot): readonly ExpectedPackage[] {
  const bundleEvidenceIds = bundleManifestEvidenceIds(snapshot)
  const bundles: PackageCandidate[] = snapshot.profile.bundles.map(bundle => {
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

  return groupPackageCandidates([
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
  ])
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

async function readBoundedDeclarationUtf8(
  packageName: string,
  location: string,
  budget: ContractAcquisitionBudgetV1,
  packageBytesUsed: number,
): Promise<{ readonly content: string; readonly bytes: number }> {
  let handle
  try {
    handle = await open(location, 'r')
  } catch (cause) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Could not open declaration evidence: ${location}`,
      [location],
      cause,
    )
  }

  try {
    const stats = await handle.stat()
    if (stats.size > budget.maxDeclarationBytesPerFile) {
      throw resourceLimitError(packageName, 'maxDeclarationBytesPerFile', location)
    }
    if (packageBytesUsed + stats.size > budget.maxDeclarationBytesPerPackage) {
      throw resourceLimitError(packageName, 'maxDeclarationBytesPerPackage', location)
    }

    const chunks: Buffer[] = []
    let bytes = 0
    while (true) {
      const remainingPerFile = budget.maxDeclarationBytesPerFile - bytes
      const remainingPerPackage = budget.maxDeclarationBytesPerPackage - packageBytesUsed - bytes
      const remaining = Math.min(remainingPerFile, remainingPerPackage)
      const length = Math.min(DECLARATION_READ_CHUNK_BYTES, Math.max(1, remaining + 1))
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, { offset: 0, length, position: null })
      if (bytesRead === 0) break

      bytes += bytesRead
      if (bytes > budget.maxDeclarationBytesPerFile) {
        throw resourceLimitError(packageName, 'maxDeclarationBytesPerFile', location)
      }
      if (packageBytesUsed + bytes > budget.maxDeclarationBytesPerPackage) {
        throw resourceLimitError(packageName, 'maxDeclarationBytesPerPackage', location)
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }

    return { content: Buffer.concat(chunks, bytes).toString('utf8'), bytes }
  } catch (cause) {
    if (cause instanceof ContractAcquisitionError) throw cause
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Could not read declaration evidence: ${location}`,
      [location],
      cause,
    )
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function parseManifestValue(
  content: string,
  location: string,
  expectedName: string,
  expectedVersion?: string,
): { readonly value: Record<string, unknown>; readonly version: string } {
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch (cause) {
    throw acquisitionError(
      'CONTRACT_MANIFEST_INVALID',
      `Contract package manifest is invalid: ${location}`,
      [location],
      cause,
    )
  }
  if (!isRecord(value) || value.name !== expectedName || typeof value.version !== 'string' || value.version === '') {
    throw acquisitionError(
      'CONTRACT_MANIFEST_INVALID',
      `Expected exact package ${expectedName} in ${location}`,
      [location],
    )
  }
  if (expectedVersion !== undefined && value.version !== expectedVersion) {
    throw acquisitionError(
      'CONTRACT_MANIFEST_INVALID',
      `Expected exact package ${expectedName}@${expectedVersion} in ${location}`,
      [location],
    )
  }
  return { value, version: value.version }
}

async function manifestRecord(
  name: string,
  version: string,
  evidence: Evidence,
  value: Record<string, unknown>,
): Promise<ManifestRecord> {
  if (evidence.location === undefined) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Contract manifest evidence for ${name} has no location`,
      [],
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
  return {
    name,
    version,
    evidence: Object.freeze({ ...evidence }),
    packageRoot,
    canonicalPackageRoot,
    value,
  }
}

async function acquireManifest(
  snapshot: TargetSnapshot,
  expected: ExpectedPackage,
  manifestEvidenceId: string,
  digest: Sha256Port,
): Promise<ManifestRecord> {
  const evidence = snapshot.evidence.find(item => item.id === manifestEvidenceId)
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

  const parsed = parseManifestValue(content, evidence.location, expected.name, expected.version)
  return manifestRecord(expected.name, parsed.version, evidence, parsed.value)
}

async function acquireManifestAliases(
  snapshot: TargetSnapshot,
  expected: ExpectedPackage,
  digest: Sha256Port,
): Promise<readonly ManifestRecord[]> {
  const manifests: ManifestRecord[] = []
  for (const manifestEvidenceId of expected.manifestEvidenceIds) {
    manifests.push(await acquireManifest(snapshot, expected, manifestEvidenceId, digest))
  }
  const primary = manifests[0]
  if (primary === undefined) {
    throw acquisitionError(
      'CONTRACT_EVIDENCE_READ_FAILED',
      `Target snapshot has no manifest evidence aliases for ${expected.name}`,
      [],
    )
  }
  for (const alias of manifests.slice(1)) {
    if (alias.canonicalPackageRoot !== primary.canonicalPackageRoot) {
      throw acquisitionError(
        'CONTRACT_MANIFEST_INVALID',
        `Target snapshot resolves ${expected.name}@${expected.version} to multiple installed package roots`,
        manifests.map(item => item.evidence.location).filter((location): location is string => location !== undefined),
      )
    }
  }
  return Object.freeze(manifests)
}

async function resolvePackageManifestFromAnchor(
  anchor: string,
  packageName: string,
): Promise<string | undefined> {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = path.join(searchPath, packageName, 'package.json')
    try {
      await realpath(candidate)
      return candidate
    } catch (cause) {
      if (isMissing(cause)) continue
      throw acquisitionError(
        'CONTRACT_EVIDENCE_READ_FAILED',
        `Could not resolve installed contract package ${packageName}: ${candidate}`,
        [candidate],
        cause,
      )
    }
  }
  return undefined
}

async function acquireDiscoveredManifest(
  name: string,
  location: string,
  digest: Sha256Port,
): Promise<ManifestRecord> {
  const content = await readUtf8(location)
  const parsed = parseManifestValue(content, location, name)
  const evidence: Evidence = {
    id: `manifest:closure:${name}`,
    kind: 'manifest',
    strength: 'authoritative',
    source: `${name}/package.json`,
    contentHash: await digest.sha256Utf8(content),
    location,
  }
  return manifestRecord(name, parsed.version, evidence, parsed.value)
}

function manifestDependencyNames(manifest: Record<string, unknown>): readonly string[] {
  const names = new Set<string>()
  for (const key of ['dependencies', 'peerDependencies'] as const) {
    const section = manifest[key]
    if (!isRecord(section)) continue
    for (const name of Object.keys(section)) {
      if (name.startsWith(DSH_AUTHORITY_PREFIX)) names.add(name)
    }
  }
  return Object.freeze([...names].toSorted(compareCodePoints))
}

async function discoverDshAuthorityClosure(
  snapshot: TargetSnapshot,
  explicitPackages: readonly ExpectedPackage[],
  digest: Sha256Port,
  budget: ContractAcquisitionBudgetV1,
): Promise<readonly ManifestRecord[]> {
  const explicitByName = new Map(explicitPackages.map(item => [item.name, item]))
  const dshExpected = explicitByName.get(snapshot.dsh.name)
  if (dshExpected === undefined) throw new Error('Expected DSH application package disappeared')
  const dshManifest = await acquireManifest(snapshot, dshExpected, 'manifest:dsh', digest)
  const queue: ManifestRecord[] = [dshManifest]
  const visited = new Set<string>([dshManifest.name])
  const discovered: ManifestRecord[] = []

  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    const anchor = current.evidence.location
    if (anchor === undefined) throw new Error(`Manifest location disappeared for ${current.name}`)
    for (const dependencyName of manifestDependencyNames(current.value)) {
      if (visited.has(dependencyName)) continue
      if (visited.size >= budget.maxContractPackages) {
        throw resourceLimitError(snapshot.dsh.name, 'maxContractPackages', anchor)
      }
      const manifestLocation = await resolvePackageManifestFromAnchor(anchor, dependencyName)
      if (manifestLocation === undefined) continue
      const manifest = await acquireDiscoveredManifest(dependencyName, manifestLocation, digest)
      visited.add(dependencyName)
      queue.push(manifest)

      const explicit = explicitByName.get(dependencyName)
      if (explicit !== undefined) {
        if (explicit.version !== manifest.version) {
          throw acquisitionError(
            'CONTRACT_MANIFEST_INVALID',
            `DSH closure resolves ${dependencyName}@${manifest.version} but target root resolves ${explicit.version}`,
            [manifestLocation],
          )
        }
        continue
      }
      discovered.push(manifest)
    }
  }

  return Object.freeze(discovered.toSorted((left, right) => compareCodePoints(left.name, right.name)))
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

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted(compareCodePoints))
}

function compareWitness(left: readonly string[], right: readonly string[]): number {
  if (left.length !== right.length) return left.length - right.length
  return compareCodePoints(left.join('\u0000'), right.join('\u0000'))
}

function addMinimalWitness(surface: ExportWitnessMap, name: string, witness: readonly string[]): boolean {
  const normalized = uniqueSorted(witness)
  const existing = surface.get(name)
  if (existing !== undefined && compareWitness(existing, normalized) <= 0) return false
  surface.set(name, normalized)
  return true
}

function sortedResolvedReexports(values: readonly ResolvedDeclarationReexportEdge[]): readonly ResolvedDeclarationReexportEdge[] {
  return Object.freeze([...values].toSorted((left, right) => {
    const bySpecifier = compareCodePoints(left.specifier, right.specifier)
    if (bySpecifier !== 0) return bySpecifier
    const byKind = compareCodePoints(left.kind, right.kind)
    if (byKind !== 0) return byKind
    return compareCodePoints(left.location, right.location)
  }))
}

async function readDeclarationGraph(
  manifest: ManifestRecord,
  packageName: string,
  entrypoints: readonly string[],
  digest: Sha256Port,
  budget: ContractAcquisitionBudgetV1,
  syntax: DeclarationSyntaxPort,
): Promise<DeclarationGraph> {
  const queue: DeclarationQueueItem[] = []
  const queued = new Set<string>()
  const entryLocations = new Map<string, string>()
  for (const entrypoint of entrypoints) {
    const location = await resolveDeclaration(manifest, manifest.packageRoot, entrypoint)
    entryLocations.set(entrypoint, location)
    if (!queued.has(location)) {
      queued.add(location)
      queue.push({ location, depth: 0 })
    }
  }

  const records = new Map<string, DeclarationRecord>()
  const edges = new Set<string>()
  let packageBytesUsed = 0
  while (queue.length > 0) {
    const item = queue.shift()!
    queued.delete(item.location)
    if (records.has(item.location)) continue
    if (item.depth > budget.maxDeclarationDepth) {
      throw resourceLimitError(packageName, 'maxDeclarationDepth', item.location)
    }
    if (records.size >= budget.maxDeclarationFilesPerPackage) {
      throw resourceLimitError(packageName, 'maxDeclarationFilesPerPackage', item.location)
    }

    const { content, bytes } = await readBoundedDeclarationUtf8(
      packageName,
      item.location,
      budget,
      packageBytesUsed,
    )
    packageBytesUsed += bytes
    const relativePath = portableRelative(manifest.packageRoot, item.location)
    const evidenceId = `types:${packageName}:${relativePath}`
    const evidence: Evidence = {
      id: evidenceId,
      kind: 'type-declaration',
      strength: 'authoritative',
      source: `${packageName}/${relativePath}`,
      contentHash: await digest.sha256Utf8(content),
      location: item.location,
    }

    let parsed
    try {
      parsed = syntax.parse(relativePath, content)
    } catch (cause) {
      throw acquisitionError(
        'CONTRACT_DECLARATION_INVALID',
        `Could not parse declaration evidence: ${item.location}`,
        [item.location],
        cause,
      )
    }

    const resolvedReexports: ResolvedDeclarationReexportEdge[] = []
    const resolvedPathReferences: ResolvedPathReference[] = []
    const references: Array<{ readonly specifier: string; readonly kind: 'reexport' | 'path-reference'; readonly edge?: DeclarationReexportEdge }> = [
      ...parsed.relativeReexports.map(edge => ({ kind: 'reexport' as const, specifier: edge.specifier, edge })),
      ...parsed.relativePathReferences.map(specifier => ({ kind: 'path-reference' as const, specifier })),
    ].toSorted((left, right) => {
      const bySpecifier = compareCodePoints(left.specifier, right.specifier)
      return bySpecifier !== 0 ? bySpecifier : compareCodePoints(left.kind, right.kind)
    })

    for (const reference of references) {
      const edgeId = `${item.location}\u0000${reference.kind}\u0000${reference.specifier}`
      if (!edges.has(edgeId)) {
        if (edges.size >= budget.maxDeclarationReferenceEdgesPerPackage) {
          throw resourceLimitError(packageName, 'maxDeclarationReferenceEdgesPerPackage', item.location)
        }
        edges.add(edgeId)
      }

      const referenced = await resolveDeclaration(manifest, path.dirname(item.location), reference.specifier)
      if (reference.kind === 'reexport') {
        if (reference.edge === undefined) throw new Error('Re-export reference lost its edge')
        resolvedReexports.push(Object.freeze({ ...reference.edge, location: referenced }))
      } else {
        resolvedPathReferences.push(Object.freeze({ specifier: reference.specifier, location: referenced }))
      }

      if (records.has(referenced) || queued.has(referenced)) continue
      const nextDepth = item.depth + 1
      if (nextDepth > budget.maxDeclarationDepth) {
        throw resourceLimitError(packageName, 'maxDeclarationDepth', referenced)
      }
      queued.add(referenced)
      queue.push({ location: referenced, depth: nextDepth })
    }

    records.set(item.location, Object.freeze({
      location: item.location,
      relativePath,
      evidence: Object.freeze(evidence),
      exports: Object.freeze([...parsed.exports]),
      reexports: sortedResolvedReexports(resolvedReexports),
      pathReferences: Object.freeze(resolvedPathReferences.toSorted((left, right) => {
        const bySpecifier = compareCodePoints(left.specifier, right.specifier)
        return bySpecifier !== 0 ? bySpecifier : compareCodePoints(left.location, right.location)
      })),
    }))
  }

  const entries = [...entryLocations.values()].map(location => {
    const record = records.get(location)
    if (record === undefined) throw new Error(`Declaration graph lost entrypoint ${location}`)
    return Object.freeze({
      location,
      relativePath: record.relativePath,
      evidenceId: record.evidence.id,
    })
  })

  return Object.freeze({
    records: Object.freeze(
      [...records.values()].toSorted((left, right) => compareCodePoints(left.relativePath, right.relativePath)),
    ),
    entries: Object.freeze(entries.toSorted((left, right) => compareCodePoints(left.relativePath, right.relativePath))),
  })
}

function declarationSurfaces(graph: DeclarationGraph): Map<string, ExportWitnessMap> {
  const surfaces = new Map<string, ExportWitnessMap>()
  for (const record of graph.records) {
    const surface: ExportWitnessMap = new Map()
    for (const exportedName of record.exports) addMinimalWitness(surface, exportedName, [record.evidence.id])
    surfaces.set(record.location, surface)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const record of graph.records) {
      const surface = surfaces.get(record.location)
      if (surface === undefined) throw new Error(`Declaration surface disappeared for ${record.location}`)
      for (const edge of record.reexports) {
        if (edge.kind !== 'star') continue
        const child = surfaces.get(edge.location)
        if (child === undefined) throw new Error(`Declaration star target disappeared for ${edge.location}`)
        for (const [name, witness] of [...child.entries()].toSorted(([left], [right]) => compareCodePoints(left, right))) {
          if (name === 'default' || name === 'export=') continue
          if (addMinimalWitness(surface, name, [record.evidence.id, ...witness])) changed = true
        }
      }
    }
  }
  return surfaces
}

function packageExportSurface(graph: DeclarationGraph): ExportWitnessMap {
  const surfaces = declarationSurfaces(graph)
  const result: ExportWitnessMap = new Map()
  for (const entry of graph.entries) {
    const surface = surfaces.get(entry.location)
    if (surface === undefined) throw new Error(`Declaration entry surface disappeared for ${entry.location}`)
    for (const [name, witness] of [...surface.entries()].toSorted(([left], [right]) => compareCodePoints(left, right))) {
      addMinimalWitness(result, name, witness)
    }
  }
  return result
}

function pushFact(
  facts: ContractFact[],
  fact: ContractFact,
  packageName: string,
  location: string,
  budget: ContractAcquisitionBudgetV1,
): void {
  if (facts.length >= budget.maxNormalizedFactsPerPackage) {
    throw resourceLimitError(packageName, 'maxNormalizedFactsPerPackage', location)
  }
  facts.push(fact)
}

async function buildPackageContract(
  packageName: string,
  packageVersion: string,
  manifests: readonly ManifestRecord[],
  digest: Sha256Port,
  budget: ContractAcquisitionBudgetV1,
  syntax: DeclarationSyntaxPort,
): Promise<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> {
  const manifest = manifests[0]
  if (manifest === undefined) throw new Error(`Manifest disappeared for ${packageName}`)
  const manifestEvidence = manifests.map(item => item.evidence)
  const manifestEvidenceIds = manifestEvidence.map(item => item.id).toSorted(compareCodePoints)
  const firstManifestEvidenceId = manifestEvidenceIds[0]
  if (firstManifestEvidenceId === undefined) throw new Error(`Manifest evidence disappeared for ${packageName}`)

  const entrypoints = declarationEntrypoints(manifest.value)
  const declarations = await readDeclarationGraph(
    manifest,
    packageName,
    entrypoints,
    digest,
    budget,
    syntax,
  )
  const facts: ContractFact[] = []
  const manifestLocation = manifest.evidence.location ?? manifest.packageRoot
  pushFact(facts, {
    key: 'version',
    value: packageVersion,
    evidenceIds: [firstManifestEvidenceId, ...manifestEvidenceIds.slice(1)],
  }, packageName, manifestLocation, budget)

  for (const entry of declarations.entries) {
    pushFact(facts, {
      key: 'declaration-entry',
      value: entry.relativePath,
      evidenceIds: [entry.evidenceId],
    }, packageName, entry.relativePath, budget)
  }

  const exported = packageExportSurface(declarations)
  for (const [exportedName, evidenceIds] of [...exported.entries()].toSorted(([left], [right]) => compareCodePoints(left, right))) {
    const firstEvidenceId = evidenceIds[0]
    if (firstEvidenceId === undefined) throw new Error(`Export witness disappeared for ${packageName}:${exportedName}`)
    pushFact(facts, {
      key: 'declaration-export',
      value: exportedName,
      evidenceIds: [firstEvidenceId, ...evidenceIds.slice(1)],
    }, packageName, manifestLocation, budget)
  }

  const declarationEvidence = declarations.records.map(record => record.evidence)
  const evidence = Object.freeze([...manifestEvidence, ...declarationEvidence])
  const evidenceIds = Object.freeze(evidence.map(item => item.id).toSorted(compareCodePoints))
  return Object.freeze({
    contract: Object.freeze({
      id: `package:${packageName}`,
      kind: 'package',
      name: packageName,
      qualifiedName: `package:${packageName}`,
      availability: 'unknown',
      summary: `Installed package ${packageName}@${packageVersion}`,
      facts: [...facts],
      evidenceIds: [...evidenceIds],
    }),
    evidence,
  })
}

async function acquireExplicitPackage(
  snapshot: TargetSnapshot,
  expected: ExpectedPackage,
  digest: Sha256Port,
  budget: ContractAcquisitionBudgetV1,
  syntax: DeclarationSyntaxPort,
): Promise<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> {
  const manifests = await acquireManifestAliases(snapshot, expected, digest)
  return buildPackageContract(expected.name, expected.version, manifests, digest, budget, syntax)
}

async function acquireDiscoveredPackage(
  manifest: ManifestRecord,
  digest: Sha256Port,
  budget: ContractAcquisitionBudgetV1,
  syntax: DeclarationSyntaxPort,
): Promise<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> {
  return buildPackageContract(manifest.name, manifest.version, [manifest], digest, budget, syntax)
}

export function createDshContractFilesystemAcquisition(
  options: AcquisitionOptions = {},
): ContractAcquisitionPort {
  const digest = options.digest ?? createNodeSha256Port()
  const budget = normalizeBudget(options.budget)
  let defaultSyntax: Promise<DeclarationSyntaxPort> | undefined

  async function syntaxPort(): Promise<DeclarationSyntaxPort> {
    if (options.syntax !== undefined) return options.syntax
    defaultSyntax ??= import('./typescript-declaration-syntax.js')
      .then(module => module.typescriptDeclarationSyntaxPort)
    return defaultSyntax
  }

  return {
    async acquire(snapshot): Promise<AcquiredContractFacts> {
      const explicit = expectedPackages(snapshot)
      if (explicit.length > budget.maxContractPackages) {
        const location = snapshot.evidence.find(item => item.id === 'manifest:dsh')?.location ?? ''
        throw resourceLimitError(snapshot.dsh.name, 'maxContractPackages', location)
      }

      const discovered = await discoverDshAuthorityClosure(snapshot, explicit, digest, budget)
      if (explicit.length + discovered.length > budget.maxContractPackages) {
        const location = snapshot.evidence.find(item => item.id === 'manifest:dsh')?.location ?? ''
        throw resourceLimitError(snapshot.dsh.name, 'maxContractPackages', location)
      }

      const syntax = await syntaxPort()
      const acquired: Array<{ readonly contract: ContractDefinition; readonly evidence: readonly Evidence[] }> = []
      for (const expected of explicit) {
        acquired.push(await acquireExplicitPackage(snapshot, expected, digest, budget, syntax))
      }
      for (const manifest of discovered) {
        acquired.push(await acquireDiscoveredPackage(manifest, digest, budget, syntax))
      }

      return Object.freeze({
        contracts: Object.freeze(
          acquired.map(item => item.contract).toSorted((left, right) => compareCodePoints(left.id, right.id)),
        ),
        evidence: Object.freeze(
          acquired.flatMap(item => item.evidence).toSorted((left, right) => compareCodePoints(left.id, right.id)),
        ),
      })
    },
  }
}
