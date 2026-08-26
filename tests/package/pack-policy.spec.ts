import { describe, expect, it } from 'vitest'

import {
  checkPackFileList,
  checkPackedManifest,
} from '../../scripts/check-pack.mjs'

const validFiles = [
  'package/package.json',
  'package/cordis.patch.yml',
  'package/README.md',
  'package/LICENSE',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/integrations/dsh/index.js',
  'package/lib/integrations/dsh/index.d.ts',
  'package/lib/protocol/index.js',
  'package/lib/protocol/index.d.ts',
  'package/lib/frontends/cli/bin.js',
  'package/lib/frontends/mcp/bin.js',
  'package/spec/schemas/v1/toolchain-protocol.schema.json',
]

const validManifest = {
  main: './lib/index.js',
  types: './lib/index.d.ts',
  exports: {
    '.': {
      types: './lib/index.d.ts',
      default: './lib/index.js',
    },
    './dsh': {
      types: './lib/integrations/dsh/index.d.ts',
      default: './lib/integrations/dsh/index.js',
    },
    './protocol': {
      types: './lib/protocol/index.d.ts',
      default: './lib/protocol/index.js',
    },
    './package.json': './package.json',
  },
  bin: {
    'dsh-toolchain': './lib/frontends/cli/bin.js',
    'dsh-toolchain-mcp': './lib/frontends/mcp/bin.js',
  },
  dsh: {
    bundle: {
      patch: './cordis.patch.yml',
    },
  },
}

describe('packed artifact policy', () => {
  it('accepts the minimal public package surface', () => {
    expect(checkPackFileList(validFiles)).toEqual([])
    expect(checkPackedManifest(validManifest, validFiles)).toEqual([])
  })

  it('derives runtime requirements from packed exports and bins instead of a second hardcoded list', () => {
    const brokenManifest = structuredClone(validManifest)
    brokenManifest.exports['./protocol'].default = './lib/protocol/missing.js'
    brokenManifest.bin['dsh-toolchain'] = './lib/frontends/cli/missing.js'

    expect(checkPackedManifest(brokenManifest, validFiles)).toEqual([
      {
        rule: 'manifest-target-missing',
        path: 'package/lib/protocol/missing.js',
        source: 'exports',
        message: 'packed manifest target does not exist in the tarball',
      },
      {
        rule: 'manifest-target-missing',
        path: 'package/lib/frontends/cli/missing.js',
        source: 'bin',
        message: 'packed manifest target does not exist in the tarball',
      },
    ])
  })

  it('rejects manifest targets that can escape the package or require unsupported wildcard interpretation', () => {
    const unsafeManifest = structuredClone(validManifest)
    unsafeManifest.main = '../outside.js'
    unsafeManifest.exports['./protocol'].default = './lib/protocol/*.js'

    expect(checkPackedManifest(unsafeManifest, validFiles)).toEqual([
      {
        rule: 'manifest-target-unsafe',
        path: '../outside.js',
        source: 'main',
        message: 'packed manifest target must resolve to one concrete file inside the package',
      },
      {
        rule: 'manifest-target-unsafe',
        path: './lib/protocol/*.js',
        source: 'exports',
        message: 'packed manifest target must resolve to one concrete file inside the package',
      },
    ])
  })

  it('rejects source, CI, tests, scripts, and private planning material', () => {
    const issues = checkPackFileList([
      ...validFiles,
      'package/src/kernel/index.ts',
      'package/tests/kernel/kernel.spec.ts',
      'package/.github/workflows/ci.yml',
      'package/scripts/check-pack.mjs',
      'package/docs/plans/private-plan.md',
      'package/spec/protocol.md',
    ])

    expect(issues.map(issue => issue.rule)).toEqual([
      'forbidden-pack-path',
      'forbidden-pack-path',
      'forbidden-pack-path',
      'forbidden-pack-path',
      'forbidden-pack-path',
      'forbidden-pack-path',
    ])
  })
})
