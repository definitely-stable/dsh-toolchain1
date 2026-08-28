import type { Sha256Port } from '../../src/model/digest.js'

import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'

export const ORDINARY_WORKSPACE_MAX_FILES = 10_000
export const ORDINARY_WORKSPACE_MAX_FILE_BYTES = 512 * 1024
export const ORDINARY_WORKSPACE_MAX_TOTAL_BYTES = 16 * 1024 * 1024

const VIRTUAL_ROOT = '/exact-target/node_modules/'
const WORKSPACE_SCHEMA = 'dsh-toolchain-m2-ordinary-workspace-v1'
const FIXTURE_VERSION = 'rc2-web-v1'
const INCLUSION_POLICY = 'published-package-conventional-evidence-v1'
const MEDIA_TYPES = new Set(['application/json', 'text/plain', 'text/typescript'])
const FORBIDDEN_PATH_FRAGMENTS = [
  '/contract-facts.json',
  '/docs/evaluation/m2/',
  '/api-oracle-v1.json',
  '/agent-holdout-h1.commitment.json',
  '/agent-pilot-p0.json',
]

export type OrdinaryWorkspaceMediaType = 'application/json' | 'text/plain' | 'text/typescript'

export interface OrdinaryWorkspaceFileInput {
  readonly path: string
  readonly mediaType: OrdinaryWorkspaceMediaType
  readonly content: string
}

export interface OrdinaryWorkspaceFile extends OrdinaryWorkspaceFileInput {
  sha256: string
  byteLength: number
}

export interface OrdinaryWorkspaceTarget {
  readonly package: '@deepseek-ai/dsh'
  readonly version: '0.1.1-rc.2'
  readonly profile: 'web'
  readonly targetFingerprint: string
  readonly contractIndexFingerprint: string
}

export interface OrdinaryWorkspacePackage {
  readonly name: string
  readonly version: string
}

export interface OrdinaryWorkspace {
  readonly schema: 'dsh-toolchain-m2-ordinary-workspace-v1'
  readonly fixtureVersion: 'rc2-web-v1'
  readonly target: OrdinaryWorkspaceTarget
  readonly inclusionPolicy: 'published-package-conventional-evidence-v1'
  readonly packages: readonly OrdinaryWorkspacePackage[]
  readonly files: readonly OrdinaryWorkspaceFile[]
  documentationSha256: string
  workspaceSnapshotSha256: string
}

export interface OrdinaryWorkspaceInput {
  readonly fixtureVersion: 'rc2-web-v1'
  readonly target: OrdinaryWorkspaceTarget
  readonly packages: readonly OrdinaryWorkspacePackage[]
  readonly files: readonly OrdinaryWorkspaceFileInput[]
}

