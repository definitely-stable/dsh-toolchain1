import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { checkPackageManifest } from '../../scripts/check-package-policy.mjs'

const root = new URL('../../', import.meta.url)

describe('package policy', () => {
  it('rejects nested Cordis and install-time lifecycle scripts', () => {
    const violations = checkPackageManifest({
      dependencies: { '@deepseek-ai/cordis': '4.0.1' },
      scripts: { prepare: 'tsc', postinstall: 'node setup.js' },
    })

    expect(violations.map((violation) => violation.rule)).toEqual([
      'cordis-peer-identity',
      'cordis-peer-identity',
      'install-time-script',
      'install-time-script',
    ])
  })

  it('accepts Cordis as peer plus dev only', () => {
    expect(checkPackageManifest({
      peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
      devDependencies: { '@deepseek-ai/cordis': '4.0.1' },
      scripts: { prepack: 'pnpm build' },
    })).toEqual([])
  })

  it('keeps the real package manifest policy-clean', async () => {
    const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    expect(checkPackageManifest(manifest)).toEqual([])
  })
})
