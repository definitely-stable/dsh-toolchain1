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

  it('follows relative public re-exports and path references but ignores ordinary imports and comments', () => {
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

    expect(parsed.exports).toEqual(['PublicType', 'Shape', 'namespaceExport'])
    expect(parsed.relativeReexports).toEqual([
      './namespace.js',
      './public.js',
      './star.js',
    ])
    expect(parsed.relativePathReferences).toEqual(['./ambient.d.ts'])
  })

  it('treats exported import-equals as a public relative edge', () => {
    const parsed = parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      "export import LegacyApi = require('./legacy.js')\n",
    )

    expect(parsed.exports).toEqual(['LegacyApi'])
    expect(parsed.relativeReexports).toEqual(['./legacy.js'])
  })

  it('returns deterministic deeply immutable result collections', () => {
    const parsed = parseTypeScriptDeclarationSyntax(
      'index.d.ts',
      "export { Zed, Alpha } from './z.js'\nexport { Beta } from './a.js'\n",
    )

    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.exports)).toBe(true)
    expect(Object.isFrozen(parsed.relativeReexports)).toBe(true)
    expect(Object.isFrozen(parsed.relativePathReferences)).toBe(true)
    expect(parsed.exports).toEqual(['Alpha', 'Beta', 'Zed'])
    expect(parsed.relativeReexports).toEqual(['./a.js', './z.js'])
  })
})