interface OrdinaryWorkspaceFileProjection {
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: OrdinaryWorkspaceMediaType
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty`)
}

function assertVirtualPath(path: string): void {
  assertNonEmpty(path, 'Ordinary workspace path')
  if (path.includes('\\')) throw new Error('Ordinary workspace path must not contain backslashes')
  if (!path.startsWith(VIRTUAL_ROOT)) {
    throw new Error(`Ordinary workspace path must stay under ${VIRTUAL_ROOT}`)
  }
  if (path.includes('\0')) throw new Error('Ordinary workspace path must not contain NUL')

  const segments = path.split('/')
  if (segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error('Ordinary workspace path traversal is forbidden')
  }

  const lower = path.toLocaleLowerCase('en-US')
  if (FORBIDDEN_PATH_FRAGMENTS.some(fragment => lower.includes(fragment))) {
    throw new Error(`Forbidden evaluator/Toolchain artifact in ordinary workspace: ${path}`)
  }
}

function assertMediaType(value: string): asserts value is OrdinaryWorkspaceMediaType {
  if (!MEDIA_TYPES.has(value)) throw new Error(`Unsupported ordinary workspace media type: ${value}`)
}

function assertFileBounds(byteLength: number): void {
  if (!Number.isInteger(byteLength) || byteLength < 0) {
    throw new Error('Ordinary workspace file byte length must be a non-negative integer')
  }
  if (byteLength > ORDINARY_WORKSPACE_MAX_FILE_BYTES) {
    throw new Error(`Ordinary workspace file exceeds ${ORDINARY_WORKSPACE_MAX_FILE_BYTES} byte limit`)
  }
}

function assertFileCollectionBounds(files: readonly { byteLength: number }[]): void {
  if (files.length > ORDINARY_WORKSPACE_MAX_FILES) {
    throw new Error(`Ordinary workspace exceeds ${ORDINARY_WORKSPACE_MAX_FILES} file limit`)
  }
  const total = files.reduce((sum, file) => sum + file.byteLength, 0)
  if (total > ORDINARY_WORKSPACE_MAX_TOTAL_BYTES) {
    throw new Error(`Ordinary workspace aggregate payload exceeds ${ORDINARY_WORKSPACE_MAX_TOTAL_BYTES} byte limit`)
  }
}

function assertUniquePaths(files: readonly { path: string }[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.path)) throw new Error(`Duplicate ordinary workspace path: ${file.path}`)
    seen.add(file.path)
  }
}

function assertUniquePackages(packages: readonly OrdinaryWorkspacePackage[]): void {
  const seen = new Set<string>()
  for (const item of packages) {
    assertNonEmpty(item.name, 'Ordinary workspace package name')
    assertNonEmpty(item.version, 'Ordinary workspace package version')
    if (seen.has(item.name)) throw new Error(`Duplicate ordinary workspace package: ${item.name}`)
    seen.add(item.name)
  }
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLocaleLowerCase('en-US')
  const basename = lower.slice(lower.lastIndexOf('/') + 1)
  return basename.startsWith('readme') || basename.startsWith('changelog') || lower.includes('/docs/')
}

function fileProjection(file: OrdinaryWorkspaceFile): OrdinaryWorkspaceFileProjection {
  return {
    path: file.path,
    sha256: file.sha256,
    byteLength: file.byteLength,
    mediaType: file.mediaType,
  }
}

function documentationProjection(files: readonly OrdinaryWorkspaceFile[]): readonly OrdinaryWorkspaceFileProjection[] {
  return files.filter(file => isDocumentationPath(file.path)).map(fileProjection)
}

export function ordinaryWorkspaceProjection(workspace: OrdinaryWorkspace): unknown {
  return {
    schema: workspace.schema,
    fixtureVersion: workspace.fixtureVersion,
    target: workspace.target,
    inclusionPolicy: workspace.inclusionPolicy,
    packages: workspace.packages,
    files: workspace.files.map(fileProjection),
    documentationSha256: workspace.documentationSha256,
  }
}

async function hashCanonical(value: unknown, sha256: Sha256Port): Promise<string> {
  return sha256.sha256Utf8(canonicalizeEvaluationJson(value))
}

function assertTarget(target: OrdinaryWorkspaceTarget): void {
  if (target.package !== '@deepseek-ai/dsh') throw new Error('Ordinary workspace target package must be @deepseek-ai/dsh')
  if (target.version !== '0.1.1-rc.2') throw new Error('Ordinary workspace target version must be 0.1.1-rc.2')
  if (target.profile !== 'web') throw new Error('Ordinary workspace target profile must be web')
  if (!/^dsh-target-v2:[0-9a-f]{64}$/.test(target.targetFingerprint)) {
    throw new Error('Ordinary workspace target fingerprint must use dsh-target-v2')
  }
  if (!/^dsh-contract-index-v1:[0-9a-f]{64}$/.test(target.contractIndexFingerprint)) {
    throw new Error('Ordinary workspace Contract Index fingerprint must use dsh-contract-index-v1')
  }
}

export async function createOrdinaryWorkspace(
  input: OrdinaryWorkspaceInput,
  sha256: Sha256Port,
): Promise<OrdinaryWorkspace> {
  if (input.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(`Unsupported ordinary workspace fixture version: ${String(input.fixtureVersion)}`)
  }
  assertTarget(input.target)
  assertUniquePackages(input.packages)
  assertUniquePaths(input.files)

  const files: OrdinaryWorkspaceFile[] = []
  for (const file of input.files) {
    assertVirtualPath(file.path)
    assertMediaType(file.mediaType)
    const byteLength = utf8ByteLength(file.content)
    assertFileBounds(byteLength)
    files.push({
      path: file.path,
      mediaType: file.mediaType,
      content: file.content,
      byteLength,
      sha256: await sha256.sha256Utf8(file.content),
    })
  }
  assertFileCollectionBounds(files)

  const canonicalFiles = files.toSorted((left, right) => compareStrings(left.path, right.path))
  const canonicalPackages = [...input.packages]
    .toSorted((left, right) => compareStrings(left.name, right.name) || compareStrings(left.version, right.version))
  const documentationSha256 = await hashCanonical(documentationProjection(canonicalFiles), sha256)
  const workspace: OrdinaryWorkspace = {
    schema: WORKSPACE_SCHEMA,
    fixtureVersion: FIXTURE_VERSION,
    target: structuredClone(input.target),
    inclusionPolicy: INCLUSION_POLICY,
    packages: canonicalPackages.map(item => ({ ...item })),
    files: canonicalFiles,
    documentationSha256,
    workspaceSnapshotSha256: '',
  }
  workspace.workspaceSnapshotSha256 = await hashCanonical(ordinaryWorkspaceProjection(workspace), sha256)
  return workspace
}

export async function validateOrdinaryWorkspace(
  workspace: OrdinaryWorkspace,
  sha256: Sha256Port,
): Promise<void> {
  if (workspace.schema !== WORKSPACE_SCHEMA) throw new Error(`Unsupported ordinary workspace schema: ${String(workspace.schema)}`)
  if (workspace.fixtureVersion !== FIXTURE_VERSION) throw new Error(`Unsupported ordinary workspace fixture version: ${String(workspace.fixtureVersion)}`)
  if (workspace.inclusionPolicy !== INCLUSION_POLICY) {
    throw new Error(`Unsupported ordinary workspace inclusion policy: ${String(workspace.inclusionPolicy)}`)
  }
  assertTarget(workspace.target)
  assertUniquePackages(workspace.packages)
  assertUniquePaths(workspace.files)

  for (const file of workspace.files) {
    assertVirtualPath(file.path)
    assertMediaType(file.mediaType)
    const byteLength = utf8ByteLength(file.content)
    assertFileBounds(byteLength)
    if (file.byteLength !== byteLength) {
      throw new Error(`Ordinary workspace file byte length mismatch for ${file.path}`)
    }
    const digest = await sha256.sha256Utf8(file.content)
    if (file.sha256 !== digest) throw new Error(`Ordinary workspace file hash mismatch for ${file.path}`)
  }
  assertFileCollectionBounds(workspace.files)

  const expectedFiles = workspace.files.toSorted((left, right) => compareStrings(left.path, right.path))
  if (canonicalizeEvaluationJson(expectedFiles.map(fileProjection)) !== canonicalizeEvaluationJson(workspace.files.map(fileProjection))) {
    throw new Error('Ordinary workspace files must use canonical path ordering')
  }
  const expectedPackages = [...workspace.packages]
    .toSorted((left, right) => compareStrings(left.name, right.name) || compareStrings(left.version, right.version))
  if (canonicalizeEvaluationJson(expectedPackages) !== canonicalizeEvaluationJson(workspace.packages)) {
    throw new Error('Ordinary workspace packages must use canonical ordering')
  }

  const documentationSha256 = await hashCanonical(documentationProjection(workspace.files), sha256)
  if (workspace.documentationSha256 !== documentationSha256) {
    throw new Error('Ordinary workspace documentation hash mismatch')
  }
  const workspaceSnapshotSha256 = await hashCanonical(ordinaryWorkspaceProjection(workspace), sha256)
  if (workspace.workspaceSnapshotSha256 !== workspaceSnapshotSha256) {
    throw new Error('Ordinary workspace snapshot hash mismatch')
  }
}
