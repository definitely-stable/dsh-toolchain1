import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

/** Deterministic SHA-256 hex of a UTF-8 string. */
export function sha256Utf8(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Deterministic SHA-256 hex of raw bytes. */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Canonical JSON: recursively sorted object keys, no insignificant
 * whitespace. Content hashes built from this form are stable across
 * serialization orderings of the same semantic value.
 */
export function canonicalJson(value) {
  function normalize(input) {
    if (Array.isArray(input)) return input.map(normalize)
    if (input === null || typeof input !== 'object') return input
    return Object.fromEntries(
      Object.entries(input)
        .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0))
        .map(([key, child]) => [key, normalize(child)]),
    )
  }
  return JSON.stringify(normalize(value))
}

export function sha256Canonical(value) {
  return sha256Utf8(canonicalJson(value))
}

/** Throws unless the value is a non-negative safe integer. */
export function requireNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return value
}

export async function readJson(file) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (cause) {
    throw new Error(`cannot read ${file}`, { cause })
  }
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${file} is not valid JSON`, { cause })
  }
}

export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * Deterministic directory digest: relative POSIX paths sorted by Unicode
 * code point, `sha256(<path>\0<content-hash>)` per regular file, hashed
 * together. Symlinks and non-file entries are excluded by design.
 */
export async function directoryDigest(root) {
  const entries = []
  async function walk(dir) {
    const names = await readdir(dir)
    names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    for (const name of names) {
      const full = resolve(dir, name)
      const info = await stat(full)
      if (info.isDirectory()) {
        await walk(full)
      } else if (info.isFile()) {
        const rel = relative(root, full).split(sep).join('/')
        const content = await readFile(full)
        entries.push(`${rel}\u0000${sha256Bytes(content)}`)
      }
    }
  }
  await walk(resolve(root))
  return sha256Utf8(entries.join('\n'))
}
