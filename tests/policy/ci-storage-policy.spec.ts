import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { checkCiStoragePolicy } from '../../scripts/check-ci-storage-policy.mjs'

const root = new URL('../../', import.meta.url)

const bootstrap = `
      - name: Install pnpm
        uses: pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2 # v2.0.2
        with:
          install: false

      - name: Set up Node
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: '24.19.0'
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
          package-manager-cache: false
`

describe('CI storage policy', () => {
  it('accepts explicit pnpm-store caching with an authoritative frozen install', () => {
    expect(checkCiStoragePolicy(`jobs:\n  primary:\n    steps:${bootstrap}`)).toEqual([])
  })

  it('rejects broad dependency/build caches and persistent product artifacts', () => {
    const violations = checkCiStoragePolicy(`jobs:
  primary:
    steps:${bootstrap}
      - uses: actions/cache@1111111111111111111111111111111111111111
        with:
          path: node_modules
          key: broad-cache
      - uses: actions/upload-artifact@2222222222222222222222222222222222222222
        with:
          name: package
          path: .artifacts/dsh-toolchain.tgz
          retention-days: 7
`)

    expect(violations.map((violation) => violation.rule)).toEqual([
      'direct-cache-action',
      'artifact-retention',
      'product-artifact-persistence',
      'product-artifact-persistence',
    ])
  })

  it('rejects implicit or incorrectly keyed pnpm caches', () => {
    const source = `jobs:
  primary:
    steps:
      - name: Install pnpm
        uses: pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2
        with:
          install: true
          cache: true
      - name: Set up Node
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444
        with:
          node-version: '24.19.0'
          cache: pnpm
          cache-dependency-path: package.json
`

    expect(checkCiStoragePolicy(source).map((violation) => violation.rule)).toEqual([
      'pnpm-bootstrap-install',
      'pnpm-bootstrap-cache',
      'pnpm-cache-config',
      'pnpm-cache-config',
    ])
  })

  it('keeps the required repository CI storage-policy clean', async () => {
    const workflow = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')
    expect(checkCiStoragePolicy(workflow)).toEqual([])
  })
})
