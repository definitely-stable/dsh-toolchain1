import { readdir, readFile, realpath } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

const VIRTUAL_ROOT = '/exact-target/node_modules/'
const MAX_FILES = 10_000
const MAX_FILE_BYTES = 512 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const DECLARATION_PATTERN = /\.d\.(?:ts|mts|cts)$/u
const FORBIDDEN_FRAGMENTS = [
  '/docs/evaluation/m2/',
  '/api-oracle-v1.json',
  '/agent-holdout-h1.commitment.json',
  '/agent-pilot-p0.json',
  '/contract-facts.json',
  '/target-facts.json',
  '/ordinary-workspace.json',
]
const VCS_SEGMENTS = new Set(['.git', '.hg', '.svn'])
const decoder = new TextDecoder('utf-8', { fatal: true })

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function assertPackageIdentity(name, version) {
  if (typeof name !== 'string' || !/^(?:@[^/]+\/)?[^/]+$/u.test(name) || name.includes('..') || name.includes('\\')) {
    throw new Error(`Invalid ordinary evidence package name: ${String(name)}`)
  }
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error(`Invalid ordinary evidence package version for ${name}`)
  }
}

function forbiddenPath(relativePath) {
  const normalized = `/${relativePath.replaceAll('\\', '/')}`.toLocaleLowerCase('en-US')
  const segments = normalized.split('/').filter(Boolean)
  const file = basename(normalized)
  if (segments.some(segment => VCS_SEGMENTS.has(segment))) return true
  if (file === '.env' || file.startsWith('.env.')) return true
  if (file.includes('credential') || file.includes('secret')) return true
  return FORBIDDEN_FRAGMENTS.some(fragment => normalized.includes(fragment))
}

async function canonicalRelativePath(canonicalRoot, location) {
  const canonicalLocation = await realpath(location)
  const path = relative(canonicalRoot, canonicalLocation)
  if (path === '' || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error(`Ordinary evidence path escapes canonical package root: ${location}`)
  }
  return { canonicalLocation, relativePath: path.split(sep).join('/') }
}

async function readUtf8Candidate(location, required) {
  const bytes = await readFile(location)
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`Ordinary evidence file exceeds ${MAX_FILE_BYTES} byte limit: ${location}`)
  }
  try {
    decoder.decode(bytes)
  } catch (error) {
    if (required) throw new Error(`Required ordinary evidence is not valid UTF-8: ${location}`, { cause: error })
    return undefined
  }
  const content = bytes.toString('utf8')
  if (content.includes('\0')) {
    if (required) throw new Error(`Required ordinary evidence contains NUL bytes: ${location}`)
    return undefined
  }
  return content
}

async function collectRootDocs(packageRoot) {
  const result = []
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLocaleLowerCase('en-US')
    if (lower.startsWith('readme') || lower.startsWith('changelog')) result.push(join(packageRoot, entry.name))
  }
  return result
}

async function collectDocs(directory) {
  const result = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return result
    throw error
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const location = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!VCS_SEGMENTS.has(entry.name.toLocaleLowerCase('en-US'))) result.push(...await collectDocs(location))
    } else if (entry.isFile()) {
      result.push(location)
    }
  }
  return result
}

export async function captureConventionalPackageFiles(input) {
  assertPackageIdentity(input.name, input.version)
  const canonicalRoot = await realpath(input.packageRoot)
  const manifestLocation = join(canonicalRoot, 'package.json')
  const manifestContent = await readUtf8Candidate(manifestLocation, true)
  const manifest = JSON.parse(manifestContent)
  if (manifest?.name !== input.name || manifest?.version !== input.version) {
    throw new Error(`Ordinary evidence manifest identity mismatch for ${input.name}@${input.version}`)
  }

  const candidates = new Map()
  candidates.set(manifestLocation, { mediaType: 'application/json', required: true })
  for (const location of input.declarationLocations ?? []) {
    if (!DECLARATION_PATTERN.test(location)) throw new Error(`Ordinary declaration is not a .d.ts family file: ${location}`)
    candidates.set(location, { mediaType: 'text/typescript', required: true })
  }
  for (const location of await collectRootDocs(canonicalRoot)) {
    candidates.set(location, { mediaType: 'text/plain', required: false })
  }
  for (const location of await collectDocs(join(canonicalRoot, 'docs'))) {
    candidates.set(location, { mediaType: 'text/plain', required: false })
  }

  const files = []
  for (const [location, policy] of candidates) {
    const { canonicalLocation, relativePath } = await canonicalRelativePath(canonicalRoot, location)
    if (forbiddenPath(relativePath)) {
      if (policy.required) throw new Error(`Required ordinary evidence path is forbidden: ${relativePath}`)
      continue
    }
    const content = await readUtf8Candidate(canonicalLocation, policy.required)
    if (content === undefined) continue
    files.push({
      path: `${VIRTUAL_ROOT}${input.name}/${relativePath}`,
      mediaType: policy.mediaType,
      content,
    })
  }

  const canonicalFiles = files.toSorted((left, right) => compare(left.path, right.path))
  if (canonicalFiles.length > MAX_FILES) throw new Error(`Ordinary workspace exceeds ${MAX_FILES} file limit`)
  const totalBytes = canonicalFiles.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Ordinary workspace exceeds ${MAX_TOTAL_BYTES} aggregate byte limit`)
  return canonicalFiles
}
