import { readFileSync, readdirSync, statSync } from 'node:fs'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { H2_STRATA } from './h2-config.mjs'
import { buildDatasetCommitment, verifyDatasetCommitment } from './h2-commitment.mjs'
import { sha256Bytes, sha256Utf8 } from './h2-util.mjs'

export const H2_CORPUS_MANIFEST_SCHEMA = 'dsh-toolchain-h2-corpus-manifest-v1'

const FORBIDDEN_DIR_NAMES = new Set(['node_modules', '.git'])

/**
 * A path-only descriptor for one hidden task. Never carries prompt text,
 * workspace contents, reference patches, or grader source into memory; the
 * content lives on disk and is consumed only by the controller/grader.
 *
 * @typedef {object} H2TaskDescriptor
 * @property {string} taskId
 * @property {string} stratum
 * @property {string} promptPath
 * @property {string} workspaceDir
 * @property {string} referenceFixDir
 * @property {string} graderPath
 * @property {{promptSha256:string;workspaceSha256:string;referenceFixSha256:string;graderSha256:string}} contentHashes
 */

/**
 * The dataset commitment carried alongside the loaded corpus: the ordered
 * `[taskId, stratum, taskDigest]` projection and its SHA-256.
 *
 * @typedef {object} H2DatasetCommitment
 * @property {readonly {taskId: string, stratum: string, taskDigest: string}[]} projection
 * @property {string} sha256
 */

/**
 * @typedef {object} H2LoadedCorpus
 * @property {string} schema
 * @property {readonly H2TaskDescriptor[]} tasks
 * @property {H2DatasetCommitment} dataset
 */

/**
 * Authoring-time manifest builder: walks a corpus directory and writes
 * `manifest.json` with a per-task entry binding each artifact to its hash.
 * Used by the private authoring flow; the scoring loader only consumes.
 */
export async function buildCorpusManifest(corpusDir) {
  const root = resolve(corpusDir)
  const promptFiles = await sortedFileNames(join(root, 'prompts'))
  const graderFiles = await sortedFileNames(join(root, 'graders'))
  const workspaceDirs = await sortedDirNames(join(root, 'workspaces'))
  const referenceDirs = await sortedDirNames(join(root, 'reference-fixes'))

  const promptTaskIds = promptFiles.filter(name => name.endsWith('.md')).map(name => name.slice(0, -3))
  const graderTaskIds = graderFiles.filter(name => name.endsWith('.mjs')).map(name => name.slice(0, -4))
  if (JSON.stringify([...promptTaskIds].sort()) !== JSON.stringify([...graderTaskIds].sort())) {
    throw new Error('H2 corpus: prompt and grader task-id sets must match')
  }

  const tasks = []
  for (const taskId of promptTaskIds) {
    const promptPath = join(root, 'prompts', `${taskId}.md`)
    const graderPath = join(root, 'graders', `${taskId}.mjs`)
    const workspaceDir = join(root, 'workspaces', taskId)
    const referenceFixDir = join(root, 'reference-fixes', taskId)

    if (!workspaceDirs.includes(taskId)) throw new Error(`H2 corpus: missing workspace for ${taskId}`)
    if (!referenceDirs.includes(taskId)) throw new Error(`H2 corpus: missing reference-fix for ${taskId}`)

    tasks.push({
      taskId,
      stratum: inferStratumFromTaskId(taskId),
      prompt: { file: rel(root, promptPath), sha256: sha256Bytes(await readFile(promptPath)) },
      grader: { file: rel(root, graderPath), sha256: sha256Bytes(await readFile(graderPath)) },
      workspace: { dir: rel(root, workspaceDir), sha256: directoryDigestSync(workspaceDir) },
      referenceFix: { dir: rel(root, referenceFixDir), sha256: directoryDigestSync(referenceFixDir) },
    })
  }

  tasks.sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
  const manifest = { schema: H2_CORPUS_MANIFEST_SCHEMA, tasks }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

/**
 * Scoring/validation loader. Returns path-only descriptors; recomputes every
 * artifact hash against the manifest and, when expectedDatasetSha256 is
 * provided, fails closed if the recomputed commitment differs. Also refuses
 * task ids that appear in any disclosed evaluation corpus.
 *
 * @param {{corpusDir: string, expectedDatasetSha256?: string|null, disclosedRoots?: readonly string[]}} input
 * @returns {H2LoadedCorpus}
 */
export function loadH2Corpus({ corpusDir, expectedDatasetSha256, disclosedRoots = [] }) {
  const root = resolve(corpusDir)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  } catch (cause) {
    throw new Error(`H2 corpus manifest unreadable: ${cause?.message ?? cause}`, { cause })
  }
  if (!manifest || manifest.schema !== H2_CORPUS_MANIFEST_SCHEMA) throw new Error('H2 corpus manifest schema mismatch')

  const rawTasks = Array.isArray(manifest.tasks) ? manifest.tasks : []
  if (rawTasks.length === 0) throw new Error('H2 corpus is empty')
  const seen = new Set()
  for (const entry of rawTasks) {
    if (!entry || typeof entry.taskId !== 'string' || !/^[a-z0-9-]+$/.test(entry.taskId)) {
      throw new Error('H2 corpus taskId must be lowercase alphanumeric with dashes')
    }
    if (seen.has(entry.taskId)) throw new Error(`H2 corpus duplicate task id ${entry.taskId}`)
    seen.add(entry.taskId)
    if (!H2_STRATA.includes(entry.stratum)) throw new Error(`H2 corpus task has unknown stratum: ${entry.stratum}`)
  }

  const descriptors = rawTasks.map(entry => ({
    taskId: entry.taskId,
    stratum: entry.stratum,
    promptPath: join(root, 'prompts', `${entry.taskId}.md`),
    workspaceDir: join(root, 'workspaces', entry.taskId),
    referenceFixDir: join(root, 'reference-fixes', entry.taskId),
    graderPath: join(root, 'graders', `${entry.taskId}.mjs`),
    contentHashes: {
      promptSha256: entry.prompt?.sha256 ?? '',
      workspaceSha256: entry.workspace?.sha256 ?? '',
      referenceFixSha256: entry.referenceFix?.sha256 ?? '',
      graderSha256: entry.grader?.sha256 ?? '',
    },
  }))

  for (const descriptor of descriptors) verifyDescriptorHashes(descriptor)

  const tasks = descriptors.map(descriptor => ({
    taskId: descriptor.taskId,
    stratum: descriptor.stratum,
    promptSha256: descriptor.contentHashes.promptSha256,
    workspaceSha256: descriptor.contentHashes.workspaceSha256,
    referenceFixSha256: descriptor.contentHashes.referenceFixSha256,
    graderSha256: descriptor.contentHashes.graderSha256,
  }))

  if (expectedDatasetSha256 !== undefined && expectedDatasetSha256 !== null) {
    verifyDatasetCommitment({ tasks, expectedSha256: expectedDatasetSha256 })
  }

  assertNoDisclosedOverlap({ taskIds: descriptors.map(d => d.taskId), disclosedRoots })

  return Object.freeze({
    schema: H2_CORPUS_MANIFEST_SCHEMA,
    tasks: Object.freeze(descriptors),
    dataset: buildDatasetCommitment(tasks),
  })
}

