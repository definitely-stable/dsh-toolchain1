#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const REQUIRED_POLICY_FILES = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/spec/schemas/v1/toolchain-protocol.schema.json',
  'package/skills/dsh-toolchain/SKILL.md',
]

const FORBIDDEN_PREFIXES = [
  'package/src/',
  'package/tests/',
  'package/.github/',
  'package/scripts/',
  'package/docs/',
]

function forbiddenPath(value) {
  if (FORBIDDEN_PREFIXES.some(prefix => value.startsWith(prefix))) return true
  return value.startsWith('package/spec/') && !value.startsWith('package/spec/schemas/v1/')
}

export function checkPackFileList(files) {
  const fileSet = new Set(files)
  const issues = []

  for (const requiredPath of REQUIRED_POLICY_FILES) {
    if (!fileSet.has(requiredPath)) {
      issues.push({
        rule: 'required-pack-file',
        path: requiredPath,
        message: 'required packed file is missing',
      })
    }
  }

  for (const file of files) {
    if (forbiddenPath(file)) {
      issues.push({
        rule: 'forbidden-pack-path',
        path: file,
        message: 'private or source-only material must not ship in the package',
      })
    }
  }

  return issues
}

function addManifestTarget(targets, source, value) {
  if (typeof value === 'string') targets.push({ source, target: value })
}

function addExportTargets(targets, value) {
  if (typeof value === 'string') {
    addManifestTarget(targets, 'exports', value)
    return
  }
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) addExportTargets(targets, item)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) addExportTargets(targets, item)
  }
}

export function collectPackedManifestTargets(manifest) {
  const targets = []

  addManifestTarget(targets, 'main', manifest?.main)
  addManifestTarget(targets, 'types', manifest?.types)
  addExportTargets(targets, manifest?.exports)

  if (typeof manifest?.bin === 'string') {
    addManifestTarget(targets, 'bin', manifest.bin)
  } else if (manifest?.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)) {
    for (const value of Object.values(manifest.bin)) addManifestTarget(targets, 'bin', value)
  }

  addManifestTarget(targets, 'dsh.bundle.patch', manifest?.dsh?.bundle?.patch)
  return targets
}

function resolveConcretePackageTarget(target) {
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.includes('\\') ||
    target.includes('*') ||
    path.posix.isAbsolute(target)
  ) {
    return undefined
  }

  const withoutDot = target.startsWith('./') ? target.slice(2) : target
  const normalized = path.posix.normalize(withoutDot)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    return undefined
  }

  return `package/${normalized}`
}

export function checkPackedManifest(manifest, files) {
  const fileSet = new Set(files)
  const issues = []

  for (const { source, target } of collectPackedManifestTargets(manifest)) {
    const packedPath = resolveConcretePackageTarget(target)
    if (!packedPath) {
      issues.push({
        rule: 'manifest-target-unsafe',
        path: target,
        source,
        message: 'packed manifest target must resolve to one concrete file inside the package',
      })
      continue
    }

    if (!fileSet.has(packedPath)) {
      issues.push({
        rule: 'manifest-target-missing',
        path: packedPath,
        source,
        message: 'packed manifest target does not exist in the tarball',
      })
    }
  }

  return issues
}

function readString(block, start, length) {
  const raw = block.subarray(start, start + length)
  const zero = raw.indexOf(0)
  return raw.subarray(0, zero === -1 ? raw.length : zero).toString('utf8')
}

function readOctal(block, start, length) {
  const value = readString(block, start, length).trim().replaceAll('\0', '')
  return value === '' ? 0 : Number.parseInt(value, 8)
}

export function readTarEntries(tarballBytes) {
  const tar = gunzipSync(tarballBytes)
  const entries = new Map()
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break

    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const entryPath = prefix ? `${prefix}/${name}` : name
    const size = readOctal(header, 124, 12)
    const type = readString(header, 156, 1)
    const contentStart = offset + 512
    const contentEnd = contentStart + size

    if (type === '' || type === '0') {
      entries.set(entryPath, tar.subarray(contentStart, contentEnd))
    }

    const paddedSize = Math.ceil(size / 512) * 512
    offset = contentStart + paddedSize
  }

  return entries
}

export function listTarFiles(tarballBytes) {
  return [...readTarEntries(tarballBytes).keys()]
}

export async function checkPackedTarball(tarballPath) {
  const bytes = await readFile(tarballPath)
  const entries = readTarEntries(bytes)
  const files = [...entries.keys()]
  const issues = checkPackFileList(files)
  const manifestBytes = entries.get('package/package.json')

  if (manifestBytes) {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      issues.push(...checkPackedManifest(manifest, files))
    } catch (error) {
      issues.push({
        rule: 'manifest-invalid',
        path: 'package/package.json',
        message: `packed package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return { files, issues }
}

async function main() {
  const tarballPath = process.argv[2]
  if (!tarballPath) {
    process.stderr.write('usage: node scripts/check-pack.mjs <package.tgz>\n')
    process.exitCode = 2
    return
  }

  const { files, issues } = await checkPackedTarball(tarballPath)
  if (issues.length > 0) {
    for (const issue of issues) {
      const sourceValue = Reflect.get(issue, 'source')
      const source = typeof sourceValue === 'string' ? ` (${sourceValue})` : ''
      process.stderr.write(`[${issue.rule}] ${issue.path}${source}: ${issue.message}\n`)
    }
    process.exitCode = 1
    return
  }

  process.stdout.write(`pack policy: ${files.length} files verified against packed manifest\n`)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
