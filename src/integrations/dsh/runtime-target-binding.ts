import { readFile, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AcquiredContractFacts, ContractEnrichmentPort } from '../../model/contract.js'
import type {
  Evidence,
  TargetResolveRequest,
  TargetResolveResult,
  TargetSnapshot,
} from '../../protocol/index.js'

/** Exact running-target predicate required before Host Inspect evidence may join one resolved snapshot. */
export interface DshRuntimeTargetBindingPort {
  matches(snapshot: TargetSnapshot): Promise<boolean>
}

/**
 * Immutable running-Host target epoch captured once when Toolchain mounts in a DSH Host.
 * The pair is the identity an implicit Agent Tool target binding is proven against.
 */
export interface DshStartupTargetIdentity {
  readonly targetFingerprint: string
  readonly lifecycleFingerprint?: string
}

/**
 * Why an omitted Agent Tool target could not be bound. Both codes are machine-readable contracts and
 * share one recovery: name a profile explicitly.
 */
export type DshTargetBindingErrorCode =
  | 'TARGET_RUNTIME_BINDING_UNAVAILABLE'
  | 'TARGET_RUNTIME_BINDING_CHANGED'

export class DshTargetBindingError extends Error {
  readonly code: DshTargetBindingErrorCode

  constructor(code: DshTargetBindingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DshTargetBindingError'
    this.code = code
  }
}

export interface DshAmbientTargetBindingPort {
  /**
   * Canonical target request for an explicit profile, or for the running Host target when the profile
   * is omitted. Rejects with `DshTargetBindingError` rather than guessing when the running target
   * cannot be proven, so a caller never silently operates on a target it did not ask for.
   */
  targetRequest(profile?: string): Promise<TargetResolveRequest>
}

export interface DshAmbientTargetBindingOptions {
  /**
   * Authoritative Host identity. Absent when the Host exposes no DSH home capability: an implicit
   * binding is then unprovable, while an explicit profile remains the caller's canonical request.
   */
  readonly host?: {
    readonly dshHome: string
    readonly runningProfile?: string
  }
  /** Immutable mount-time epoch; a rejected promise counts as an unproven binding. */
  readonly startupIdentity: Promise<DshStartupTargetIdentity | undefined>
  /** Read-only exact target acquisition through the shared kernel use case. */
  readonly resolveTarget: (request: TargetResolveRequest) => Promise<TargetResolveResult>
}

const EXPLICIT_PROFILE_RECOVERY = 'Pass an explicit profile to target a specific installation.'

function bindingUnavailable(message: string, options?: ErrorOptions): DshTargetBindingError {
  return new DshTargetBindingError(
    'TARGET_RUNTIME_BINDING_UNAVAILABLE',
    `${message} ${EXPLICIT_PROFILE_RECOVERY}`,
    options,
  )
}

/**
 * Bind Agent Tool calls that omit a target to the exact DSH target this Host is running in.
 *
 * The binding is the mount-time epoch and never a fresh read of mutable state. A profile that
 * changed after Toolchain mounted has an epoch this Host never observed, and answering from it would
 * mix epochs, so the call fails closed instead. `patchReload` deliberately does not relax that rule:
 * under `startup` the running tree is the mount-time composition, and under `live` the drifted files
 * are simply not the ones Toolchain proved at mount.
 */
export function createDshAmbientTargetBinding(
  options: DshAmbientTargetBindingOptions,
): DshAmbientTargetBindingPort {
  return Object.freeze({
    async targetRequest(profile?: string): Promise<TargetResolveRequest> {
      const host = options.host

      // An explicit profile stays inside the Host's own home when there is one: acquisition hints
      // are operator concerns, and a model-supplied path would let a call escape the installation
      // it runs in. Without a Host home the canonical request is exactly the caller's profile.
      if (profile !== undefined) {
        return Object.freeze(host === undefined ? { profile } : { profile, dshHome: host.dshHome })
      }
      if (host === undefined) {
        throw bindingUnavailable('This DSH Host does not expose an authoritative DSH home.')
      }

      const runningProfile = host.runningProfile
      if (runningProfile === undefined) {
        throw bindingUnavailable('This DSH Host was not started through a profile invocation Toolchain can prove.')
      }

      let identity: DshStartupTargetIdentity | undefined
      try {
        identity = await options.startupIdentity
      } catch (error) {
        throw bindingUnavailable('The startup target of this DSH Host could not be established.', { cause: error })
      }
      if (identity === undefined) {
        throw bindingUnavailable('The startup target of this DSH Host could not be established.')
      }

      const request = Object.freeze({ profile: runningProfile, dshHome: host.dshHome })
      let resolved: TargetResolveResult
      try {
        resolved = await options.resolveTarget(request)
      } catch (error) {
        throw bindingUnavailable('The running target of this DSH Host could not be resolved read-only.', {
          cause: error,
        })
      }

      const snapshot = resolved.snapshot
      // A lifecycle-aware mount epoch must match on both axes; a mount epoch without lifecycle
      // metadata must match a snapshot that also has none.
      if (
        snapshot.fingerprint !== identity.targetFingerprint
        || snapshot.profileLifecycle?.fingerprint !== identity.lifecycleFingerprint
      ) {
        throw new DshTargetBindingError(
          'TARGET_RUNTIME_BINDING_CHANGED',
          `The running DSH target changed since Toolchain mounted: ${
            identity.targetFingerprint
          } is no longer current. ${EXPLICIT_PROFILE_RECOVERY}`,
        )
      }
      return request
    },
  })
}

