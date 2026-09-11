#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import {
  REAL_PLUGIN_CORPUS_DSH_VERSION,
  selectRealPluginCorpus,
} from './catalog.mjs'
import {
  parseToolchainEnvelope,
  summarizeCorpusResults,
} from './results.mjs'

const PROFILE = 'web'
const DEFAULT_MODE = 'smoke'

function parseArgs(argv) {
  const options = {
    mode: DEFAULT_MODE,
    outputDir: '.artifacts/real-plugin-corpus',
    toolchainTarball: undefined,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === '--mode' && value) {
      options.mode = value
      index += 1
      continue
    }
    if (arg === '--output-dir' && value) {
      options.outputDir = value
      index += 1
      continue
    }
    if (arg === '--toolchain-tarball' && value) {
      options.toolchainTarball = value
      index += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${String(arg)}`)
  }

  if (!options.toolchainTarball) {
    throw new Error('--toolchain-tarball is required')
  }
  return options
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) throw result.error
  return Object.freeze({
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  })
}

function commandFailure(command, args, execution) {
  const detail = [execution.stdout.trim(), execution.stderr.trim()].filter(Boolean).join('\n')
  return new Error(`${command} ${args.join(' ')} exited ${String(execution.status)}${detail ? `\n${detail}` : ''}`)
}

function requireSuccess(command, args, options) {
  const execution = run(command, args, options)
  if (execution.status !== 0) throw commandFailure(command, args, execution)
  return execution
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function parsePackMetadata(stdout, label) {
  let metadata
  try {
    metadata = JSON.parse(stdout)
  } catch (cause) {
    throw new Error(`${label} did not return JSON`, { cause })
  }

  const filename = metadata?.[0]?.filename
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`${label} did not report an artifact filename`)
  }
  return filename
}

async function finishArtifact(downloadDir, filename, acquisition) {
  const path = await realpath(join(downloadDir, basename(filename)))
  return Object.freeze({
    path,
    sha256: await sha256File(path),
    acquisition,
  })
}

async function acquireNpmArtifact(entry, downloadDir, env) {
  const spec = `${entry.packageName}@${entry.version}`
  const execution = requireSuccess('npm', [
    'pack',
    spec,
    '--ignore-scripts',
    '--json',
    '--pack-destination', downloadDir,
  ], {
    env,
    timeout: 300_000,
  })

  const filename = parsePackMetadata(execution.stdout, `npm pack ${spec}`)
  return finishArtifact(downloadDir, filename, `npm:${spec}`)
}

async function acquireGitHubSourceArtifact(entry, downloadDir, env) {
  const sourceDir = join(downloadDir, `${entry.id}-source`)
  await mkdir(sourceDir, { recursive: true })

  requireSuccess('git', ['init', sourceDir], { env, timeout: 120_000 })
  requireSuccess('git', [
    '-C', sourceDir,
    'remote', 'add', 'origin',
    `https://github.com/${entry.sourceRepo}.git`,
  ], { env, timeout: 120_000 })
  requireSuccess('git', [
    '-C', sourceDir,
    'fetch', '--depth=1', '--no-tags', 'origin', entry.sourceRef,
  ], { env, timeout: 300_000 })
  requireSuccess('git', [
    '-C', sourceDir,
    'checkout', '--detach', 'FETCH_HEAD',
  ], { env, timeout: 120_000 })

  const resolvedRef = requireSuccess('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], {
    env,
    timeout: 120_000,
  }).stdout.trim()
  if (resolvedRef !== entry.sourceRef) {
    throw new Error(`Git source ref mismatch for ${entry.id}: expected ${entry.sourceRef}, got ${resolvedRef}`)
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(join(sourceDir, 'package.json'), 'utf8'))
  } catch (cause) {
    throw new Error(`Pinned source ${entry.sourceRepo}@${entry.sourceRef} has no readable package.json`, { cause })
  }
  if (manifest?.name !== entry.packageName || manifest?.version !== entry.version) {
    throw new Error(
      `Pinned source manifest mismatch for ${entry.id}: expected ${entry.packageName}@${entry.version}, got ${String(manifest?.name)}@${String(manifest?.version)}`,
    )
  }

  const execution = requireSuccess('npm', [
    'pack',
    sourceDir,
    '--ignore-scripts',
    '--json',
    '--pack-destination', downloadDir,
  ], {
    env,
    timeout: 300_000,
  })

  const filename = parsePackMetadata(execution.stdout, `npm pack ${entry.sourceRepo}@${entry.sourceRef}`)
  return finishArtifact(downloadDir, filename, `github-source:${entry.sourceRepo}@${entry.sourceRef}`)
}

