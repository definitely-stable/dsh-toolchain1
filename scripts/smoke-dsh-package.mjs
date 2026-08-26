#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const DSH_SMOKE_VERSION = '0.1.1-rc.2'
export const DSH_BOOT_PROBE_PROFILE = 'toolchain-smoke'
export const DSH_SMOKE_PROFILES = Object.freeze([
  Object.freeze({
    name: DSH_BOOT_PROBE_PROFILE,
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base']),
  }),
  Object.freeze({
    name: 'web',
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']),
  }),
])

const BOOT_PROBE_PACKAGE = 'dsh-toolchain-smoke-probe'
const BOOT_PROBE_MARKER = 'DSH_TOOLCHAIN_BOOT_PROBE '
const EXPECTED_DESCRIPTOR = Object.freeze({
  product: 'dsh-toolchain',
  version: '0.0.0',
  protocolVersion: '1',
})

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

export async function createBootProbePackage(root) {
  const probe = join(root, BOOT_PROBE_PACKAGE)
  await mkdir(probe, { recursive: true })
  await writeFile(join(probe, 'package.json'), JSON.stringify({
    name: BOOT_PROBE_PACKAGE,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './probe.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2) + '\n')
  await writeFile(join(probe, 'cordis.patch.yml'), `- insert:
    - id: ${BOOT_PROBE_PACKAGE}
      name: ${BOOT_PROBE_PACKAGE}
`)
  await writeFile(join(probe, 'probe.mjs'), `export function apply(rootCtx) {
  rootCtx.inject(['toolchain'], (ctx) => {
    const descriptor = ctx.toolchain.describe()
    process.stdout.write(${JSON.stringify(BOOT_PROBE_MARKER)} + JSON.stringify(descriptor) + '\\n')
    const appExit = ctx.get('appExit')
    if (typeof appExit !== 'function') throw new Error('DSH boot probe requires launcher-owned ctx.appExit')
    appExit(0)
  })
}
`)
  return probe
}

export function assertBootProbeOutput(output) {
  const line = output
    .split(/\r?\n/)
    .find(candidate => candidate.startsWith(BOOT_PROBE_MARKER))
  if (line === undefined) {
    throw new Error('DSH smoke: real boot did not observe ctx.toolchain')
  }

  let descriptor
  try {
    descriptor = JSON.parse(line.slice(BOOT_PROBE_MARKER.length))
  } catch (cause) {
    throw new Error('DSH smoke: boot probe emitted an invalid descriptor', { cause })
  }
  if (JSON.stringify(descriptor) !== JSON.stringify(EXPECTED_DESCRIPTOR)) {
    throw new Error(`DSH smoke: boot probe observed unexpected descriptor ${JSON.stringify(descriptor)}`)
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

    const probe = await createBootProbePackage(root)
    run('pnpm', [
      'exec', 'dsh', 'plugin', '--profile', DSH_BOOT_PROBE_PROFILE,
      'add', '--ignore-scripts', probe,
    ], {
      cwd: runner,
      env,
      timeout: 300_000,
    })

    const bootOutput = run('pnpm', [
      'exec', 'dsh', '--profile', DSH_BOOT_PROBE_PROFILE,
    ], {
      cwd: runner,
      env,
      capture: true,
      timeout: 120_000,
    })
    assertBootProbeOutput(bootOutput)

    process.stdout.write(
      `DSH package smoke: ${version} profiles ${profiles.map(profile => profile.name).join(', ')} composition + real service boot verified\n`,
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
