import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { checkPackageManifest } from '../../scripts/check-package-policy.mjs'

const root = new URL('../../', import.meta.url)

describe('package policy', () => {
  it('rejects nested host-identity packages and install-time lifecycle scripts', () => {
    const violations = checkPackageManifest({
      dependencies: { '@deepseek-ai/cordis': '4.0.1' },
      scripts: { prepare: 'tsc', postinstall: 'node setup.js' },
    })

    expect(violations.map((violation) => violation.rule)).toEqual([
      'host-peer-identity',
      'host-peer-identity',
      'install-time-script',
      'install-time-script',
    ])
  })

  it('accepts a host identity package only when the tested dev version satisfies its peer range', () => {
    expect(checkPackageManifest({
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      devDependencies: { '@deepseek-ai/cordis': '4.0.1' },
      scripts: { prepack: 'pnpm build' },
    })).toEqual([])

    expect(checkPackageManifest({
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      devDependencies: { '@deepseek-ai/cordis': '5.0.0' },
    })).toContainEqual({
      rule: 'host-peer-dev-version',
      message: '@deepseek-ai/cordis devDependency 5.0.0 must satisfy peerDependency ^4.0.1',
    })
  })

  it('keeps repository policy scripts inside lint and JavaScript static checking', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(manifest.scripts?.lint).toContain('scripts')
    expect(manifest.scripts?.['check:scripts']).toBe('tsc -p tsconfig.scripts.json --noEmit')
    expect(manifest.scripts?.check).toContain('check:scripts')
  })

  it('keeps the real package manifest policy-clean', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    expect(checkPackageManifest(manifest)).toEqual([])
  })
})