function verifyDescriptorHashes(descriptor) {
  const expected = {
    prompt: descriptor.contentHashes.promptSha256,
    grader: descriptor.contentHashes.graderSha256,
    workspace: descriptor.contentHashes.workspaceSha256,
    referenceFix: descriptor.contentHashes.referenceFixSha256,
  }
  const actual = {
    prompt: sha256Bytes(readFileSync(descriptor.promptPath)),
    grader: sha256Bytes(readFileSync(descriptor.graderPath)),
    workspace: directoryDigestSync(descriptor.workspaceDir),
    referenceFix: directoryDigestSync(descriptor.referenceFixDir),
  }
  for (const key of Object.keys(expected)) {
    if (expected[key] !== actual[key]) {
      throw new Error(`H2 corpus ${key} hash mismatch for ${descriptor.taskId}`)
    }
  }
  return true
}

/** Deterministic directory digest over regular files (forbidden entries rejected). */
function directoryDigestSync(root) {
  const entries = []
  function walk(dir) {
    const names = readdirSync(dir).sort()
    for (const name of names) {
      if (FORBIDDEN_DIR_NAMES.has(name)) throw new Error(`H2 corpus forbids ${name} under ${dir}`)
      const full = join(dir, name)
      const info = statSync(full)
      if (info.isDirectory()) walk(full)
      else if (info.isFile()) {
        const rel = relative(root, full).split(sep).join('/')
        entries.push(`${rel}\u0000${sha256Bytes(readFileSync(full))}`)
      }
    }
  }
  try {
    walk(root)
  } catch (cause) {
    if (cause.code === 'ENOENT') throw new Error(`H2 corpus directory missing: ${root}`)
    throw cause
  }
  return sha256Utf8(entries.join('\n'))
}

/**
 * @param {{taskIds: readonly string[], disclosedRoots: readonly string[]}} input
 */
function assertNoDisclosedOverlap({ taskIds, disclosedRoots }) {
  if (!Array.isArray(disclosedRoots) || disclosedRoots.length === 0) return
  const hits = new Set()
  for (const root of disclosedRoots) scanDisclosed(root, taskIds, hits)
  if (hits.size > 0) throw new Error(`H2 corpus reuses disclosed task ids: ${[...hits].join(', ')}`)
}

function scanDisclosed(root, taskIds, hits) {
  let info
  try {
    info = statSync(root)
  } catch {
    return
  }
  if (info.isDirectory()) {
    for (const name of readdirSync(root)) scanDisclosed(join(root, name), taskIds, hits)
  } else if (info.isFile()) {
    let text
    try {
      text = readFileSync(root, 'utf8')
    } catch {
      return
    }
    for (const taskId of taskIds) if (text.includes(taskId)) hits.add(taskId)
  }
}

/** Stratum is encoded as the task id's segments between the h2- prefix and the numeric suffix. */
function inferStratumFromTaskId(taskId) {
  const segments = taskId.split('-')
  const candidate = segments.slice(1, -1).join('-')
  return H2_STRATA.includes(candidate) ? candidate : (segments[1] ?? '')
}

function rel(root, absolute) {
  return relative(root, absolute).split(sep).join('/')
}

async function sortedFileNames(dir) {
  return (await readdir(dir)).sort()
}

async function sortedDirNames(dir) {
  const names = await readdir(dir)
  const out = []
  for (const name of names) {
    const info = await stat(join(dir, name))
    if (info.isDirectory()) out.push(name)
  }
  return out.sort()
}