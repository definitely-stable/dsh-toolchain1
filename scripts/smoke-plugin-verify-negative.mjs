#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertTreeUnchanged, snapshotTree } from './smoke-plugin-check.mjs'

export const PLUGIN_VERIFY_NEGATIVE_SMOKE_DSH_VERSION = '0.1.2-rc.1'
export const PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE = 'headless'

const PACKED_RUNTIME_BROKEN_PACKAGE = 'dsh-toolchain-verify-packed-runtime-broken'
const VISIBILITY_BROKEN_PACKAGE = 'dsh-toolchain-verify-visibility-broken'
const MISSING_SERVICE = 'dshToolchainVerifyIntentionallyMissingService'
const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/u
const LIFECYCLE_FINGERPRINT = /^dsh-profile-lifecycle-v1:[0-9a-f]{64}$/u
const ARTIFACT_FINGERPRINT = /^dsh-plugin-artifact-v1:[0-9a-f]{64}$/u
const CANONICAL_CHECK_IDS = Object.freeze([
  'structure',
  'manifest',
  'dependency',
  'contract',
  'build',
  'package',
  'install',
  'compose',
  'boot',
  'visibility',
  'behavior',
])
const REQUIRED_STATIC_CHECK_IDS = Object.freeze(['structure', 'manifest', 'dependency', 'contract'])

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
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}${detail ? `\n${detail}` : ''}`)
  }

  return Object.freeze({
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
  })
}

async function packCandidate(root, env, options) {
  const source = join(root, options.directory)
  const packed = join(root, `${options.directory}.tgz`)
  await mkdir(source, { recursive: true })

  await Promise.all([
    writeFile(join(source, 'package.json'), `${JSON.stringify({
      name: options.packageName,
      version: '0.0.0',
      type: 'module',
      exports: './plugin.mjs',
      files: options.files,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(
      join(source, 'cordis.patch.yml'),
      `- insert:\n    - id: ${options.packageName}\n      name: '${options.packageName}'\n`,
      { flag: 'wx' },
    ),
    writeFile(join(source, 'plugin.mjs'), options.pluginSource, { flag: 'wx' }),
  ])

  run('pnpm', ['pack', '--out', packed], {
    cwd: source,
    env,
    capture: true,
    timeout: 120_000,
  })
  return realpath(packed)
}

async function createPackedRuntimeBrokenCandidate(root, env) {
  return packCandidate(root, env, {
    directory: 'packed-runtime-broken',
    packageName: PACKED_RUNTIME_BROKEN_PACKAGE,
    // Source contains the declared runtime module, but the distributable
    // intentionally omits it while retaining package.json and bundle patch.
    files: ['cordis.patch.yml'],
    pluginSource: 'export function apply() {}\n',
  })
}

async function createVisibilityBrokenCandidate(root, env) {
  return packCandidate(root, env, {
    directory: 'visibility-broken',
    packageName: VISIBILITY_BROKEN_PACKAGE,
    files: ['plugin.mjs', 'cordis.patch.yml'],
    pluginSource: 'export function apply() {}\n',
  })
}

function parseFailedResponse(stdout, candidate, label) {
  let response
  try {
    response = JSON.parse(stdout)
  } catch (cause) {
    throw new Error(`${label}: Toolchain did not emit Protocol JSON`, { cause })
  }

  assert.equal(response.protocolVersion, '1', `${label}: wrong protocol version`)
  assert.equal(response.status, 'ok', `${label}: verification failure escaped the semantic operation envelope`)
  assert.match(response.snapshotFingerprint ?? '', TARGET_FINGERPRINT, `${label}: target snapshot fingerprint missing`)
  assert.equal(response.data?.status, 'failed', `${label}: final verification status is not failed`)
  assert.equal(response.data?.cleanup, 'succeeded', `${label}: disposable verification cleanup did not succeed`)
  assert.match(response.data?.artifactFingerprint ?? '', ARTIFACT_FINGERPRINT, `${label}: artifact fingerprint missing`)
  assert.match(response.data?.lifecycleFingerprint ?? '', LIFECYCLE_FINGERPRINT, `${label}: lifecycle fingerprint missing`)
  assert.equal(
    response.data?.targetFingerprint,
    response.snapshotFingerprint,
    `${label}: receipt target binding differs from operation snapshot`,
  )
  assert.equal(response.data?.executionPolicy, 'safe', `${label}: execution policy changed`)
  assert.equal(
    response.data?.artifactFingerprint,
    `dsh-plugin-artifact-v1:${createHash('sha256').update(candidate).digest('hex')}`,
    `${label}: receipt is not bound to exact candidate .tgz bytes`,
  )

  const checks = response.data?.checks
  assert.ok(Array.isArray(checks), `${label}: canonical checks missing`)
  assert.deepEqual(checks.map(item => item.id), CANONICAL_CHECK_IDS, `${label}: canonical check order changed`)
  for (const id of REQUIRED_STATIC_CHECK_IDS) {
    assert.deepEqual(
      checks.find(item => item.id === id),
      { id, status: 'passed' },
      `${label}: static ${id} did not pass`,
    )
  }

  return response
}

