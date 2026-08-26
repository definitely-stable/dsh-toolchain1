#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const REQUIRED_FILES = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/integrations/dsh/index.js',
  'package/lib/integrations/dsh/index.d.ts',
  'package/lib/protocol/index.js',
  'package/lib/protocol/index.d.ts',
  'package/lib/frontends/cli/bin.js',
  'package/lib/frontends/mcp/bin.js',
  'package/spec/schemas/v1/toolchain-protocol.schema.json',
]

const FORBIDDEN_PREFIXES = [
  'package/src/',
  'package/tests/',
  'package/.github/',
  'package/scripts/',
  'package/docs/',
]

function forbiddenPath(path) {
  if (FORBIDDEN_PREFIXES.some(prefix => path.startsWith(prefix))) return true
  return path.startsWith('package/spec/') && !path.startsWith('package/spec/schemas/v1/')
}

export function checkPackFileList(files) {
  const fileSet = new Set(files)
  const issues = []

  for (const path of REQUIRED_FILES) {
    if (!fileSet.has(path)) {
      issues.push({
        rule: 'required-pack-file',
        path,
        message: 'required packed file is missing',
      })
    }
  }

  for (const path of files) {
    if (forbiddenPath(path)) {
      issues.push({
        rule: 'forbidden-pack-path',
        path,
        message: 'private or source-only material must not ship in the package',
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

export function listTarFiles(tarballBytes) {
  const tar = gunzipSync(tarballBytes)
  const files = []
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break

    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = readOctal(header, 124, 12)
    const type = readString(header, 156, 1)

    if (type === '' || type === '0') files.push(path)

    const paddedSize = Math.ceil(size / 512) * 512
    offset += 512 + paddedSize
  }

  return files
}

export async function checkPackedTarball(tarballPath) {
  const bytes = await readFile(tarballPath)
  const files = listTarFiles(bytes)
  return { files, issues: checkPackFileList(files) }
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
      process.stderr.write(`[${issue.rule}] ${issue.path}: ${issue.message}\n`)
    }
    process.exitCode = 1
    return
  }

  process.stdout.write(`pack policy: ${files.length} files verified\n`)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
