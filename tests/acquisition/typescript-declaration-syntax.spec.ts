import { describe, expect, it } from 'vitest'
import { parseTypeScriptDeclarationSyntax } from '../../src/acquisition/typescript-declaration-syntax.js'

describe('TypeScript declaration syntax adapter', () => {
  it('extracts only explicit public declaration exports', () => {
    const parsed = parseTypeScriptDeclarationSyntax('index.d.ts', [
      'interface PrivateInterface {}',
      'declare const privateValue: string',
      'export interface PublicInterface {}',
      'export type PublicType = string',
      'export declare class PublicClass {}',
      'export declare function publicFunction(): void',
      'export declare const publicValue: string, secondValue: number',
      'export namespace PublicNamespace {}',
      'export default class DefaultClass {}',
      'export as namespace GlobalAlias',
      '',
    ].join('\n'))

    expect(parsed.exports).toEqual([
      'GlobalAlias',
      'PublicClass',
      'PublicInterface',
      'PublicNamespace',
      'PublicType',
      'default',
      'publicFunction',
      'publicValue',
      'secondValue',
    ])
  })

  it('preserves relative re-export semantics and keeps path references distinct', () => {
    const parsed = parseTypeScriptDeclarationSyntax('index.d.ts', [
      '/// <reference path="./ambient.d.ts" />',
      "import type { PrivateType } from './private.js'",
      "import { PrivateRuntime } from './private-runtime.js'",
      "// export { CommentGhost } from './comment-ghost.js'",
      "export { PublicType, type PublicShape as Shape } from './public.js'",
      "export * from './star.js'",
      "export * as namespaceExport from './namespace.js'",
      "export { External } from 'external-package'",
      '',
    ].join('\n'))

    expect(parsed.exports).toEqual(['External', 'PublicType', 'Shape', 'namespaceExport'])
    expect(parsed.relativeReexports).toEqual([
      {
        kind: 'namespace',
        specifier: './namespace.js',
        exportedName: 'namespaceExport',
      },
      {
        kind: 'named',
        specifier: './public.js',
        bindings: [
          { importedName: 'PublicType', exportedName: 'PublicType' },
          { importedName: 'PublicShape', exportedName: 'Shape' },
        ],
      },
      { kind: 'star', specifier: './star.js' },
    ])
    expect(parsed.relativePathReferences).toEqual(['./ambient.d.ts'])
  })

  it('treats exported import-equals as a public relative edge without flattening its target', () => {
    const parsed = parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      "export import LegacyApi = require('./legacy.js')\n",
    )

    expect(parsed.exports).toEqual(['LegacyApi'])
    expect(parsed.relativeReexports).toEqual([{
      kind: 'import-equals',
      specifier: './legacy.js',
      exportedName: 'LegacyApi',
    }])
  })

  it('returns deterministic deeply immutable result collections and typed edges', () => {
    const parsed = parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      "export { Zed, Alpha } from './z.js'\nexport { Beta } from './a.js'\n",
    )

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.exports)).toBe(true)
    expect(Object.isFrozen(parsed.relativeReexports)).toBe(true)
    expect(Object.isFrozen(parsed.relativePathReferences)).toBe(true)
    expect(Object.isFrozen(parsed.relativeReexports[0])).toBe(true)
    expect(parsed.exports).toEqual(['Alpha', 'Beta', 'Zed'])
    expect(parsed.relativeReexports).toEqual([
      {
        kind: 'named',
        specifier: './a.js',
        bindings: [{ importedName: 'Beta', exportedName: 'Beta' }],
      },
      {
        kind: 'named',
        specifier: './z.js',
        bindings: [
          { importedName: 'Alpha', exportedName: 'Alpha' },
          { importedName: 'Zed', exportedName: 'Zed' },
        ],
      },
    ])
  })

  it('rejects malformed declarations using public syntactic diagnostics instead of parser recovery', () => {
    expect(() => parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      'export interface ToolDefinition {\n',
    )).toThrow(/TS1005/u)
  })
})