function verificationCheck(response, id) {
  return response.data.checks.find(candidate => candidate.id === id)
}

function diagnosticCodes(response) {
  return new Set((response.data?.diagnostics ?? []).map(item => item.code))
}

async function executeFailedVerification(options) {
  const before = await snapshotTree(options.profileRoot)
  const args = [
    options.installedToolchainCli,
    'plugin', 'verify',
    '--profile', PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE,
    '--dsh-home', options.home,
    '--dsh-package-root', options.dshPackageRoot,
    '--subject', options.candidatePath,
    ...(options.visibilityService === undefined
      ? []
      : ['--visibility-service', options.visibilityService]),
  ]
  const execution = run(process.execPath, args, {
    capture: true,
    allowedStatuses: [1],
    timeout: 720_000,
  })
  const after = await snapshotTree(options.profileRoot)
  assertTreeUnchanged(before, after, options.label)

  const bytes = await readFile(options.candidatePath)
  return parseFailedResponse(execution.stdout, bytes, options.label)
}

export async function smokePluginVerifyNegative(toolchainTarball) {
  const packedToolchain = await realpath(resolve(toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-plugin-verify-negative-'))
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
    await writeFile(join(runner, 'package.json'), '{"private":true}\n', { flag: 'wx' })

    const packedRuntimeBroken = await createPackedRuntimeBrokenCandidate(root, env)
    const visibilityBroken = await createVisibilityBrokenCandidate(root, env)

    run('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/dsh@${PLUGIN_VERIFY_NEGATIVE_SMOKE_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    run('pnpm', ['exec', 'dsh', '--profile', PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE, '--dump-config'], {
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
    const profileRoot = join(home, 'profiles', PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE)

    const packageBroken = await executeFailedVerification({
      installedToolchainCli,
      dshPackageRoot,
      home,
      profileRoot,
      candidatePath: packedRuntimeBroken,
      label: 'packed-runtime-broken',
    })
    assert.deepEqual(verificationCheck(packageBroken, 'package'), {
      id: 'package',
      status: 'failed',
      reason: 'verify-package-entrypoint-missing',
    })
    for (const id of ['install', 'compose', 'boot', 'visibility']) {
      assert.deepEqual(verificationCheck(packageBroken, id), {
        id,
        status: 'skipped',
        reason: 'prerequisite-package-failed',
      })
    }
    assert.ok(
      diagnosticCodes(packageBroken).has('VERIFY_PACKAGE_ENTRYPOINT_MISSING'),
      'packed-runtime-broken: VERIFY_PACKAGE_ENTRYPOINT_MISSING missing',
    )

    const visibilityFailed = await executeFailedVerification({
      installedToolchainCli,
      dshPackageRoot,
      home,
      profileRoot,
      candidatePath: visibilityBroken,
      visibilityService: MISSING_SERVICE,
      label: 'visibility-broken',
    })
    assert.deepEqual(verificationCheck(visibilityFailed, 'package'), { id: 'package', status: 'passed' })
    assert.deepEqual(verificationCheck(visibilityFailed, 'install'), { id: 'install', status: 'passed' })
    assert.deepEqual(verificationCheck(visibilityFailed, 'compose'), { id: 'compose', status: 'passed' })
    assert.deepEqual(verificationCheck(visibilityFailed, 'boot'), { id: 'boot', status: 'passed' })
    assert.deepEqual(verificationCheck(visibilityFailed, 'visibility'), {
      id: 'visibility',
      status: 'failed',
      reason: 'verify-visibility-failed',
    })
    assert.ok(
      diagnosticCodes(visibilityFailed).has('VERIFY_VISIBILITY_FAILED'),
      'visibility-broken: VERIFY_VISIBILITY_FAILED missing',
    )

    process.stdout.write(
      `Plugin Verify negative smoke: DSH ${PLUGIN_VERIFY_NEGATIVE_SMOKE_DSH_VERSION} ${PLUGIN_VERIFY_NEGATIVE_SMOKE_PROFILE} proved packed-entrypoint and visibility failures through the installed public CLI\n`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const toolchainTarball = process.argv[2]
  if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-plugin-verify-negative.mjs <packed-toolchain.tgz>')
  }
  await smokePluginVerifyNegative(toolchainTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
