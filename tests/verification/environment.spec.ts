import { describe, expect, it } from 'vitest'

import { createSafeVerificationEnvironment } from '../../src/verification/environment.js'

const coordinates = Object.freeze({
  dshHome: '/verification/dsh-home',
  userHome: '/verification/home',
  tempDir: '/verification/tmp',
})

describe('safe verification environment', () => {
  it('inherits only the explicit process-bootstrap allowlist and forces Toolchain-owned coordinates', () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      Path: 'C:\\Tools',
      SystemRoot: 'C:\\Windows',
      SYSTEMROOT: 'C:\\WINDOWS',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE',
      WINDIR: 'C:\\Windows',
      HOME: '/real/home',
      USERPROFILE: 'C:\\Users\\real',
      DSH_HOME: '/real/dsh',
      TMPDIR: '/real/tmp',
      TMP: '/real/tmp',
      TEMP: '/real/tmp',
      CI: 'false',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '1',
      OPENAI_API_KEY: 'secret-openai',
      ANTHROPIC_API_KEY: 'secret-anthropic',
      NPM_TOKEN: 'secret-npm',
      NODE_AUTH_TOKEN: 'secret-node-auth',
      AWS_SECRET_ACCESS_KEY: 'secret-aws',
      HTTPS_PROXY: 'http://user:password@example.test:8080',
      HTTP_PROXY: 'http://user:password@example.test:8080',
      NO_PROXY: '*',
      GITHUB_TOKEN: 'secret-github',
      CUSTOM_USER_VARIABLE: 'must-not-cross-boundary',
    }

    const result = createSafeVerificationEnvironment(parent, coordinates)

    expect(result).toEqual({
      PATH: '/usr/bin:/bin',
      Path: 'C:\\Tools',
      SystemRoot: 'C:\\Windows',
      SYSTEMROOT: 'C:\\WINDOWS',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE',
      WINDIR: 'C:\\Windows',
      CI: 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      DSH_HOME: coordinates.dshHome,
      HOME: coordinates.userHome,
      USERPROFILE: coordinates.userHome,
      TMPDIR: coordinates.tempDir,
      TMP: coordinates.tempDir,
      TEMP: coordinates.tempDir,
    })
  })

  it('does not manufacture absent bootstrap values', () => {
    expect(createSafeVerificationEnvironment({}, coordinates)).toEqual({
      CI: 'true',
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      DSH_HOME: coordinates.dshHome,
      HOME: coordinates.userHome,
      USERPROFILE: coordinates.userHome,
      TMPDIR: coordinates.tempDir,
      TMP: coordinates.tempDir,
      TEMP: coordinates.tempDir,
    })
  })

  it('drops empty bootstrap values rather than forwarding unusable process coordinates', () => {
    const result = createSafeVerificationEnvironment({
      PATH: '',
      SystemRoot: undefined,
      COMSPEC: '',
      WINDIR: 'C:\\Windows',
    }, coordinates)

    expect(result).not.toHaveProperty('PATH')
    expect(result).not.toHaveProperty('SystemRoot')
    expect(result).not.toHaveProperty('COMSPEC')
    expect(result.WINDIR).toBe('C:\\Windows')
  })

  it('rejects empty Toolchain-owned coordinates', () => {
    for (const invalid of [
      { ...coordinates, dshHome: '' },
      { ...coordinates, userHome: '' },
      { ...coordinates, tempDir: '' },
    ]) {
      expect(() => createSafeVerificationEnvironment({}, invalid)).toThrow(/verification|coordinate|path/i)
    }
  })
})
