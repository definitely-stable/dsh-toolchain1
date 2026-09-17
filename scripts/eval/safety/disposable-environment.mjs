import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One disposable environment for every process a benchmark spawns.
 *
 * The H2 incident on 16 September lost the operator's DSH home, and the only
 * coordinate that was redirected at the time was `DSH_HOME`: the agent, the
 * graders, the launcher and pnpm all inherited the operator's `HOME`,
 * `USERPROFILE`, `TEMP` and package-manager caches. A bug — or a destructive
 * command — anywhere in that tree therefore had the operator's real home in
 * reach, which is exactly what "isolated" must exclude.
 *
 * This module gives every spawned process a home, a temp directory and a
 * package-manager cache inside the disposable workspace, and passes an
 * allowlist of bootstrap variables only. The product's own verification worker
 * (`src/verification/environment.ts`) already works this way; evaluation code is
 * kept separate from products and therefore mirrors the policy instead of
 * importing it.
 */

/**
 * Variables a child needs to start a process at all. Everything else — proxies,
 * credentials, node options, editor state — stays out of the child, because
 * inheriting it is how a benchmark stops being reproducible and how an operator
 * home becomes reachable.
 */
export const DISPOSABLE_BOOTSTRAP_KEYS = Object.freeze([
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'SystemDrive',
  'SYSTEMDRIVE',
  'windir',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
])

/** Directories a spawned process may write into. All of them live under one root. */
export const DISPOSABLE_DIRECTORY_KEYS = Object.freeze([
  'dshHome',
  'userHome',
  'tempDir',
  'pnpmHome',
  'npmCache',
  'corepackHome',
  'npmState',
  'xdgCache',
  'xdgConfig',
  'xdgData',
  'xdgState',
  'appData',
  'localAppData',
])

/**
 * @param {{root: string}} input
 */
export function createDisposableCoordinates({ root }) {
  if (typeof root !== 'string' || root.trim().length === 0) throw new Error('disposable coordinates require a root directory')
  return Object.freeze({
    root,
    dshHome: join(root, 'dsh-home'),
    userHome: join(root, 'user-home'),
    tempDir: join(root, 'tmp'),
    pnpmHome: join(root, 'pnpm-home'),
    npmCache: join(root, 'npm-cache'),
    corepackHome: join(root, 'corepack'),
    npmState: join(root, 'npm-state'),
    xdgCache: join(root, 'xdg-cache'),
    xdgConfig: join(root, 'xdg-config'),
    xdgData: join(root, 'xdg-data'),
    xdgState: join(root, 'xdg-state'),
    appData: join(root, 'user-home', 'AppData', 'Roaming'),
    localAppData: join(root, 'user-home', 'AppData', 'Local'),
  })
}

/** Creates every disposable directory before a child process can need it. */
export function ensureDisposableCoordinates(coordinates) {
  for (const key of DISPOSABLE_DIRECTORY_KEYS) mkdirSync(coordinates[key], { recursive: true })
  return coordinates
}

/**
 * Builds the complete environment for a spawned process: bootstrap allowlist,
 * disposable coordinates, and a caller's explicit extras. Nothing is inherited
 * implicitly, so a new operator variable cannot leak into an observation.
 *
 * @param {{parent?: Record<string, string | undefined>, coordinates: any,
 *   extra?: Record<string, string | undefined>, bootstrapKeys?: readonly string[]}} input
 */
export function buildDisposableEnvironment({ parent = process.env, coordinates, extra = {}, bootstrapKeys = DISPOSABLE_BOOTSTRAP_KEYS }) {
  if (coordinates === null || typeof coordinates !== 'object') throw new Error('disposable environment requires coordinates')
  for (const key of DISPOSABLE_DIRECTORY_KEYS) {
    if (typeof coordinates[key] !== 'string' || coordinates[key].length === 0) throw new Error(`disposable coordinates are missing ${key}`)
  }

  const environment = {}
  for (const key of bootstrapKeys) {
    const value = parent[key]
    if (typeof value === 'string' && value.length > 0) environment[key] = value
  }

  environment.CI = 'true'
  environment.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  environment.DSH_HOME = coordinates.dshHome
  environment.HOME = coordinates.userHome
  environment.USERPROFILE = coordinates.userHome
  environment.TEMP = coordinates.tempDir
  environment.TMP = coordinates.tempDir
  environment.TMPDIR = coordinates.tempDir
  environment.APPDATA = coordinates.appData
  environment.LOCALAPPDATA = coordinates.localAppData
  environment.XDG_CACHE_HOME = coordinates.xdgCache
  environment.XDG_CONFIG_HOME = coordinates.xdgConfig
  environment.XDG_DATA_HOME = coordinates.xdgData
  environment.XDG_STATE_HOME = coordinates.xdgState
  environment.PNPM_HOME = coordinates.pnpmHome
  environment.npm_config_cache = coordinates.npmCache
  environment.npm_config_state_dir = coordinates.npmState
  environment.COREPACK_HOME = coordinates.corepackHome
  environment.PNPM_STORE_DIR = join(coordinates.root, 'pnpm-store')

  return { ...environment, ...extra }
}

/**
 * A web-profile boot must never open a browser or race for a fixed port; port 0
 * asks the target for an ephemeral one. Kept here so every evaluation path uses
 * the same rule instead of re-deciding it per script.
 *
 * @param {string} profile
 * @param {{webProfiles?: readonly string[]}} [options]
 */
export function ephemeralBootArgs(profile, { webProfiles = ['web'] } = {}) {
  return webProfiles.includes(profile) ? ['--no-open', '--port', '0'] : []
}
