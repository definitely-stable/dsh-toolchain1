#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertTreeUnchanged, snapshotTree } from './smoke-plugin-check.mjs'

export const OPERATION_SMOKE_DSH_VERSION = '0.1.2-rc.1'
export const OPERATION_SMOKE_PROFILE = 'web'

const PROBE_PACKAGE = 'dsh-toolchain-operation-smoke-probe'
const CANDIDATE_PACKAGE = 'dsh-toolchain-operation-smoke-candidate'
const PROBE_MARKER = 'DSH_TOOLCHAIN_OPERATION_PROBE '
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
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const detail = [stdout, stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} exited ${String(result.status)}${detail ? `\n${detail}` : ''}`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}

async function createCandidate(root, env) {
  const source = join(root, 'candidate-source')
  const packed = join(root, 'candidate.tgz')
  await mkdir(source, { recursive: true })
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
    writeFile(join(source, 'plugin.mjs'), 'export function apply() {}\n', { flag: 'wx' }),
  ])
  run('pnpm', ['pack', '--out', packed], {
    cwd: source,
    env,
    capture: true,
    timeout: 120_000,
  })
  return realpath(packed)
}

async function createProbe(root) {
  const probe = join(root, PROBE_PACKAGE)
  await mkdir(probe, { recursive: true })
  await writeFile(join(probe, 'package.json'), `${JSON.stringify({
    name: PROBE_PACKAGE,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './probe.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`, { flag: 'wx' })
  await writeFile(
    join(probe, 'cordis.patch.yml'),
    `- insert:\n    - id: ${PROBE_PACKAGE}\n      name: ${PROBE_PACKAGE}\n`,
    { flag: 'wx' },
  )
  await writeFile(join(probe, 'probe.mjs'), `
const MARKER = ${JSON.stringify(PROBE_MARKER)}
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const OPERATION_POLL_TIMEOUT_MS = 240_000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function apply(rootCtx) {
  rootCtx.inject(['toolchain', 'tools', 'agentLoop', 'agents'], (ctx) => {
    const appExit = ctx.get('appExit')
    if (typeof appExit !== 'function') throw new Error('Operation smoke requires launcher-owned ctx.appExit')

    Promise.resolve().then(async () => {
      const dshHome = process.env.DSH_HOME
      const dshPackageRoot = process.env.DSH_TOOLCHAIN_SMOKE_DSH_ROOT
      const profile = process.env.DSH_TOOLCHAIN_SMOKE_PROFILE
      const candidatePath = process.env.DSH_TOOLCHAIN_SMOKE_CANDIDATE
      if (!dshHome || !dshPackageRoot || !profile || !candidatePath) {
        throw new Error('Operation smoke requires exact target and candidate environment')
      }

      const target = { profile, dshHome, dshPackageRoot }
      const baseline = await ctx.toolchain.resolveTarget(target, 'operation-smoke-target')
      if (baseline.status !== 'ok') throw new Error('Operation smoke target resolve failed')

      const agent = ctx.agentLoop.create('dsh-toolchain-operation-smoke-agent')
      const schemas = ctx.tools.schemas(agent)
      const startVisible = schemas.some(schema => schema.name === 'toolchain_plugin_verify_start')
      const getVisible = schemas.some(schema => schema.name === 'toolchain_operation_get')
      const cancelVisible = schemas.some(schema => schema.name === 'toolchain_operation_cancel')

      const startResult = await ctx.tools.execute({
        callId: 'operation-smoke-start',
        name: 'toolchain_plugin_verify_start',
        arguments: {
          target,
          subject: { kind: 'packed', path: candidatePath },
          executionPolicy: 'safe',
        },
        agent,
        signal: new AbortController().signal,
      })
      const started = startResult.isError ? undefined : startResult.value?.data?.operation
      if (typeof started?.id !== 'string') {
        throw new Error('Operation smoke start did not return an operation id: ' + JSON.stringify(startResult))
      }

      let getResult
      let operation = started
      let attempt = 0
      const deadline = Date.now() + OPERATION_POLL_TIMEOUT_MS
      while (operation.state === 'queued' || operation.state === 'running') {
        if (Date.now() >= deadline) {
          throw new Error(
            'Operation smoke timed out waiting for a terminal operation: ' + JSON.stringify(operation),
          )
        }
        await sleep(250)
        getResult = await ctx.tools.execute({
          callId: 'operation-smoke-get-' + String(attempt),
          name: 'toolchain_operation_get',
          arguments: { id: started.id },
          agent,
          signal: new AbortController().signal,
        })
        attempt += 1
        if (getResult.isError) break
        operation = getResult.value?.data?.operation
        if (operation === undefined || TERMINAL.has(operation.state)) break
      }

      const terminal = getResult?.isError === false ? getResult.value?.data?.operation : operation
      const nested = terminal?.result
      const report = nested?.status === 'ok' ? nested.data : undefined
      const receipt = {
        baselineFingerprint: baseline.snapshotFingerprint,
        startVisible,
        getVisible,
        cancelVisible,
        start: {
          isError: startResult.isError,
          status: startResult.isError ? undefined : startResult.value?.status,
          id: started.id,
          state: started.state,
        },
        terminal: {
          isError: getResult?.isError ?? false,
          status: getResult?.isError ? undefined : getResult?.value?.status,
          id: terminal?.id,
          state: terminal?.state,
          cancellationRequested: terminal?.cancellationRequested,
          resultStatus: nested?.status,
          verificationStatus: report?.status,
          snapshotFingerprint: nested?.snapshotFingerprint,
          artifactFingerprint: report?.artifactFingerprint,
          targetFingerprint: report?.targetFingerprint,
          cleanup: report?.cleanup,
        },
      }
      process.stdout.write(MARKER + JSON.stringify(receipt) + '\\n')
      appExit(0)
    }).catch(error => {
      process.stderr.write('DSH_TOOLCHAIN_OPERATION_PROBE_ERROR ' + String(error?.stack ?? error) + '\\n')
      appExit(1)
    })
  })
}
`, { flag: 'wx' })
  return probe
}

export function assertVerificationOperationReceipt(
  receipt,
  targetFingerprint,
  artifactFingerprint,
) {
  const terminal = receipt?.terminal
  if (
    receipt?.startVisible !== true
    || receipt?.getVisible !== true
    || receipt?.cancelVisible !== true
    || receipt?.start?.isError !== false
    || receipt?.start?.status !== 'ok'
    || typeof receipt?.start?.id !== 'string'
    || !['queued', 'running'].includes(receipt.start.state)
    || terminal?.isError !== false
    || terminal?.status !== 'ok'
    || terminal?.id !== receipt.start.id
    || terminal?.state !== 'succeeded'
    || terminal?.cancellationRequested !== false
    || terminal?.resultStatus !== 'ok'
    || terminal?.verificationStatus !== 'verified'
    || terminal?.snapshotFingerprint !== targetFingerprint
    || terminal?.targetFingerprint !== targetFingerprint
    || terminal?.artifactFingerprint !== artifactFingerprint
    || terminal?.cleanup !== 'succeeded'
  ) {
    throw new Error(`DSH operation lifecycle smoke: invalid receipt ${JSON.stringify(receipt)}`)
  }
}

function parseReceipt(output) {
  const line = output.split(/\r?\n/u).find(candidate => candidate.startsWith(PROBE_MARKER))
  if (line === undefined) {
    throw new Error('DSH operation lifecycle smoke: real Host did not emit a lifecycle receipt')
  }
  try {
    return JSON.parse(line.slice(PROBE_MARKER.length))
  } catch (cause) {
    throw new Error('DSH operation lifecycle smoke: invalid lifecycle receipt JSON', { cause })
  }
}

export async function smokeOperationLifecycle(toolchainTarball) {
  const packedToolchain = await realpath(resolve(toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-operation-smoke-'))
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
    const artifactFingerprint = `dsh-plugin-artifact-v1:${candidateHash}`
    const probe = await createProbe(root)

    run('pnpm', [
      'add', '--save-exact', '--ignore-scripts',
      `@deepseek-ai/dsh@${OPERATION_SMOKE_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    for (const plugin of [packedToolchain, probe]) {
      run('pnpm', [
        'exec', 'dsh', 'plugin', '--profile', OPERATION_SMOKE_PROFILE,
        'add', '--ignore-scripts', plugin,
      ], {
        cwd: runner,
        env,
        timeout: 300_000,
      })
    }

    const profileDir = join(home, 'profiles', OPERATION_SMOKE_PROFILE)
    const before = await snapshotTree(profileDir)
    const dshPackageRoot = await realpath(join(runner, 'node_modules', '@deepseek-ai', 'dsh'))
    const output = run('pnpm', [
      'exec', 'dsh', '--profile', OPERATION_SMOKE_PROFILE, '--no-open', '--port', '0',
    ], {
      cwd: runner,
      env: {
        ...env,
        DSH_TOOLCHAIN_SMOKE_PROFILE: OPERATION_SMOKE_PROFILE,
        DSH_TOOLCHAIN_SMOKE_DSH_ROOT: dshPackageRoot,
        DSH_TOOLCHAIN_SMOKE_CANDIDATE: candidate,
      },
      capture: true,
      timeout: 720_000,
    })
    const after = await snapshotTree(profileDir)
    assertTreeUnchanged(before, after, 'real DSH verification operation Host profile')

    const receipt = parseReceipt(output)
    const targetFingerprint = receipt?.baselineFingerprint
    if (typeof targetFingerprint !== 'string' || !TARGET_FINGERPRINT.test(targetFingerprint)) {
      throw new Error(`DSH operation lifecycle smoke: invalid baseline target ${JSON.stringify(targetFingerprint)}`)
    }
    if (!ARTIFACT_FINGERPRINT.test(artifactFingerprint)) {
      throw new Error('DSH operation lifecycle smoke: invalid expected artifact identity')
    }
    assertVerificationOperationReceipt(receipt, targetFingerprint, artifactFingerprint)

    process.stdout.write(
      `DSH operation lifecycle smoke: ${OPERATION_SMOKE_DSH_VERSION} persistent Host start/get succeeded with exact packed artifact and unchanged active profile\n`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const toolchainTarball = process.argv[2]
  if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-operation-lifecycle.mjs <packed-toolchain.tgz>')
  }
  await smokeOperationLifecycle(toolchainTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
