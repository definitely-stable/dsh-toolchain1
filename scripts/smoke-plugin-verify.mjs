#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertTreeUnchanged, snapshotTree } from './smoke-plugin-check.mjs'

export const PLUGIN_VERIFY_SMOKE_DSH_VERSION = '0.1.1-rc.2'
export const PLUGIN_VERIFY_SMOKE_PROFILE = 'headless'
export const PLUGIN_VERIFY_SMOKE_SERVICE = 'dshToolchainVerifySmokeService'

const CANDIDATE_PACKAGE = 'dsh-toolchain-verify-smoke-candidate'
const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/u
const ARTIFACT_FINGERPRINT = /^dsh-plugin-artifact-v1:[0-9a-f]{64}$/u
const CANONICAL_CHECK_IDS = Object.freeze(['structure', 'manifest', 'dependency', 'contract', 'build', 'package', 'install', 'compose', 'boot', 'visibility', 'behavior'])
const REQUIRED_RUNTIME_CHECK_IDS = Object.freeze(['package', 'install', 'compose', 'boot', 'visibility'])
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

async function createCandidate(root, env) {
  const source = join(root, 'candidate-source')
  const packed = join(root, 'candidate.tgz')
  await mkdir(source, { recursive: true })

  const pluginSource = [
    `const PLUGIN_VERIFY_SMOKE_SERVICE = ${JSON.stringify(PLUGIN_VERIFY_SMOKE_SERVICE)}`,
    'export function apply(ctx) {',
    '  ctx.provide(PLUGIN_VERIFY_SMOKE_SERVICE, Object.freeze({ ready: true }))',
    '}',
    '',
  ].join('\n')

  await Promise.all([
    writeFile(join(source, 'package.json'), `${JSON.stringify({
      name: CANDIDATE_PACKAGE,
      version: '0.0.0',
      type: 'module',
      exports: './plugin.mjs',
      files: ['plugin.mjs', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(
      join(source, 'cordis.patch.yml'),
      `- insert:\n    - id: ${CANDIDATE_PACKAGE}\n      name: '${CANDIDATE_PACKAGE}'\n`,
      { flag: 'wx' },
    ),
    writeFile(join(source, 'plugin.mjs'), pluginSource, { flag: 'wx' }),
  ])

  run('pnpm', ['pack', '--out', packed], {
    cwd: source,
    env,
    capture: true,
    timeout: 120_000,
  })

  return realpath(packed)
}

function parseResponse(stdout) {
  let response
  try {
    response = JSON.parse(stdout)
  } catch (cause) {
    throw new Error('Plugin Verify smoke: Toolchain did not emit Protocol JSON', { cause })
  }

  assert.equal(response.protocolVersion, '1', 'Plugin Verify smoke: wrong protocol version')
  assert.equal(response.status, 'ok', `Plugin Verify smoke: operation envelope failed: ${JSON.stringify(response)}`)
  assert.match(response.snapshotFingerprint ?? '', TARGET_FINGERPRINT, 'Plugin Verify smoke: target snapshot fingerprint missing')
  assert.equal(response.data?.status, 'verified', `Plugin Verify smoke: verification status=${String(response.data?.status)}`)
  assert.equal(response.data?.cleanup, 'succeeded', 'Plugin Verify smoke: disposable verification cleanup did not succeed')
  assert.match(response.data?.artifactFingerprint ?? '', ARTIFACT_FINGERPRINT, 'Plugin Verify smoke: artifact fingerprint missing')
  assert.equal(
    response.data?.targetFingerprint,
    response.snapshotFingerprint,
    'Plugin Verify smoke: report target binding differs from operation snapshot',
  )
  assert.equal(response.data?.executionPolicy, 'safe', 'Plugin Verify smoke: execution policy changed')

  const checks = response.data?.checks
  assert.ok(Array.isArray(checks), 'Plugin Verify smoke: canonical checks missing')
  assert.deepEqual(checks.map(check => check.id), CANONICAL_CHECK_IDS, 'Plugin Verify smoke: canonical check order changed')
  for (const id of REQUIRED_STATIC_CHECK_IDS) {
    assert.deepEqual(
      checks.find(check => check.id === id),
      { id, status: 'passed' },
      `Plugin Verify smoke: static ${id} did not pass`,
    )
  }
  for (const id of REQUIRED_RUNTIME_CHECK_IDS) {
    assert.deepEqual(
      checks.find(check => check.id === id),
      { id, status: 'passed' },
      `Plugin Verify smoke: runtime ${id} did not pass`,
    )
  }
  assert.deepEqual(response.data?.diagnostics, [], `Plugin Verify smoke diagnostics: ${JSON.stringify(response.data?.diagnostics)}`)

  return response
}

export async function smokePluginVerify(toolchainTarball) {
  const packedToolchain = await realpath(resolve(toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-plugin-verify-'))
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

    const candidate = await createCandidate(root, env)
    const candidateHash = createHash('sha256').update(await readFile(candidate)).digest('hex')

    run('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/dsh@${PLUGIN_VERIFY_SMOKE_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    run('pnpm', ['exec', 'dsh', '--profile', PLUGIN_VERIFY_SMOKE_PROFILE, '--dump-config'], {
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
    const profileRoot = join(home, 'profiles', PLUGIN_VERIFY_SMOKE_PROFILE)
    const before = await snapshotTree(profileRoot)

    const execution = run(process.execPath, [
      installedToolchainCli,
      'plugin', 'verify',
      '--profile', PLUGIN_VERIFY_SMOKE_PROFILE,
      '--dsh-home', home,
      '--dsh-package-root', dshPackageRoot,
      '--subject', candidate,
      '--visibility-service', PLUGIN_VERIFY_SMOKE_SERVICE,
    ], {
      capture: true,
      timeout: 720_000,
    })

    const after = await snapshotTree(profileRoot)
    assertTreeUnchanged(before, after, `DSH ${PLUGIN_VERIFY_SMOKE_DSH_VERSION} profile ${PLUGIN_VERIFY_SMOKE_PROFILE}`)

    const response = parseResponse(execution.stdout)
    assert.equal(
      response.data.artifactFingerprint,
      `dsh-plugin-artifact-v1:${candidateHash}`,
      'Plugin Verify smoke: receipt is not bound to exact candidate .tgz bytes',
    )

    process.stdout.write(
      `Plugin Verify smoke: DSH ${PLUGIN_VERIFY_SMOKE_DSH_VERSION} ${PLUGIN_VERIFY_SMOKE_PROFILE} public CLI verified exact packed candidate and live Host Service visibility in disposable worker\n`,
    )
    return response
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const toolchainTarball = process.argv[2]
  if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-plugin-verify.mjs <packed-toolchain.tgz>')
  }
  await smokePluginVerify(toolchainTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