export interface DshRuntimeTargetBindingOptions {
  /** Root DSH Context base URL. App boot anchors this at the selected profile directory. */
  readonly baseUrl: string
  /** Authoritative value from the Host-provided `dshHomePath()` capability. */
  readonly dshHome: string
  /**
   * Immutable M1 fingerprint captured once when Toolchain mounts in this Host.
   * Absence fails closed; path identity alone is never sufficient for live evidence.
   */
  readonly startupTargetFingerprint?: string | Promise<string | undefined>
  /**
   * Immutable profile lifecycle fingerprint captured from the same startup snapshot.
   * Legacy trains omit both this value and snapshot lifecycle metadata.
   */
  readonly startupLifecycleFingerprint?: string | Promise<string | undefined>
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

/**
 * The running profile Toolchain can prove, or undefined when the invocation does not establish one.
 * Ordered `--patch` overlays disqualify a target: upstream publishes no boot-time overlay
 * attestation, so a later resolution could not be compared against what actually booted.
 */
export function provenRunningProfile(
  argv: readonly string[],
  cwd: string = process.cwd(),
): string | undefined {
  const launch = parseRunningDshProfileInvocation(argv, cwd)
  return launch === undefined || launch.patches.length !== 0 ? undefined : launch.profile
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

async function packageNameAt(manifestPath: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: unknown }
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

function snapshotEvidenceLocation(snapshot: TargetSnapshot, evidenceId: string): string | undefined {
  const evidence = evidenceById(snapshot, evidenceId)
  return typeof evidence?.location === 'string' ? evidence.location : undefined
}

async function matchesStartupFingerprint(
  startupTargetFingerprint: DshRuntimeTargetBindingOptions['startupTargetFingerprint'],
  snapshot: TargetSnapshot,
): Promise<boolean> {
  if (startupTargetFingerprint === undefined) return false
  try {
    const fingerprint = await startupTargetFingerprint
    return fingerprint !== undefined && fingerprint === snapshot.fingerprint
  } catch {
    return false
  }
}

async function matchesStartupLifecycleFingerprint(
  startupLifecycleFingerprint: DshRuntimeTargetBindingOptions['startupLifecycleFingerprint'],
  snapshot: TargetSnapshot,
): Promise<boolean> {
  const snapshotFingerprint = snapshot.profileLifecycle?.fingerprint
  if (startupLifecycleFingerprint === undefined) return snapshotFingerprint === undefined
  try {
    return await startupLifecycleFingerprint === snapshotFingerprint
  } catch {
    return false
  }
}

/**
 * Build a conservative automatic binding for the official DSH launcher.
 *
 * Path/runtime checks prove this is the same process/profile installation.
 * Startup composition and lifecycle fingerprints freeze the semantic epochs
 * observed when Toolchain mounted; later same-path filesystem/HMR drift therefore
 * disables live enrichment instead of mixing old runtime evidence with a new
 * TargetSnapshot. Current upstream still lacks a launcher-owned composition
 * generation attestation, so explicit overlays remain unsupported here.
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
      // Frozen startup semantic baselines are the byte- and lifecycle-sensitive guards.
      // Never upgrade a path-only match to live evidence when either required epoch differs.
      if (!await matchesStartupFingerprint(options.startupTargetFingerprint, snapshot)) return false
      if (!await matchesStartupLifecycleFingerprint(options.startupLifecycleFingerprint, snapshot)) return false

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
      if (!await sameExistingPath(snapshotEvidenceLocation(snapshot, 'manifest:profile'), join(profileDirectory, 'package.json'))) {
        return false
      }
      if (!await sameExistingPath(snapshotEvidenceLocation(snapshot, 'patch:profile'), join(profileDirectory, 'cordis.patch.yml'))) {
        // Optional target patches still record the canonical expected location;
        // absence is represented by an observed sentinel hash, so compare the
        // parent profile path when the file itself is absent.
        const profilePatch = snapshotEvidenceLocation(snapshot, 'patch:profile')
        if (profilePatch === undefined || resolve(profilePatch) !== resolve(join(profileDirectory, 'cordis.patch.yml'))) {
          return false
        }
      }
      if (!await sameExistingPath(snapshotEvidenceLocation(snapshot, 'patch:home'), join(home, 'cordis.patch.yml'))) {
        const homePatch = snapshotEvidenceLocation(snapshot, 'patch:home')
        if (homePatch === undefined || resolve(homePatch) !== resolve(join(home, 'cordis.patch.yml'))) return false
      }

      if (scriptPath === undefined) return false
      const runtimeDshManifest = await owningPackageManifest(scriptPath, '@deepseek-ai/dsh')
      if (runtimeDshManifest === undefined) return false
      if (!await sameExistingPath(snapshotEvidenceLocation(snapshot, 'manifest:dsh'), runtimeDshManifest)) return false

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
    async enrich(snapshot: TargetSnapshot): Promise<AcquiredContractFacts> {
      return await binding.matches(snapshot)
        ? enrichment.enrich(snapshot)
        : EMPTY_ACQUIRED
    },
  })
}
