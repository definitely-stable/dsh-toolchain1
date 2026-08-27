import { readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AcquiredContractFacts, ContractEnrichmentPort } from '../../model/contract.js'
import type { Evidence, TargetSnapshot } from '../../protocol/index.js'

/** Exact running-target predicate required before Host Inspect evidence may join one resolved snapshot. */
export interface DshRuntimeTargetBindingPort {
  matches(snapshot: TargetSnapshot): Promise<boolean>
}

export interface DshRuntimeTargetBindingOptions {
  /** Root DSH Context base URL. App boot anchors this at the selected profile directory. */
  readonly baseUrl: string
  /** Authoritative value from the Host-provided `dshHomePath()` capability. */
  readonly dshHome: string
  /** Exact running process argv, including Node script path. */
  readonly argv?: readonly string[]
  /** Working directory used by the official launcher to resolve `--patch` paths. */
  readonly cwd?: string
  readonly nodeVersion?: string
  readonly platform?: string
  readonly arch?: string
}

interface RunningProfileInvocation {
  readonly profile: string
  readonly patches: readonly string[]
}

const EMPTY_ACQUIRED: AcquiredContractFacts = Object.freeze({
  evidence: Object.freeze([]),
  contracts: Object.freeze([]),
})

function evidenceById(snapshot: TargetSnapshot, id: string): Evidence | undefined {
  return snapshot.evidence.find(item => item.id === id)
}

function pathFromBaseUrl(value: string): string | undefined {
  try {
    return value.startsWith('file:') ? fileURLToPath(value) : resolve(value)
  } catch {
    return undefined
  }
}

function readOptionValue(
  token: string,
  name: '--profile' | '--patch',
): string | undefined {
  const prefix = `${name}=`
  return token.startsWith(prefix) ? token.slice(prefix.length) : undefined
}

/**
 * Parse only the launcher-owned prefix of an official `dsh` profile invocation.
 * Unknown tokens begin inner app args exactly as the upstream Commander adapter does.
 */
export function parseRunningDshProfileInvocation(
  argv: readonly string[],
  cwd: string = process.cwd(),
): RunningProfileInvocation | undefined {
  const args = argv.slice(2)
  let index = 0
  let profile: string | undefined
  const patches: string[] = []

  if (args[0] === 'web') {
    profile = 'web'
    index = 1
  }

  while (index < args.length) {
    const token = args[index]!
    if (token === '--profile') {
      const value = args[index + 1]
      if (profile !== undefined || value === undefined || value === '') return undefined
      profile = value
      index += 2
      continue
    }
    const inlineProfile = readOptionValue(token, '--profile')
    if (inlineProfile !== undefined) {
      if (profile !== undefined || inlineProfile === '') return undefined
      profile = inlineProfile
      index += 1
      continue
    }
    if (token === '--patch') {
      const value = args[index + 1]
      if (value === undefined || value === '') return undefined
      patches.push(resolve(cwd, value))
      index += 2
      continue
    }
    const inlinePatch = readOptionValue(token, '--patch')
    if (inlinePatch !== undefined) {
      if (inlinePatch === '') return undefined
      patches.push(resolve(cwd, inlinePatch))
      index += 1
      continue
    }
    if (token === '--dump-config' || token === '--dump-default-config' || token === 'plugin') {
      return undefined
    }
    // The first launcher-unknown token belongs to the booted app.
    break
  }

  if (profile === undefined || profile === '') return undefined
  return Object.freeze({ profile, patches: Object.freeze(patches) })
}

async function canonicalPath(value: string): Promise<string | undefined> {
  try {
    return await realpath(value)
  } catch {
    return undefined
  }
}

async function sameExistingPath(left: string | undefined, right: string): Promise<boolean> {
  if (left === undefined) return false
  const [a, b] = await Promise.all([canonicalPath(left), canonicalPath(right)])
  return a !== undefined && b !== undefined && a === b
}

async function packageNameAt(location: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(location, 'utf8')) as { name?: unknown }
    return typeof parsed.name === 'string' ? parsed.name : undefined
  } catch {
    return undefined
  }
}

