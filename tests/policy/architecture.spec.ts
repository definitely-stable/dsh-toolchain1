import { describe, expect, it } from 'vitest'

import {
  checkSourceImportPolicy,
  isArchitectureSourceFile,
} from '../../scripts/check-architecture.mjs'

describe('architecture import policy', () => {
  it('rejects runtime packages, arbitrary externals, and package self-reference from semantic layers', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/bad.ts', source: "import { readFile } from 'fs/promises'\n" },
      { path: 'src/model/bad.mts', source: "import path from 'node:path'\n" },
      { path: 'src/protocol/bad.ts', source: "export * from '@deepseek-ai/cordis'\n" },
      { path: 'src/kernel/mcp.ts', source: "import '@modelcontextprotocol/server'\n" },
      { path: 'src/kernel/self.ts', source: "import 'dsh-toolchain/dsh'\n" },
    ])).toEqual([
      {
        file: 'src/kernel/bad.ts',
        specifier: 'fs/promises',
        rule: 'semantic-runtime-boundary',
      },
      {
        file: 'src/model/bad.mts',
        specifier: 'node:path',
        rule: 'semantic-runtime-boundary',
      },
      {
        file: 'src/protocol/bad.ts',
        specifier: '@deepseek-ai/cordis',
        rule: 'semantic-runtime-boundary',
      },
      {
        file: 'src/kernel/mcp.ts',
        specifier: '@modelcontextprotocol/server',
        rule: 'semantic-external-dependency',
      },
      {
        file: 'src/kernel/self.ts',
        specifier: 'dsh-toolchain/dsh',
        rule: 'dependency-layer',
      },
    ])
  })

  it('rejects unclassified production layers and therefore closes transitive runtime bridges', () => {
    const violations = checkSourceImportPolicy([
      { path: 'src/kernel/target.ts', source: "import { load } from '../shared/environment.js'\nexport { load }\n" },
      { path: 'src/shared/environment.ts', source: "import { readFile } from 'node:fs/promises'\nexport const load = readFile\n" },
    ])

    expect(violations).toContainEqual({
      file: 'src/shared/environment.ts',
      rule: 'unclassified-source-layer',
    })
    expect(violations).toContainEqual({
      file: 'src/kernel/target.ts',
      specifier: '../shared/environment.js',
      target: 'src/shared/environment.ts',
      rule: 'dependency-layer',
    })
  })

  it('rejects JavaScript production source even when it is imported through a .js specifier', () => {
    expect(isArchitectureSourceFile('file.js')).toBe(true)
    expect(checkSourceImportPolicy([
      { path: 'src/kernel/index.ts', source: "import './node-runtime.js'\n" },
      { path: 'src/kernel/node-runtime.js', source: "import { readFile } from 'node:fs/promises'\nvoid readFile\n" },
    ])).toContainEqual({
      file: 'src/kernel/node-runtime.js',
      rule: 'unsupported-production-source',
    })
  })

  it('rejects direct runtime globals and non-literal loaders from semantic code', () => {
    const violations = checkSourceImportPolicy([
      { path: 'src/kernel/process.ts', source: "export const cwd = process.cwd()\n" },
      { path: 'src/kernel/buffer.ts', source: "export const bytes = Buffer.from('x')\n" },
      { path: 'src/kernel/network.ts', source: "export const load = () => fetch('https://example.invalid')\n" },
      { path: 'src/model/loader.ts', source: "export const load = (name: string) => import(name)\n" },
    ])

    expect(violations).toContainEqual({
      file: 'src/kernel/process.ts',
      symbol: 'process',
      rule: 'semantic-runtime-global',
    })
    expect(violations).toContainEqual({
      file: 'src/kernel/buffer.ts',
      symbol: 'Buffer',
      rule: 'semantic-runtime-global',
    })
    expect(violations).toContainEqual({
      file: 'src/kernel/network.ts',
      symbol: 'fetch',
      rule: 'semantic-runtime-global',
    })
    expect(violations).toContainEqual({
      file: 'src/model/loader.ts',
      symbol: 'import()',
      rule: 'semantic-dynamic-loader',
    })
  })

  it('reserves browser/client code against every Node builtin and Host implementation', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/client/bad-node.tsx', source: "import path from 'path'\nexport const value = <div />\n" },
      { path: 'src/frontends/web/bad-node.ts', source: "import 'node:fs'\n" },
      { path: 'src/client/bad-host.ts', source: "import '../integrations/dsh/index.js'\n" },
      { path: 'src/frontends/web/bad-self.ts', source: "import 'dsh-toolchain/dsh'\n" },
      { path: 'src/integrations/dsh/index.ts', source: '' },
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
        target: 'src/integrations/dsh/index.ts',
        rule: 'dependency-layer',
      },
      {
        file: 'src/frontends/web/bad-self.ts',
        specifier: 'dsh-toolchain/dsh',
        rule: 'client-host-boundary',
      },
    ])
  })

  it('scans TypeScript and JavaScript module source extensions but rejects repository prose', () => {
    expect([
      'file.ts', 'file.tsx', 'file.mts', 'file.cts',
      'file.js', 'file.jsx', 'file.mjs', 'file.cjs',
    ].map(isArchitectureSourceFile)).toEqual([
      true, true, true, true,
      true, true, true, true,
    ])
    expect(isArchitectureSourceFile('README.md')).toBe(false)
  })

  it('accepts the current closed-world dependency direction', () => {
    expect(checkSourceImportPolicy([
      { path: 'src/product.ts', source: "export const name = 'dsh-toolchain'\n" },
      { path: 'src/protocol/index.ts', source: "export const version = '1'\n" },
      { path: 'src/kernel/index.ts', source: "import { version } from '../protocol/index.js'\nexport { version }\n" },
      { path: 'src/frontends/mcp/index.ts', source: "import { version } from '../../kernel/index.js'\nexport { version }\n" },
      { path: 'src/frontends/cli/index.ts', source: "import { version } from '../../kernel/index.js'\nimport '../../frontends/mcp/index.js'\nexport { version }\n" },
      { path: 'src/integrations/dsh/index.ts', source: "import { Service } from '@deepseek-ai/cordis'\nimport { version } from '../../kernel/index.js'\nexport { Service, version }\n" },
      { path: 'src/index.ts', source: "export { name } from './product.js'\nexport { version } from './protocol/index.js'\n" },
    ])).toEqual([])
  })
})
