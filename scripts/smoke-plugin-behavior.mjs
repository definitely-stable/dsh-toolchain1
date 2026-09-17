#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { assertTreeUnchanged, snapshotTree } from './smoke-plugin-check.mjs'

export const PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION = '0.1.5-rc.2'
export const PLUGIN_BEHAVIOR_SMOKE_PROFILE = 'web'
export const PLUGIN_BEHAVIOR_SMOKE_TOOL = 'dsh_toolchain_behavior_smoke_tool'

const CANDIDATE_PACKAGE = 'dsh-toolchain-behavior-smoke-candidate'
const DIAGNOSTIC_PACKAGE = 'dsh-toolchain-behavior-smoke-diagnostic'
const DIAGNOSTIC_MARKER = 'DSH_TOOLCHAIN_BEHAVIOR_DIAGNOSTIC_V1:'
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

async function createBehaviorCandidate(root, env) {
  const source = join(root, 'candidate-source')
  const packed = join(root, 'candidate.tgz')
  await mkdir(source, { recursive: true })

  const pluginSource = [
    `const TOOL = ${JSON.stringify(PLUGIN_BEHAVIOR_SMOKE_TOOL)}`,
    "export const inject = ['tools']",
    '',
    'export function apply(ctx) {',
    '  ctx.tools.register({',
    '    name: TOOL,',
    "    description: 'Disposable deterministic Agent Tool behavior smoke.',",
    "    parameters: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'integer' } } },",
    '    output: {',
    "      schema: { type: 'object', description: 'Deterministic behavior smoke output.' },",
    "      render: (args, value) => [{ type: 'text', text: JSON.stringify(value) }],",
    '    },',
    '    async execute(args) { return { ready: true, value: args.value } },',
    '  })',
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

async function probeDirectDshBehavior(root, runner, candidate, env) {
  const diagnosticHome = join(root, 'diagnostic-home')
  const probe = join(root, 'diagnostic-probe')
  const diagnosticEnv = { ...env, DSH_HOME: diagnosticHome }
  await mkdir(probe, { recursive: true })

  const probeSource = [
    "export const inject = ['tools', 'agentLoop']",
    '',
    'export async function apply(ctx) {',
    "  const appExit = ctx.get('appExit')",
    `  const name = ${JSON.stringify(PLUGIN_BEHAVIOR_SMOKE_TOOL)}`,
    "  const agent = await ctx.agentLoop.create('dsh-toolchain-behavior-diagnostic-agent')",
    '  const visible = ctx.tools.schemas(agent).some(schema => schema.name === name)',
    '  let presented = false',
    '  try {',
    "    agent.ctx.tools.presentAs('native')",
    '    presented = true',
    '  } catch {}',
    '  let result',
    '  if (presented) {',
    '    try {',
    '      result = await ctx.tools.execute({',
    "        callId: 'dsh-toolchain-behavior-diagnostic-call',",
    '        name,',
    '        arguments: { value: 7 },',
    '        agent,',
    '        signal: AbortSignal.timeout(10000),',
    '      })',
    '    } catch {}',
    '  }',
    '  const evidence = {',
    '    visible,',
    '    presented,',
    "    outcome: result === undefined ? 'threw' : result.isError ? 'error' : 'success',",
    '    errorCode: result?.isError === true ? result.error?.info?.code ?? null : null,',
    '    value: result?.isError === false ? result.value : null,',
    '  }',
    `  process.stdout.write(${JSON.stringify(DIAGNOSTIC_MARKER)} + JSON.stringify(evidence) + '\\n')`,
    '  appExit(0)',
    '}',
    '',
  ].join('\n')

  await Promise.all([
    writeFile(join(probe, 'package.json'), `${JSON.stringify({
      name: DIAGNOSTIC_PACKAGE,
      version: '0.0.0',
      private: true,
      type: 'module',
      exports: './probe.mjs',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, undefined, 2)}\n`, { flag: 'wx' }),
    writeFile(
      join(probe, 'cordis.patch.yml'),
      `- insert:\n    - id: ${DIAGNOSTIC_PACKAGE}\n      name: '${DIAGNOSTIC_PACKAGE}'\n`,
      { flag: 'wx' },
    ),
    writeFile(join(probe, 'probe.mjs'), probeSource, { flag: 'wx' }),
  ])

  run('pnpm', ['exec', 'dsh', '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE, '--dump-config'], {
    cwd: runner,
    env: diagnosticEnv,
    capture: true,
    timeout: 180_000,
  })
  run('pnpm', [
    'exec', 'dsh', 'plugin', '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE,
    'add', '--ignore-scripts', candidate,
  ], { cwd: runner, env: diagnosticEnv, capture: true, timeout: 180_000 })
  run('pnpm', [
    'exec', 'dsh', 'plugin', '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE,
    'add', '--ignore-scripts', probe,
  ], { cwd: runner, env: diagnosticEnv, capture: true, timeout: 180_000 })
  const stdout = run('pnpm', [
    'exec', 'dsh', '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE, '--no-open', '--port', '0',
  ], { cwd: runner, env: diagnosticEnv, capture: true, timeout: 180_000 })
  const line = stdout.split(/\r?\n/u).find(candidateLine => candidateLine.startsWith(DIAGNOSTIC_MARKER))
  assert.ok(line, 'Plugin Behavior diagnostic: exact direct DSH evidence marker missing')
  const evidence = JSON.parse(line.slice(DIAGNOSTIC_MARKER.length))
  process.stdout.write(`Plugin Behavior direct DSH diagnostic: ${JSON.stringify(evidence)}\n`)
  return evidence
}

function parseTarget(stdout) {
  let response
  try {
    response = JSON.parse(stdout)
  } catch (cause) {
    throw new Error('Plugin Behavior smoke: Toolchain target resolve did not emit Protocol JSON', { cause })
  }
  assert.equal(response.protocolVersion, '1', 'Plugin Behavior smoke: wrong Protocol version')
  assert.equal(response.status, 'ok', 'Plugin Behavior smoke: exact target resolution failed')
  const snapshot = response.data?.snapshot
  assert.ok(snapshot, 'Plugin Behavior smoke: exact target snapshot missing')
  assert.match(snapshot.fingerprint ?? '', TARGET_FINGERPRINT, 'Plugin Behavior smoke: target fingerprint missing')
  assert.equal(snapshot.dsh?.version, PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION, 'Plugin Behavior smoke: wrong exact DSH train')
  assert.equal(snapshot.profile?.name, PLUGIN_BEHAVIOR_SMOKE_PROFILE, 'Plugin Behavior smoke: wrong profile')
  return snapshot
}

function checkFor(execution, id) {
  return execution.checks.find(check => check.id === id)
}

export async function smokePluginBehavior(toolchainTarball) {
  const packedToolchain = await realpath(resolve(toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-plugin-behavior-'))
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
    const candidate = await createBehaviorCandidate(root, env)
    const candidateHash = createHash('sha256').update(await readFile(candidate)).digest('hex')

    run('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/dsh@${PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 480_000,
    })
    await probeDirectDshBehavior(root, runner, candidate, env)
    run('pnpm', ['exec', 'dsh', '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE, '--dump-config'], {
      cwd: runner,
      env,
      capture: true,
      timeout: 180_000,
    })

    const profileRoot = join(home, 'profiles', PLUGIN_BEHAVIOR_SMOKE_PROFILE)
    const profileBefore = await snapshotTree(profileRoot)
    const installedToolchainRoot = resolve(runner, 'node_modules', 'dsh-toolchain')
    const installedToolchainCli = resolve(installedToolchainRoot, 'lib', 'frontends', 'cli', 'bin.js')
    const dshPackageRoot = await realpath(resolve(runner, 'node_modules', '@deepseek-ai', 'dsh'))
    const targetStdout = run(process.execPath, [
      installedToolchainCli,
      'target', 'resolve',
      '--profile', PLUGIN_BEHAVIOR_SMOKE_PROFILE,
      '--dsh-home', home,
      '--dsh-package-root', dshPackageRoot,
    ], { capture: true, timeout: 120_000 })
    const target = parseTarget(targetStdout)
    assertTreeUnchanged(
      profileBefore,
      await snapshotTree(profileRoot),
      `DSH ${PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION} behavior target resolution`,
    )

    const workerUrl = pathToFileURL(resolve(installedToolchainRoot, 'lib', 'verification', 'packed-worker.js')).href
    const worker = await import(workerUrl)
    assert.equal(
      typeof worker.runPackedPluginVerification,
      'function',
      'Plugin Behavior smoke: exact packed Toolchain worker export missing',
    )

    const execution = await worker.runPackedPluginVerification({
      artifact: {
        path: candidate,
        expectedContentHash: candidateHash,
      },
      target,
      executionPolicy: 'safe',
      visibilityAssertions: [{ kind: 'agent-tool', name: PLUGIN_BEHAVIOR_SMOKE_TOOL }],
      behaviorAssertions: [{
        kind: 'agent-tool-result',
        name: PLUGIN_BEHAVIOR_SMOKE_TOOL,
        arguments: { value: 7 },
        expectedValue: { ready: true, value: 7 },
      }],
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
        DSH_HOME: home,
        OPENAI_API_KEY: 'must-not-cross-behavior-verification-boundary',
      },
    })

    assertTreeUnchanged(
      profileBefore,
      await snapshotTree(profileRoot),
      `DSH ${PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION} explicit Agent Tool behavior`,
    )
    assert.equal(
      execution.artifactFingerprint,
      `dsh-plugin-artifact-v1:${candidateHash}`,
      'Plugin Behavior smoke: receipt is not bound to exact candidate bytes',
    )
    assert.match(execution.artifactFingerprint ?? '', ARTIFACT_FINGERPRINT)
    assert.equal(execution.targetFingerprint, target.fingerprint, 'Plugin Behavior smoke: target binding changed')
    assert.equal(execution.executionPolicy, 'safe', 'Plugin Behavior smoke: execution policy changed')
    assert.equal(execution.terminal, 'completed', `Plugin Behavior smoke: terminal=${execution.terminal}`)
    assert.equal(execution.cleanup, 'succeeded', 'Plugin Behavior smoke: disposable cleanup failed')
    assert.deepEqual(execution.diagnostics, [], `Plugin Behavior smoke diagnostics: ${JSON.stringify(execution.diagnostics)}`)
    for (const id of ['package', 'install', 'compose', 'boot', 'visibility', 'behavior']) {
      assert.deepEqual(
        checkFor(execution, id),
        { id, status: 'passed' },
        `Plugin Behavior smoke: ${id} did not pass`,
      )
    }

    process.stdout.write(
      `Plugin Behavior smoke: DSH ${PLUGIN_BEHAVIOR_SMOKE_DSH_VERSION} exact packed Toolchain executed ${PLUGIN_BEHAVIOR_SMOKE_TOOL} with structured arguments/value in one disposable Agent epoch\n`,
    )
    return execution
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const toolchainTarball = process.argv[2]
  if (typeof toolchainTarball !== 'string' || toolchainTarball.length === 0) {
    throw new Error('Usage: node scripts/smoke-plugin-behavior.mjs <packed-toolchain.tgz>')
  }
  await smokePluginBehavior(toolchainTarball)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
