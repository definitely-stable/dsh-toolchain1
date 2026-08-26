#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const DSH_SMOKE_VERSION = '0.1.1-rc.2'
export const DSH_SMOKE_PROFILES = Object.freeze([
  Object.freeze({
    name: 'toolchain-smoke',
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base']),
  }),
  Object.freeze({
    name: 'web',
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']),
  }),
])

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
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const suffix = stderr ? `\n${stderr}` : ''
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${suffix}`)
  }

  return typeof result.stdout === 'string' ? result.stdout : ''
}

export function assertProfileManifest(manifest, requiredBundles = []) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes('dsh-toolchain')) {
    throw new Error('DSH smoke: profile manifest did not register dsh-toolchain as a bundle')
  }
  for (const requiredBundle of requiredBundles) {
    if (!bundles.includes(requiredBundle)) {
      throw new Error(`DSH smoke: profile manifest is missing required bundle ${requiredBundle}`)
    }
  }
  if (manifest?.dependencies?.['dsh-toolchain'] === undefined) {
    throw new Error('DSH smoke: profile manifest did not record dsh-toolchain as a dependency')
  }
}

export function assertDumpConfig(dump) {
  if (!dump.includes('dsh-toolchain')) {
    throw new Error('DSH smoke: composed config does not name the dsh-toolchain bundle layer')
  }
  if (!/\n\s*- id: dsh-toolchain\n/.test(dump)) {
    throw new Error('DSH smoke: composed config does not contain the dsh-toolchain row')
  }
  if (!dump.includes("name: 'dsh-toolchain/dsh'") && !dump.includes('name: dsh-toolchain/dsh')) {
    throw new Error('DSH smoke: composed config does not mount dsh-toolchain/dsh')
  }
}

export async function smokeDshPackage(tarballPath, options = {}) {
  const tarball = resolve(tarballPath)
  const version = options.dshVersion ?? DSH_SMOKE_VERSION
  const profiles = options.profiles ?? DSH_SMOKE_PROFILES
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-smoke-'))
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
    await writeFile(join(runner, 'package.json'), JSON.stringify({ private: true }, undefined, 2) + '\n')

    run('pnpm', ['add', '--save-exact', '--ignore-scripts', `@deepseek-ai/dsh@${version}`], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    for (const profile of profiles) {
      run('pnpm', [
        'exec', 'dsh', 'plugin', '--profile', profile.name,
        'add', '--ignore-scripts', tarball,
      ], {
        cwd: runner,
        env,
        timeout: 300_000,
      })

      const profileDir = join(home, 'profiles', profile.name)
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      assertProfileManifest(manifest, profile.requiredBundles)

      const dump = run('pnpm', [
        'exec', 'dsh', '--profile', profile.name, '--dump-config',
      ], {
        cwd: runner,
        env,
        capture: true,
        timeout: 120_000,
      })
      assertDumpConfig(dump)
    }

    process.stdout.write(
      `DSH package smoke: ${version} profiles ${profiles.map(profile => profile.name).join(', ')} composition verified\n`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const tarballPath = process.argv[2]
  if (!tarballPath) {
    process.stderr.write('usage: node scripts/smoke-dsh-package.mjs <package.tgz>\n')
    process.exitCode = 2
    return
  }
  await smokeDshPackage(tarballPath)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
