export interface VerificationEnvironmentCoordinates {
  readonly dshHome: string
  readonly userHome: string
  readonly tempDir: string
}

const BOOTSTRAP_ENVIRONMENT_KEYS = Object.freeze([
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'WINDIR',
] as const)

function assertCoordinate(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`Verification ${name} coordinate must be a non-empty path.`)
  }
}

/**
 * Builds the default M4.1 candidate-process environment.
 *
 * This is configuration and credential isolation, not a malicious-code sandbox:
 * candidate code can still access resources that the operating system allows.
 */
export function createSafeVerificationEnvironment(
  parent: Readonly<NodeJS.ProcessEnv>,
  coordinates: VerificationEnvironmentCoordinates,
): NodeJS.ProcessEnv {
  assertCoordinate('DSH_HOME', coordinates.dshHome)
  assertCoordinate('HOME', coordinates.userHome)
  assertCoordinate('temporary-directory', coordinates.tempDir)

  const environment: NodeJS.ProcessEnv = {}
  for (const key of BOOTSTRAP_ENVIRONMENT_KEYS) {
    const value = parent[key]
    if (value !== undefined && value.length > 0) environment[key] = value
  }

  environment.CI = 'true'
  environment.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  environment.DSH_HOME = coordinates.dshHome
  environment.HOME = coordinates.userHome
  environment.USERPROFILE = coordinates.userHome
  environment.TMPDIR = coordinates.tempDir
  environment.TMP = coordinates.tempDir
  environment.TEMP = coordinates.tempDir

  return environment
}
