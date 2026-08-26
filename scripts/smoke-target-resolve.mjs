#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TARGET_SMOKE_DSH_VERSIONS = Object.freeze([
  '0.1.1-rc.2',
  '0.1.0-rc.8',
])
export const TARGET_SMOKE_PROFILE = 'headless'

const TOOLCHAIN_CLI = fileURLToPath(new URL('../lib/frontends/cli/bin.js', import.meta.url))
const TARGET_FINGERPRINT = /^dsh-target-v1:[0-9a-f]{64}$/

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    cwd: options.cwd,
    env: options.env,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const detail = [stdout, stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }

  return typeof result.stdout === 'string' ? result.stdout : ''
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
  assert.deepEqual(after, before, `${label} changed during target resolution`)
}

async function copyTree(source, destination) {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })

  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to)
    } else if (entry.isSymbolicLink()) {
      await mkdir(dirname(to), { recursive: true })
      await symlink(await readlink(from), to)
    } else {
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to)
    }
  }
}

function parseTargetResponse(stdout, version) {
  let response
  try {
    response = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`Target smoke ${version}: Toolchain did not emit JSON`, { cause: error })
  }

  assert.equal(response.protocolVersion, '1', `Target smoke ${version}: wrong protocol version`)
  assert.equal(response.status, 'ok', `Target smoke ${version}: target resolve failed`)
  assert.match(response.snapshotFingerprint, TARGET_FINGERPRINT, `Target smoke ${version}: invalid fingerprint`)
  assert.equal(response.data?.snapshot?.fingerprint, response.snapshotFingerprint)
  assert.equal(response.data?.snapshot?.dsh?.name, '@deepseek-ai/dsh')
  assert.equal(response.data?.snapshot?.dsh?.version, version)
  assert.equal(response.data?.snapshot?.profile?.name, TARGET_SMOKE_PROFILE)
  return response
}

async function resolveReadOnlyTarget({ version, home, dshPackageRoot }) {
  const profileRoot = join(home, 'profiles', TARGET_SMOKE_PROFILE)
  const before = await snapshotTree(profileRoot)
  const stdout = run(process.execPath, [
    TOOLCHAIN_CLI,
    'target', 'resolve',
    '--profile', TARGET_SMOKE_PROFILE,
    '--dsh-home', home,
    '--dsh-package-root', dshPackageRoot,
  ], { capture: true, timeout: 120_000 })
  const after = await snapshotTree(profileRoot)
  assertTreeUnchanged(before, after, `DSH ${version} profile ${TARGET_SMOKE_PROFILE}`)
  return parseTargetResponse(stdout, version)
}

async function smokeTrain(version) {
  const root = await mkdtemp(join(tmpdir(), `dsh-toolchain-target-${version}-`))
  const runner = join(root, 'runner')
  const firstHome = join(root, 'home-a')
  const secondHome = join(root, 'home-b')
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    DSH_HOME: firstHome,
  }

  try {
    await mkdir(runner, { recursive: true })
    await writeFile(join(runner, 'package.json'), '{"private":true}\n')
    run('pnpm', ['add', '--save-exact', '--ignore-scripts', `@deepseek-ai/dsh@${version}`], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    // Shipped profiles are initialized by DSH itself. Toolchain only observes the resulting target.
    run('pnpm', ['exec', 'dsh', '--profile', TARGET_SMOKE_PROFILE, '--dump-config'], {
      cwd: runner,
      env,
      capture: true,
      timeout: 180_000,
    })

    const dshPackageRoot = resolve(runner, 'node_modules', '@deepseek-ai', 'dsh')
    const first = await resolveReadOnlyTarget({ version, home: firstHome, dshPackageRoot })

    const sourceProfile = join(firstHome, 'profiles', TARGET_SMOKE_PROFILE)
    const copiedProfile = join(secondHome, 'profiles', TARGET_SMOKE_PROFILE)
    await copyTree(sourceProfile, copiedProfile)
    const second = await resolveReadOnlyTarget({ version, home: secondHome, dshPackageRoot })

    assert.equal(
      second.snapshotFingerprint,
      first.snapshotFingerprint,
      `DSH ${version}: equivalent targets in different homes produced different fingerprints`,
    )

    process.stdout.write(
      `Target smoke: DSH ${version} ${TARGET_SMOKE_PROFILE} ${first.snapshotFingerprint} read-only/path-stable\n`,
    )
    return first.snapshotFingerprint
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export async function smokeTargetResolution() {
  const fingerprints = []
  for (const version of TARGET_SMOKE_DSH_VERSIONS) fingerprints.push(await smokeTrain(version))
  assert.equal(new Set(fingerprints).size, TARGET_SMOKE_DSH_VERSIONS.length, 'Different DSH trains must not share one target fingerprint')
}

async function main() {
  await smokeTargetResolution()
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
