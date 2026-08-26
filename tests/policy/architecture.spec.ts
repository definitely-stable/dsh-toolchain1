import { describe, expect, it } from 'vitest'

import {
  checkSourceImportPolicy,
  isArchitectureSourceFile,
} from '../../scripts/check-architecture.mjs'

describe('architecture import policy', () => {
  it('rejects Node builtins and DSH runtime dependencies from pure layers', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/bad.ts', source: "import { readFile } from 'fs/promises'\n" },
      { path: 'src/model/bad.mts', source: "import path from 'node:path'\n" },
      { path: 'src/protocol/bad.ts', source: "export * from '@deepseek-ai/cordis'\n" },
    ])).toEqual([
      {
        file: 'src/kernel/bad.ts',
        specifier: 'fs/promises',
        rule: 'pure-layer-runtime-boundary',
      },
      {
        file: 'src/model/bad.mts',
        specifier: 'node:path',
        rule: 'pure-layer-runtime-boundary',
      },
      {
        file: 'src/protocol/bad.ts',
        specifier: '@deepseek-ai/cordis',
        rule: 'pure-layer-runtime-boundary',
      },
    ])
  })

  it('rejects inward layers importing frontend/integration implementations by relative or package self-reference', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/bad.ts', source: "import '../../src/frontends/cli/index.js'\n" },
      { path: 'src/model/bad.ts', source: "import 'dsh-toolchain/dsh'\n" },
    ])).toEqual([
      {
        file: 'src/kernel/bad.ts',
        specifier: '../../src/frontends/cli/index.js',
        rule: 'dependency-direction',
      },
      {
        file: 'src/model/bad.ts',
        specifier: 'dsh-toolchain/dsh',
        rule: 'dependency-direction',
      },
    ])
  })

  it('reserves browser/client code against every Node builtin and Host implementation', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/client/bad-node.tsx', source: "import path from 'path'\nexport const value = <div />\n" },
      { path: 'src/frontends/web/bad-node.ts', source: "import 'node:fs'\n" },
      { path: 'src/client/bad-host.ts', source: "import '../integrations/dsh/index.js'\n" },
      { path: 'src/frontends/web/bad-self.ts', source: "import 'dsh-toolchain/dsh'\n" },
    ])).toEqual([
      {
        file: 'src/client/bad-node.tsx',
        specifier: 'path',
        rule: 'client-runtime-boundary',
      },
      {
        file: 'src/frontends/web/bad-node.ts',
        specifier: 'node:fs',
        rule: 'client-runtime-boundary',
      },
      {
        file: 'src/client/bad-host.ts',
        specifier: '../integrations/dsh/index.js',
        rule: 'client-host-boundary',
      },
      {
        file: 'src/frontends/web/bad-self.ts',
        specifier: 'dsh-toolchain/dsh',
        rule: 'client-host-boundary',
      },
    ])
  })

  it('scans TypeScript source extensions used by Node and DSH Web', () => {
    expect(['file.ts', 'file.tsx', 'file.mts', 'file.cts'].map(isArchitectureSourceFile)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(isArchitectureSourceFile('file.js')).toBe(false)
    expect(isArchitectureSourceFile('README.md')).toBe(false)
  })

  it('accepts the intended inward dependency direction', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/frontends/cli/index.ts', source: "import { createApplicationKernel } from '../../kernel/index.js'\n" },
      { path: 'src/integrations/dsh/index.ts', source: "import { Service } from '@deepseek-ai/cordis'\nimport { createApplicationKernel } from '../../kernel/index.js'\n" },
    ])).toEqual([])
  })
})
