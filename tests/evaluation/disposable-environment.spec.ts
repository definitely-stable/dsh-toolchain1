import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  DISPOSABLE_DIRECTORY_KEYS,
  buildDisposableEnvironment,
  createDisposableCoordinates,
  ensureDisposableCoordinates,
  ephemeralBootArgs,
} from '../../scripts/eval/safety/disposable-environment.mjs'

const TEST_ROOT = resolve('.artifacts/disposable-environment-tests')

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('disposable coordinates', () => {
  it('places every writable coordinate under the disposable root', () => {
    const root = join(TEST_ROOT, 'observation-1')
    const coordinates = createDisposableCoordinates({ root })
    ensureDisposableCoordinates(coordinates)
    const values = coordinates as unknown as Record<string, string>

    for (const key of DISPOSABLE_DIRECTORY_KEYS) {
      const value = values[key]
      expect(typeof value).toBe('string')
      expect(value!.startsWith(resolve(root))).toBe(true)
    }
    expect(existsSync(coordinates.dshHome)).toBe(true)
    expect(existsSync(coordinates.tempDir)).toBe(true)
    expect(existsSync(coordinates.userHome)).toBe(true)
  })
})

describe('disposable environment', () => {
  const coordinates = createDisposableCoordinates({ root: join(TEST_ROOT, 'observation-2') })
  type Environment = Record<string, string | undefined>

  function build(parent: Environment, extra?: Environment): Environment {
    return buildDisposableEnvironment({ parent, coordinates, ...(extra === undefined ? {} : { extra }) }) as Environment
  }

  it('redirects home, temp, DSH home, and package-manager coordinates', () => {
    const environment = build({ PATH: 'C:\\tools', USERPROFILE: 'C:\\Users\\operator', HOME: 'C:\\Users\\operator', TEMP: 'C:\\Temp' })

    expect(environment.PATH).toBe('C:\\tools')
    expect(environment.HOME).toBe(coordinates.userHome)
    expect(environment.USERPROFILE).toBe(coordinates.userHome)
    expect(environment.TEMP).toBe(coordinates.tempDir)
    expect(environment.TMP).toBe(coordinates.tempDir)
    expect(environment.TMPDIR).toBe(coordinates.tempDir)
    expect(environment.DSH_HOME).toBe(coordinates.dshHome)
    expect(environment.PNPM_HOME).toBe(coordinates.pnpmHome)
    expect(environment.npm_config_cache).toBe(coordinates.npmCache)
    expect(environment.LOCALAPPDATA).toBe(coordinates.localAppData)
    expect(environment.XDG_CONFIG_HOME).toBe(coordinates.xdgConfig)
    expect(environment.COREPACK_HOME).toBe(coordinates.corepackHome)
  })

  it('never inherits an operator variable outside the bootstrap allowlist', () => {
    const environment = build({
      PATH: 'C:\\tools',
      OPENCODE_GO_API_KEY: 'secret-value',
      H2_DATASET_DIR: 'D:\\h2-private\\h2-dataset-v1',
      NODE_OPTIONS: '--max-old-space-size=4096',
      DSH_PERMISSION_MODE: 'danger-full-access',
    })

    expect(Object.keys(environment)).not.toContain('OPENCODE_GO_API_KEY')
    expect(Object.keys(environment)).not.toContain('H2_DATASET_DIR')
    expect(Object.keys(environment)).not.toContain('NODE_OPTIONS')
    expect(environment.DSH_PERMISSION_MODE).toBeUndefined()
    expect(JSON.stringify(environment)).not.toContain('secret-value')
  })

  it('applies caller extras after the disposable defaults', () => {
    const environment = build({}, { DSH_PERMISSION_MODE: 'workspace-write', H2_OBSERVATION: 'task-1' })

    expect(environment.DSH_PERMISSION_MODE).toBe('workspace-write')
    expect(environment.H2_OBSERVATION).toBe('task-1')
  })

  it('refuses incomplete coordinates instead of falling back to the operator environment', () => {
    expect(() => buildDisposableEnvironment({ parent: {}, coordinates: { dshHome: 'x' } as never })).toThrow(/missing/)
  })
})

describe('ephemeral boot arguments', () => {
  it('forces a headless ephemeral port for the web profile only', () => {
    expect(ephemeralBootArgs('web')).toEqual(['--no-open', '--port', '0'])
    expect(ephemeralBootArgs('acp')).toEqual([])
  })
})
