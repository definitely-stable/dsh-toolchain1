import { describe, expect, it } from 'vitest'

import { checkSourceImportPolicy } from '../../scripts/check-architecture.mjs'

describe('architecture import policy', () => {
  it('rejects host/runtime IO dependencies from pure layers', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/bad.ts', source: "import { readFile } from 'node:fs/promises'\n" },
      { path: 'src/protocol/bad.ts', source: "export * from '@deepseek-ai/cordis'\n" },
    ])).toEqual([
      {
        file: 'src/kernel/bad.ts',
        specifier: 'node:fs/promises',
        rule: 'pure-layer-runtime-boundary',
      },
      {
        file: 'src/protocol/bad.ts',
        specifier: '@deepseek-ai/cordis',
        rule: 'pure-layer-runtime-boundary',
      },
    ])
  })

  it('rejects inward layers importing frontend/integration implementations', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/bad.ts', source: "import '../../src/frontends/cli/index.js'\n" },
    ])).toEqual([
      {
        file: 'src/kernel/bad.ts',
        specifier: '../../src/frontends/cli/index.js',
        rule: 'dependency-direction',
      },
    ])
  })

  it('reserves the browser client boundary against Node and Host implementations', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/client/bad-node.ts', source: "import { readFile } from 'node:fs/promises'\n" },
      { path: 'src/client/bad-host.ts', source: "import '../integrations/dsh/index.js'\n" },
    ])).toEqual([
      {
        file: 'src/client/bad-node.ts',
        specifier: 'node:fs/promises',
        rule: 'client-runtime-boundary',
      },
      {
        file: 'src/client/bad-host.ts',
        specifier: '../integrations/dsh/index.js',
        rule: 'client-host-boundary',
      },
    ])
  })

  it('accepts the intended inward dependency direction', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/frontends/cli/index.ts', source: "import { createApplicationKernel } from '../../kernel/index.js'\n" },
      { path: 'src/integrations/dsh/index.ts', source: "import { Service } from '@deepseek-ai/cordis'\nimport { createApplicationKernel } from '../../kernel/index.js'\n" },
    ])).toEqual([])
  })
})
