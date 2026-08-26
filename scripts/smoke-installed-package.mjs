#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const CORDIS_VERSION = '4.0.1'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const suffix = stderr ? `\n${stderr}` : ''
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${suffix}`)
  }

  return typeof result.stdout === 'string' ? result.stdout : ''
}

export async function smokeInstalledPackage(tarballPath) {
  const tarball = resolve(tarballPath)
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-consumer-'))
  const project = join(root, 'consumer')
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  }

  try {
    await mkdir(project, { recursive: true })
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }, undefined, 2) + '\n',
    )

    run('pnpm', [
      'add',
      '--save-exact',
      '--ignore-scripts',
      `@deepseek-ai/cordis@${CORDIS_VERSION}`,
      tarball,
    ], {
      cwd: project,
      env,
      timeout: 300_000,
    })

    run('node', [
      '--input-type=module',
      '-e',
      [
        "const root = await import('dsh-toolchain')",
        "const protocol = await import('dsh-toolchain/protocol')",
        "const dsh = await import('dsh-toolchain/dsh')",
        "if (root.TOOLCHAIN_PRODUCT !== 'dsh-toolchain' || root.TOOLCHAIN_VERSION !== '0.0.0') process.exit(1)",
        "if (root.TOOLCHAIN_PROTOCOL_VERSION !== '1') process.exit(1)",
        "if (protocol.TOOLCHAIN_PROTOCOL_VERSION !== '1') process.exit(1)",
        "if (typeof dsh.default !== 'function') process.exit(1)",
        "if ('createApplicationKernel' in root) process.exit(1)",
      ].join(';'),
    ], { cwd: project, env })

    const version = run('pnpm', ['exec', 'dsh-toolchain', '--version'], {
      cwd: project,
      env,
      capture: true,
    }).trim()
    if (version !== '0.0.0') {
      throw new Error(`installed CLI reported unexpected version ${JSON.stringify(version)}`)
    }

    run('pnpm', ['exec', 'dsh-toolchain', '--help'], {
      cwd: project,
      env,
      capture: true,
    })

    process.stdout.write('installed package consumer smoke: exports and CLI verified\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const tarballPath = process.argv[2]
  if (!tarballPath) {
    process.stderr.write('usage: node scripts/smoke-installed-package.mjs <package.tgz>\n')
    process.exitCode = 2
    return
  }

  await smokeInstalledPackage(tarballPath)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
