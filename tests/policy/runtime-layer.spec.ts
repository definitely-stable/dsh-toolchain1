import { describe, expect, it } from 'vitest'

import { checkSourceImportPolicy } from '../../scripts/check-architecture.mjs'

describe('runtime utility layer policy', () => {
  it('allows acquisition and verification to share Node runtime primitives without opening a semantic bridge', () => {
    const runtime = {
      path: 'src/runtime/packed-archive.ts',
      source: "import path from 'node:path'\nexport const parse = path.posix.normalize\n",
    }
    const acquisition = {
      path: 'src/acquisition/plugin-packed.ts',
      source: "import { parse } from '../runtime/packed-archive.js'\nexport { parse }\n",
    }
    const verification = {
      path: 'src/verification/packed-artifact-inspection.ts',
      source: "import { parse } from '../runtime/packed-archive.js'\nexport { parse }\n",
    }

    expect(checkSourceImportPolicy([runtime, acquisition, verification])).toEqual([])
    expect(checkSourceImportPolicy([
      runtime,
      {
        path: 'src/kernel/bad-runtime.ts',
        source: "import { parse } from '../runtime/packed-archive.js'\nexport { parse }\n",
      },
    ])).toContainEqual({
      file: 'src/kernel/bad-runtime.ts',
      specifier: '../runtime/packed-archive.js',
      target: 'src/runtime/packed-archive.ts',
      rule: 'dependency-layer',
    })
  })
})
