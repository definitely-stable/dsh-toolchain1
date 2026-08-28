import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  createOrdinaryWorkspace,
  type OrdinaryWorkspace,
  type OrdinaryWorkspaceFileInput,
} from './m2-agent-ordinary-workspace.js'
import {
  createOrdinaryReadToolDefinition,
  createOrdinarySearchToolDefinition,
} from './m2-agent-ordinary-tools.js'

const sha256 = createNodeSha256Port()

async function fixture(files?: readonly OrdinaryWorkspaceFileInput[]): Promise<OrdinaryWorkspace> {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
      contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
    },
    packages: [
      { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
      { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
    ],
    files: files ?? [
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
        mediaType: 'application/json',
        content: '{\n  "name": "@deepseek-ai/dsh",\n  "version": "0.1.1-rc.2"\n}\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
        mediaType: 'text/typescript',
        content: [
          'export interface DefineToolOptions {}',
          'export declare function defineTool(options: DefineToolOptions): unknown',
          'export type ParameterSchemaSpec = unknown',
        ].join('\n') + '\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        mediaType: 'text/plain',
        content: [
          '# DSH Tools',
          '',
          'Use defineTool to declare typed tools.',
          'The helper accepts a parameter schema.',
        ].join('\n') + '\n',
      },
    ],
  }, sha256)
}

describe('M2.3 ordinary exact-target read/search tools', () => {
  it('reads a bounded line window from one exact virtual workspace path', async () => {
    const workspace = await fixture()
    const tool = createOrdinaryReadToolDefinition(workspace)
    const path = '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts'

    expect(tool.family).toBe('ordinary')
    expect(tool.name).toBe('read_file')
    expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
    await expect(tool.execute({ path, startLine: 2, lineCount: 1 })).resolves.toEqual({
      path,
      sha256: workspace.files.find(file => file.path === path)!.sha256,
      startLine: 2,
      endLine: 2,
      totalLines: 3,
      content: 'export declare function defineTool(options: DefineToolOptions): unknown',
    })
  })

  it('uses frozen read defaults and clamps only by end-of-file, never by hidden filesystem state', async () => {
    const workspace = await fixture()
    const tool = createOrdinaryReadToolDefinition(workspace)
    const path = '/exact-target/node_modules/@deepseek-ai/dsh/package.json'

    await expect(tool.execute({ path })).resolves.toMatchObject({
      path,
      startLine: 1,
      endLine: 4,
      totalLines: 4,
    })
    await expect(tool.execute({ path, startLine: 4, lineCount: 200 })).resolves.toMatchObject({
      startLine: 4,
      endLine: 4,
    })
  })

  it('fails closed for read traversal, missing paths, extra fields and invalid line windows', async () => {
    const tool = createOrdinaryReadToolDefinition(await fixture())

    await expect(tool.execute({ path: '../package.json' })).rejects.toThrow(/path|root|exact-target/i)
    await expect(tool.execute({ path: '/exact-target/node_modules/@deepseek-ai/dsh/missing.txt' })).rejects.toThrow(/not found|missing/i)
    await expect(tool.execute({ path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json', secret: true })).rejects.toThrow(/field|property|closed/i)
    await expect(tool.execute({ path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json', startLine: 0 })).rejects.toThrow(/startLine|line/i)
    await expect(tool.execute({ path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json', lineCount: 201 })).rejects.toThrow(/lineCount|200|line/i)
  })

  it('searches literal text case-insensitively with stable path-line-column ordering', async () => {
    const tool = createOrdinarySearchToolDefinition(await fixture())

    await expect(tool.execute({ query: 'DEFINETOOL' })).resolves.toEqual({
      query: 'DEFINETOOL',
      matches: [
        {
          path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
          line: 3,
          column: 5,
          text: 'Use defineTool to declare typed tools.',
        },
        {
          path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
          line: 1,
          column: 18,
          text: 'export interface DefineToolOptions {}',
        },
        {
          path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
          line: 2,
          column: 25,
          text: 'export declare function defineTool(options: DefineToolOptions): unknown',
        },
      ],
      truncated: false,
    })
  })

  it('bounds search results deterministically and confines optional prefixes to the workspace root', async () => {
    const tool = createOrdinarySearchToolDefinition(await fixture())
    const prefix = '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/'

    await expect(tool.execute({ query: 'export', pathPrefix: prefix, limit: 2 })).resolves.toEqual({
      query: 'export',
      matches: [
        {
          path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
          line: 1,
          column: 1,
          text: 'export interface DefineToolOptions {}',
        },
        {
          path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
          line: 2,
          column: 1,
          text: 'export declare function defineTool(options: DefineToolOptions): unknown',
        },
      ],
      truncated: true,
    })

    await expect(tool.execute({ query: 'export', pathPrefix: '../' })).rejects.toThrow(/path|prefix|root/i)
  })

  it('fails closed for empty/oversized queries, extra fields and invalid result limits', async () => {
    const tool = createOrdinarySearchToolDefinition(await fixture())

    await expect(tool.execute({ query: '' })).rejects.toThrow(/query|non-empty/i)
    await expect(tool.execute({ query: 'x'.repeat(129) })).rejects.toThrow(/128|query|byte/i)
    await expect(tool.execute({ query: 'defineTool', regex: true })).rejects.toThrow(/field|property|closed/i)
    await expect(tool.execute({ query: 'defineTool', limit: 0 })).rejects.toThrow(/limit|1|50/i)
    await expect(tool.execute({ query: 'defineTool', limit: 51 })).rejects.toThrow(/limit|1|50/i)
  })

  it('produces byte-equivalent results for semantically identical workspaces regardless of acquisition order', async () => {
    const inputs: OrdinaryWorkspaceFileInput[] = [
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
        mediaType: 'text/plain',
        content: 'defineTool\n',
      },
      {
        path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
        mediaType: 'application/json',
        content: '{"name":"@deepseek-ai/dsh"}\n',
      },
    ]
    const first = createOrdinarySearchToolDefinition(await fixture(inputs))
    const second = createOrdinarySearchToolDefinition(await fixture(inputs.toReversed()))

    const firstResult = await first.execute({ query: 'defineTool' })
    const secondResult = await second.execute({ query: 'defineTool' })
    expect(JSON.stringify(secondResult)).toBe(JSON.stringify(firstResult))
  })
})
