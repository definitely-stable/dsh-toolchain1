#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createDshFilesystemTargetAcquisition } from '../lib/acquisition/dsh-filesystem.js'
import { createNodeSha256Port } from '../lib/acquisition/node-sha256.js'
import { acquirePluginPackedWithArtifact } from '../lib/acquisition/plugin-packed-artifact.js'
import { createApplicationKernel } from '../lib/kernel/index.js'
import { runPackedPluginVerification } from '../lib/verification/packed-worker.js'

const DSH_VERSION = '0.1.1-rc.2'
const PROFILE = 'web'
const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/u
const ARTIFACT_FINGERPRINT = /^dsh-plugin-artifact-v1:[0-9a-f]{64}$/u

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
    const detail = [result.stdout, result.stderr]
      .filter(value => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}${detail ? `\n${detail}` : ''}`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

async function snapshotSentinel(location) {
  const [content, metadata] = await Promise.all([
    readFile(location),
    stat(location),
  ])
  return Object.freeze({
    content: content.toString('base64'),
    size: metadata.size,
    mode: metadata.mode,
    mtimeMs: metadata.mtimeMs,
  })
}

async function pathExists(location) {
  try {
    await stat(location)
    return true
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return false
    throw cause
  }
}

function checkFor(execution, id) {
  return execution.checks.find(check => check.id === id)
}

export async function smokeVerificationWorker(candidateTarball) {
  const candidatePath = await realpath(resolve(candidateTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-verification-worker-smoke-'))
  const baselineRunner = join(root, 'baseline-runner')
  const baselineHome = join(root, 'baseline-dsh-home')
  const sentinelRoot = join(root, 'active-sentinel')
  const sentinelFile = join(sentinelRoot, 'must-not-change.txt')
  const workerRoot = join(root, 'worker')
  const digest = createNodeSha256Port()

  try {
    const acquired = await acquirePluginPackedWithArtifact(candidatePath, digest)
    assert.equal(acquired.subject.completeness, 'complete', 'verification worker smoke: packed candidate acquisition is incomplete')
    assert.ok(acquired.artifact, 'verification worker smoke: authoritative executable artifact handoff missing')

    await Promise.all([
      mkdir(baselineRunner, { recursive: true }),
      mkdir(sentinelRoot, { recursive: true }),
    ])
    await writeFile(join(baselineRunner, 'package.json'), '{"private":true}\n')
    await writeFile(sentinelFile, 'active-profile-sentinel-v1\n', { flag: 'wx' })

    const baselineEnv = {
      ...process.env,
      CI: 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      DSH_HOME: baselineHome,
    }
    run('pnpm', ['add', '--save-exact', '--ignore-scripts', `@deepseek-ai/dsh@${DSH_VERSION}`], {
      cwd: baselineRunner,
      env: baselineEnv,
      timeout: 480_000,
    })
    run('pnpm', ['exec', 'dsh', '--profile', PROFILE, '--dump-config'], {
      cwd: baselineRunner,
      env: baselineEnv,
      capture: true,
      timeout: 180_000,
    })

    const dshPackageRoot = await realpath(join(baselineRunner, 'node_modules', '@deepseek-ai', 'dsh'))
    const targetRequest = {
      profile: PROFILE,
      dshHome: baselineHome,
      dshPackageRoot,
    }
    const targetAcquisition = createDshFilesystemTargetAcquisition({
      env: baselineEnv,
      digest,
    })
    const kernel = createApplicationKernel({
      targetAcquisition,
      digest,
      now: () => '2026-09-06T00:00:00.000Z',
    })
    const { snapshot } = await kernel.resolveTarget(targetRequest)

    assert.match(snapshot.fingerprint, TARGET_FINGERPRINT, 'verification worker smoke: production target fingerprint missing')
    assert.equal(snapshot.dsh.version, DSH_VERSION, 'verification worker smoke: wrong DSH target version')
    assert.equal(snapshot.profile.name, PROFILE, 'verification worker smoke: wrong DSH target profile')

    const sentinelBefore = await snapshotSentinel(sentinelFile)
    const execution = await runPackedPluginVerification({
      artifact: {
        path: acquired.artifact.location,
        expectedContentHash: acquired.artifact.contentHash,
      },
      target: snapshot,
      executionPolicy: 'safe',
    }, {
      parentEnv: {
        PATH: process.env.PATH,
        Path: process.env.Path,
        SystemRoot: process.env.SystemRoot,
        SYSTEMROOT: process.env.SYSTEMROOT,
        ComSpec: process.env.ComSpec,
        COMSPEC: process.env.COMSPEC,
        PATHEXT: process.env.PATHEXT,
        WINDIR: process.env.WINDIR,
        OPENAI_API_KEY: 'must-not-cross-verification-boundary',
        DSH_HOME: baselineHome,
      },
      createTemporaryRoot: async () => {
        await mkdir(workerRoot, { recursive: false })
        return workerRoot
      },
    })
    const sentinelAfter = await snapshotSentinel(sentinelFile)

    assert.deepEqual(sentinelAfter, sentinelBefore, 'verification worker smoke: external sentinel changed')
    assert.equal(await pathExists(workerRoot), false, 'verification worker smoke: disposable worker root survived cleanup')
    assert.match(execution.artifactFingerprint ?? '', ARTIFACT_FINGERPRINT, 'verification worker smoke: artifact fingerprint missing')
    assert.equal(execution.targetFingerprint, snapshot.fingerprint, 'verification worker smoke: target binding changed')
    assert.equal(execution.executionPolicy, 'safe', 'verification worker smoke: wrong execution policy')
    assert.equal(execution.terminal, 'completed', `verification worker smoke: terminal=${execution.terminal}`)
    assert.equal(execution.cleanup, 'succeeded', 'verification worker smoke: cleanup did not succeed')
    assert.deepEqual(execution.diagnostics, [], `verification worker smoke diagnostics: ${JSON.stringify(execution.diagnostics)}`)

    for (const id of ['package', 'install', 'compose', 'boot']) {
      assert.deepEqual(checkFor(execution, id), { id, status: 'passed' }, `verification worker smoke: ${id} did not pass`)
    }
    assert.deepEqual(
      checkFor(execution, 'visibility'),
      { id: 'visibility', status: 'skipped', reason: 'no-visibility-assertions' },
      'verification worker smoke: visibility must remain explicitly unproven',
    )
    assert.deepEqual(
      checkFor(execution, 'behavior'),
      { id: 'behavior', status: 'skipped', reason: 'not-supported-in-m4.1' },
      'verification worker smoke: behavior must remain explicitly unsupported',
    )

    process.stdout.write(
      `Verification worker smoke: ${DSH_VERSION} ${PROFILE} exact artifact + target package/install/compose/marker-boot verified in disposable home\n`,
    )
    return execution
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const candidateTarball = process.argv[2]
  if (typeof candidateTarball !== 'string' || candidateTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-verification-worker.mjs <candidate.tgz>')
  }
  await smokeVerificationWorker(candidateTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
