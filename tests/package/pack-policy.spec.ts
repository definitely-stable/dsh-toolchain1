import { describe, expect, it } from 'vitest'

import { checkPackFileList } from '../../scripts/check-pack.mjs'

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

describe('packed artifact policy', () => {
  it('accepts the minimal public package surface', () => {
    expect(checkPackFileList(validFiles)).toEqual([])
  })

  it('rejects missing runtime entry points', () => {
    const files = validFiles.filter(file => file !== 'package/lib/integrations/dsh/index.js')
    expect(checkPackFileList(files)).toContainEqual({
      rule: 'required-pack-file',
      path: 'package/lib/integrations/dsh/index.js',
      message: 'required packed file is missing',
    })
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