async function acquireArtifact(entry, downloadDir, env) {
  if (entry.distribution === 'npm') {
    return acquireNpmArtifact(entry, downloadDir, env)
  }
  if (entry.distribution === 'github-source') {
    return acquireGitHubSourceArtifact(entry, downloadDir, env)
  }
  throw new Error(`Unsupported distribution for ${entry.id}: ${String(entry.distribution)}`)
}

function harnessFailureRecord(entry, operation, error, extra = {}) {
  return Object.freeze({
    pluginId: entry.id,
    packageName: entry.packageName,
    packageVersion: entry.version,
    distribution: entry.distribution,
    sourceRepo: entry.sourceRepo,
    sourceRef: entry.sourceRef,
    operation,
    semanticOutcome: 'harness-failure',
    harnessFailure: true,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  })
}

function semanticRecord(entry, operation, parsed, artifact) {
  return Object.freeze({
    pluginId: entry.id,
    packageName: entry.packageName,
    packageVersion: entry.version,
    distribution: entry.distribution,
    sourceRepo: entry.sourceRepo,
    sourceRef: entry.sourceRef,
    category: entry.category,
    operation,
    semanticOutcome: parsed.semanticOutcome,
    harnessFailure: false,
    acquisition: artifact.acquisition,
    artifactSha256: artifact.sha256,
    targetFingerprint: parsed.targetFingerprint,
    ...(parsed.subjectFingerprint ? { subjectFingerprint: parsed.subjectFingerprint } : {}),
    ...(parsed.artifactFingerprint ? { artifactFingerprint: parsed.artifactFingerprint } : {}),
    ...(parsed.lifecycleFingerprint ? { lifecycleFingerprint: parsed.lifecycleFingerprint } : {}),
    ...(parsed.cleanup ? { cleanup: parsed.cleanup } : {}),
    diagnostics: parsed.diagnostics,
  })
}

function runToolchainOperation({ cli, home, dshPackageRoot, artifact, operation, env }) {
  const args = [
    cli,
    'plugin', operation === 'plugin.check' ? 'check' : 'verify',
    '--profile', PROFILE,
    '--dsh-home', home,
    '--dsh-package-root', dshPackageRoot,
    '--subject', artifact.path,
  ]
  const execution = run(process.execPath, args, {
    env,
    timeout: operation === 'plugin.verify' ? 720_000 : 240_000,
  })

  if (![0, 1].includes(execution.status)) {
    throw commandFailure(process.execPath, args, execution)
  }

  return parseToolchainEnvelope(execution.stdout, operation)
}

function markdownSummary(mode, summary, records) {
  const lines = [
    '# Real Plugin Corpus',
    '',
    `Mode: \`${mode}\``,
    `DSH target: \`${REAL_PLUGIN_CORPUS_DSH_VERSION}\` / \`${PROFILE}\``,
    `Harness failures: **${summary.harnessFailures}**`,
    '',
    '| Plugin | Distribution | Operation | Outcome | Artifact SHA-256 |',
    '| --- | --- | --- | --- | --- |',
  ]

  for (const record of records) {
    lines.push(`| ${record.pluginId} | ${record.distribution ?? '-'} | ${record.operation} | ${record.semanticOutcome} | ${record.artifactSha256 ?? '-'} |`)
  }

  lines.push(
    '',
    `Static: compatible-in-scope=${summary.staticVerdicts['compatible-in-scope']}, incompatible=${summary.staticVerdicts.incompatible}, unproven=${summary.staticVerdicts.unproven}`,
    `Runtime: verified=${summary.verificationStatuses.verified}, failed=${summary.verificationStatuses.failed}`,
    '',
  )
  return lines.join('\n')
}