async function owningPackageManifest(
  scriptPath: string,
  packageName: string,
): Promise<string | undefined> {
  const canonicalScript = await canonicalPath(scriptPath)
  if (canonicalScript === undefined) return undefined
  let current = dirname(canonicalScript)
  while (true) {
    const manifest = join(current, 'package.json')
    if (await packageNameAt(manifest) === packageName) return manifest
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function location(snapshot: TargetSnapshot, evidenceId: string): string | undefined {
  const evidence = evidenceById(snapshot, evidenceId)
  return typeof evidence?.location === 'string' ? evidence.location : undefined
}

/**
 * Build a conservative automatic binding for the official DSH launcher.
 *
 * Current upstream exposes the exact profile directory (`ctx.root.baseUrl`) and
 * DSH home (`dshHomePath()`), but not the boot-time hashes of arbitrary
 * `--patch` overlays. Therefore automatic live binding deliberately rejects
 * every invocation containing explicit launcher overlays instead of guessing.
 */
export function createDshRuntimeTargetBinding(
  options: DshRuntimeTargetBindingOptions,
): DshRuntimeTargetBindingPort | undefined {
  const profileDirectory = pathFromBaseUrl(options.baseUrl)
  const argv = options.argv ?? process.argv
  const cwd = options.cwd ?? process.cwd()
  const launch = parseRunningDshProfileInvocation(argv, cwd)
  if (profileDirectory === undefined || launch === undefined) return undefined

  const home = resolve(options.dshHome)
  const expectedProfileDirectory = join(home, 'profiles', launch.profile)
  const nodeVersion = options.nodeVersion ?? process.versions.node
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const scriptPath = argv[1]

  return Object.freeze({
    async matches(snapshot: TargetSnapshot): Promise<boolean> {
      // Upstream does not publish boot-time overlay hashes. Reject rather than
      // compare the requested target against mutable overlay files after boot.
      if (launch.patches.length !== 0 || snapshot.profile.overlayPatchHashes.length !== 0) return false
      if (snapshot.profile.name !== launch.profile) return false
      if (
        snapshot.runtime.nodeVersion !== nodeVersion
        || snapshot.runtime.platform !== platform
        || snapshot.runtime.arch !== arch
      ) return false

      if (!await sameExistingPath(profileDirectory, expectedProfileDirectory)) return false
      if (!await sameExistingPath(location(snapshot, 'manifest:profile'), join(profileDirectory, 'package.json'))) {
        return false
      }
      if (!await sameExistingPath(location(snapshot, 'patch:profile'), join(profileDirectory, 'cordis.patch.yml'))) {
        // Optional target patches still record the canonical expected location;
        // absence is represented by an observed sentinel hash, so compare the
        // parent profile path when the file itself is absent.
        const profilePatch = location(snapshot, 'patch:profile')
        if (profilePatch === undefined || resolve(profilePatch) !== resolve(join(profileDirectory, 'cordis.patch.yml'))) {
          return false
        }
      }
      if (!await sameExistingPath(location(snapshot, 'patch:home'), join(home, 'cordis.patch.yml'))) {
        const homePatch = location(snapshot, 'patch:home')
        if (homePatch === undefined || resolve(homePatch) !== resolve(join(home, 'cordis.patch.yml'))) return false
      }

      if (scriptPath === undefined) return false
      const runtimeDshManifest = await owningPackageManifest(scriptPath, '@deepseek-ai/dsh')
      if (runtimeDshManifest === undefined) return false
      if (!await sameExistingPath(location(snapshot, 'manifest:dsh'), runtimeDshManifest)) return false

      return true
    },
  })
}

/** Fail closed before the first Inspect query when the resolved target is not this running Host. */
export function bindContractEnrichmentToRuntimeTarget(
  enrichment: ContractEnrichmentPort,
  binding: DshRuntimeTargetBindingPort,
): ContractEnrichmentPort {
  return Object.freeze({
    async enrich(snapshot): Promise<AcquiredContractFacts> {
      return await binding.matches(snapshot)
        ? enrichment.enrich(snapshot)
        : EMPTY_ACQUIRED
    },
  })
}
