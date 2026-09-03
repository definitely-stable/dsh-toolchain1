#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PLUGIN_CHECK_SMOKE_DSH_VERSION = '0.1.1-rc.2'
export const PLUGIN_CHECK_SMOKE_PROFILE = 'headless'

const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/
const CONTRACT_INDEX_FINGERPRINT = /^dsh-contract-index-v1:[0-9a-f]{64}$/
const SUBJECT_FINGERPRINT = /^dsh-plugin-subject-v1:[0-9a-f]{64}$/
const EXPECTED_SUBJECT_EVIDENCE = Object.freeze([
  'plugin:packed-artifact',
  'plugin:manifest',
  'plugin:bundle-patch',
])

function run(command, args, options = {}) {
  const allowedStatuses = options.allowedStatuses ?? [0]
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    cwd: options.cwd,
    env: options.env,
  })

  if (result.error) throw result.error
  if (!allowedStatuses.includes(result.status)) {
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const detail = [stdout, stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }

  return Object.freeze({
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
  })
}

export async function snapshotTree(root) {
  const snapshot = {}

  async function visit(directory) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }

    for (const entry of entries.toSorted((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      const absolute = join(directory, entry.name)
      const key = relative(root, absolute).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        snapshot[`${key}/`] = 'directory'
        await visit(absolute)
      } else if (entry.isSymbolicLink()) {
        snapshot[key] = `symlink:${await readlink(absolute)}`
      } else {
        snapshot[key] = `file:${(await readFile(absolute)).toString('base64')}`
      }
    }
  }

  await visit(root)
  return snapshot
}

export function assertTreeUnchanged(before, after, label) {
  assert.deepEqual(after, before, `${label} changed during plugin.check`)
}

function parsePluginCheck(stdout) {
  let response
  try {
    response = JSON.parse(stdout)
  } catch (error) {
    throw new Error('Plugin Check smoke: Toolchain did not emit JSON', { cause: error })
  }

  assert.equal(response.protocolVersion, '1', 'Plugin Check smoke: wrong protocol version')
  assert.equal(response.status, 'ok', 'Plugin Check smoke: application response failed')
  assert.match(response.snapshotFingerprint, TARGET_FINGERPRINT, 'Plugin Check smoke: invalid target fingerprint')
  assert.match(response.data?.contractIndexFingerprint, CONTRACT_INDEX_FINGERPRINT, 'Plugin Check smoke: invalid contract index fingerprint')
  assert.match(response.data?.subjectFingerprint, SUBJECT_FINGERPRINT, 'Plugin Check smoke: invalid subject fingerprint')
  assert.equal(response.data?.candidateCodeExecuted, false, 'Plugin Check smoke: static check must not execute candidate code')
  assert.equal(response.data?.scopeComplete, false, 'Plugin Check smoke: alpha static scope must remain explicitly partial')
  if (response.data?.subjectCompleteness !== 'complete') {
    throw new Error(`Plugin Check smoke: packed Toolchain subject is ${String(response.data?.subjectCompleteness)}`)
  }

  assert.ok(
    ['compatible-in-scope', 'incompatible', 'unproven'].includes(response.data?.verdict),
    `Plugin Check smoke: unexpected verdict ${String(response.data?.verdict)}`,
  )

  const evidenceIds = new Set((response.data?.evidence ?? []).map(item => item?.id))
  for (const expected of EXPECTED_SUBJECT_EVIDENCE) {
    assert.ok(evidenceIds.has(expected), `Plugin Check smoke: missing ${expected} evidence`)
  }

  return response
}

export async function smokePluginCheck(toolchainTarball) {
  const packedToolchain = await realpath(resolve(toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-plugin-check-'))
  const runner = join(root, 'runner')
  const home = join(root, 'dsh-home')
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    DSH_HOME: home,
  }

  try {
    await mkdir(runner, { recursive: true })
    await writeFile(join(runner, 'package.json'), '{"private":true}\n')
    run('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/dsh@${PLUGIN_CHECK_SMOKE_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    run('pnpm', ['exec', 'dsh', '--profile', PLUGIN_CHECK_SMOKE_PROFILE, '--dump-config'], {
      cwd: runner,
      env,
      capture: true,
      timeout: 180_000,
    })

    const installedToolchainCli = resolve(
      runner,
      'node_modules',
      'dsh-toolchain',
      'lib',
      'frontends',
      'cli',
      'bin.js',
    )
    const dshPackageRoot = await realpath(resolve(runner, 'node_modules', '@deepseek-ai', 'dsh'))
    const profileRoot = join(home, 'profiles', PLUGIN_CHECK_SMOKE_PROFILE)
    const before = await snapshotTree(profileRoot)

    // Exit 1 is a valid machine-facing result for semantic incompatible/unproven.
    // The alpha reducer intentionally does not pretend to prove arbitrary semver ranges.
    const execution = run(process.execPath, [
      installedToolchainCli,
      'plugin', 'check',
      '--profile', PLUGIN_CHECK_SMOKE_PROFILE,
      '--dsh-home', home,
      '--dsh-package-root', dshPackageRoot,
      '--subject', packedToolchain,
    ], {
      capture: true,
      allowedStatuses: [0, 1],
      timeout: 180_000,
    })

    const after = await snapshotTree(profileRoot)
    assertTreeUnchanged(before, after, `DSH ${PLUGIN_CHECK_SMOKE_DSH_VERSION} profile ${PLUGIN_CHECK_SMOKE_PROFILE}`)
    const response = parsePluginCheck(execution.stdout)

    process.stdout.write(
      `Plugin Check smoke: DSH ${PLUGIN_CHECK_SMOKE_DSH_VERSION} ${PLUGIN_CHECK_SMOKE_PROFILE} ${response.data.verdict} packed/read-only/static\n`,
    )
    return response
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const toolchainTarball = process.argv[2]
  if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-plugin-check.mjs <packed-toolchain.tgz>')
  }
  await smokePluginCheck(toolchainTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