async function writeEvidence(outputDir, mode, records, environment) {
  const summary = summarizeCorpusResults(records)
  await Promise.all([
    writeFile(join(outputDir, 'environment.json'), `${JSON.stringify(environment, undefined, 2)}\n`),
    writeFile(join(outputDir, 'results.jsonl'), `${records.map(record => JSON.stringify(record)).join('\n')}\n`),
    writeFile(join(outputDir, 'summary.json'), `${JSON.stringify({ mode, ...summary }, undefined, 2)}\n`),
    writeFile(join(outputDir, 'summary.md'), markdownSummary(mode, summary, records)),
  ])
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const corpus = selectRealPluginCorpus(options.mode)
  const outputDir = resolve(options.outputDir)
  const packedToolchain = await realpath(resolve(options.toolchainTarball))
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-real-corpus-'))
  const runner = join(root, 'runner')
  const home = join(root, 'dsh-home')
  const downloads = join(root, 'corpus-artifacts')
  const records = []
  const environment = Object.freeze({
    schemaVersion: 1,
    mode: options.mode,
    dshVersion: REAL_PLUGIN_CORPUS_DSH_VERSION,
    profile: PROFILE,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    gitSha: process.env.GITHUB_SHA ?? null,
    toolchainTarballSha256: await sha256File(packedToolchain),
    corpus: corpus.map(entry => ({
      id: entry.id,
      packageName: entry.packageName,
      version: entry.version,
      distribution: entry.distribution,
      sourceRepo: entry.sourceRepo,
      sourceRef: entry.sourceRef,
      runtimeExecution: entry.runtimeExecution,
    })),
  })
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    DSH_HOME: home,
  }

  await mkdir(outputDir, { recursive: true })

  try {
    await Promise.all([
      mkdir(runner, { recursive: true }),
      mkdir(downloads, { recursive: true }),
    ])
    await writeFile(join(runner, 'package.json'), '{"private":true}\n')

    requireSuccess('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/dsh@${REAL_PLUGIN_CORPUS_DSH_VERSION}`,
      packedToolchain,
    ], {
      cwd: runner,
      env,
      timeout: 600_000,
    })

    requireSuccess('pnpm', ['exec', 'dsh', '--profile', PROFILE, '--dump-config'], {
      cwd: runner,
      env,
      timeout: 240_000,
    })

    const cli = resolve(runner, 'node_modules', 'dsh-toolchain', 'lib', 'frontends', 'cli', 'bin.js')
    const dshPackageRoot = await realpath(resolve(runner, 'node_modules', '@deepseek-ai', 'dsh'))

    for (const entry of corpus) {
      let artifact
      try {
        artifact = await acquireArtifact(entry, downloads, env)
      } catch (error) {
        records.push(harnessFailureRecord(entry, 'acquire', error))
        continue
      }

      try {
        const parsed = runToolchainOperation({
          cli,
          home,
          dshPackageRoot,
          artifact,
          operation: 'plugin.check',
          env,
        })
        records.push(semanticRecord(entry, 'plugin.check', parsed, artifact))
      } catch (error) {
        records.push(harnessFailureRecord(entry, 'plugin.check', error, {
          acquisition: artifact.acquisition,
          artifactSha256: artifact.sha256,
        }))
        continue
      }

      if (!entry.runtimeExecution) continue

      try {
        const parsed = runToolchainOperation({
          cli,
          home,
          dshPackageRoot,
          artifact,
          operation: 'plugin.verify',
          env,
        })
        records.push(semanticRecord(entry, 'plugin.verify', parsed, artifact))
      } catch (error) {
        records.push(harnessFailureRecord(entry, 'plugin.verify', error, {
          acquisition: artifact.acquisition,
          artifactSha256: artifact.sha256,
        }))
      }
    }
  } catch (error) {
    records.push(Object.freeze({
      pluginId: 'corpus-runner',
      operation: 'runner',
      semanticOutcome: 'harness-failure',
      harnessFailure: true,
      error: error instanceof Error ? error.message : String(error),
    }))
  } finally {
    const summary = await writeEvidence(outputDir, options.mode, records, environment)
    await rm(root, { recursive: true, force: true })
    process.stdout.write(markdownSummary(options.mode, summary, records))
    if (summary.harnessFailures > 0) process.exitCode = 1
  }
}

await main()
