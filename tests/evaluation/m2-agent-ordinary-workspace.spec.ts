import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  ORDINARY_WORKSPACE_MAX_FILE_BYTES,
  ORDINARY_WORKSPACE_MAX_TOTAL_BYTES,
  createOrdinaryWorkspace,
  ordinaryWorkspaceProjection,
  validateOrdinaryWorkspace,
  type OrdinaryWorkspaceFileInput,
} from './m2-agent-ordinary-workspace.js'

const sha256 = createNodeSha256Port()
const TARGET = {
  package: '@deepseek-ai/dsh' as const,
  version: '0.1.1-rc.2' as const,
  profile: 'web' as const,
  targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
  contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
}

function files(): OrdinaryWorkspaceFileInput[] {
  return [
    {
      path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
      mediaType: 'application/json',
      content: '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n',
    },
    {
      path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
      mediaType: 'text/typescript',
      content: 'export declare function defineTool(): unknown\n',
    },
    {
      path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
      mediaType: 'text/plain',
      content: '# dsh-tools\nPublished package documentation.\n',
    },
  ]
}

async function workspace(inputFiles = files()) {
  return createOrdinaryWorkspace({
    fixtureVersion: 'rc2-web-v1',
    target: TARGET,
    packages: [
      { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
      { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
    ],
    files: inputFiles,
  }, sha256)
}

describe('M2.3 ordinary exact-target workspace', () => {
  it('content-addresses conventional package bytes with stable virtual paths', async () => {
    const value = await workspace()

    await expect(validateOrdinaryWorkspace(value, sha256)).resolves.toBeUndefined()
    expect(value.schema).toBe('dsh-toolchain-m2-ordinary-workspace-v1')
    expect(value.inclusionPolicy).toBe('published-package-conventional-evidence-v1')
    expect(value.files.map(file => file.path)).toEqual([
      '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
      '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts',
      '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
    ])
    expect(value.packages.map(item => item.name)).toEqual([
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-tools',
    ])
    expect(value.files.every(file => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
    expect(value.documentationSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(value.workspaceSnapshotSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps workspace identity stable across acquisition ordering while content changes alter identity', async () => {
    const first = await workspace(files())
    const reordered = await workspace(files().toReversed())
    const changedFiles = files()
    changedFiles[1] = {
      ...changedFiles[1]!,
      content: 'export declare function defineTool(options: unknown): unknown\n',
    }
    const changed = await workspace(changedFiles)

    expect(reordered.workspaceSnapshotSha256).toBe(first.workspaceSnapshotSha256)
    expect(reordered.documentationSha256).toBe(first.documentationSha256)
    expect(ordinaryWorkspaceProjection(reordered)).toEqual(ordinaryWorkspaceProjection(first))
    expect(changed.workspaceSnapshotSha256).not.toBe(first.workspaceSnapshotSha256)
  })

  it('rejects duplicate paths and paths outside the canonical virtual root', async () => {
    await expect(workspace([...files(), files()[0]!])).rejects.toThrow(/duplicate|path/i)

    await expect(workspace([{ path: '../package.json', mediaType: 'application/json', content: '{}\n' }]))
      .rejects.toThrow(/path|root|exact-target/i)
    await expect(workspace([{ path: '/tmp/node_modules/@deepseek-ai/dsh/package.json', mediaType: 'application/json', content: '{}\n' }]))
      .rejects.toThrow(/path|root|exact-target/i)
    await expect(workspace([{ path: '/exact-target/node_modules/@deepseek-ai/dsh/../secret', mediaType: 'text/plain', content: 'x' }]))
      .rejects.toThrow(/path|traversal/i)
    await expect(workspace([{ path: '/exact-target\\node_modules\\@deepseek-ai\\dsh\\package.json', mediaType: 'application/json', content: '{}\n' }]))
      .rejects.toThrow(/path|backslash/i)
  })

  it('rejects normalized Toolchain and evaluator artifacts from the conventional workspace', async () => {
    for (const path of [
      '/exact-target/node_modules/@deepseek-ai/dsh/contract-facts.json',
      '/exact-target/node_modules/@deepseek-ai/dsh/docs/evaluation/m2/api-oracle-v1.json',
      '/exact-target/node_modules/@deepseek-ai/dsh/agent-holdout-h1.commitment.json',
      '/exact-target/node_modules/@deepseek-ai/dsh/agent-pilot-p0.json',
    ]) {
      await expect(workspace([{ path, mediaType: 'application/json', content: '{}\n' }]))
        .rejects.toThrow(/forbidden|evaluator|ordinary|workspace/i)
    }
  })

  it('rejects retained-byte hash and byte-length tampering', async () => {
    const value = await workspace()
    const changedHash = structuredClone(value)
    changedHash.files[0]!.sha256 = 'f'.repeat(64)
    await expect(validateOrdinaryWorkspace(changedHash, sha256)).rejects.toThrow(/hash/i)

    const changedLength = structuredClone(value)
    changedLength.files[0]!.byteLength += 1
    await expect(validateOrdinaryWorkspace(changedLength, sha256)).rejects.toThrow(/length|byte/i)
  })

  it('rejects unsupported media types and per-file or aggregate byte overflow', async () => {
    await expect(workspace([{
      path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
      mediaType: 'application/octet-stream' as 'application/json',
      content: '{}\n',
    }])).rejects.toThrow(/media/i)

    await expect(workspace([{
      path: '/exact-target/node_modules/@deepseek-ai/dsh/README.md',
      mediaType: 'text/plain',
      content: 'x'.repeat(ORDINARY_WORKSPACE_MAX_FILE_BYTES + 1),
    }])).rejects.toThrow(/file|byte|limit/i)

    const chunkSize = Math.min(ORDINARY_WORKSPACE_MAX_FILE_BYTES, 256 * 1024)
    const count = Math.floor(ORDINARY_WORKSPACE_MAX_TOTAL_BYTES / chunkSize) + 1
    const aggregate = Array.from({ length: count }, (_, index) => ({
      path: `/exact-target/node_modules/@deepseek-ai/dsh/docs/chunk-${index}.md`,
      mediaType: 'text/plain' as const,
      content: 'x'.repeat(chunkSize),
    }))
    await expect(workspace(aggregate)).rejects.toThrow(/aggregate|total|limit/i)
  })

  it('recomputes documentation and workspace identities during validation', async () => {
    const value = await workspace()

    const docsTampered = structuredClone(value)
    docsTampered.documentationSha256 = 'a'.repeat(64)
    await expect(validateOrdinaryWorkspace(docsTampered, sha256)).rejects.toThrow(/documentation|hash/i)

    const workspaceTampered = structuredClone(value)
    workspaceTampered.workspaceSnapshotSha256 = 'b'.repeat(64)
    await expect(validateOrdinaryWorkspace(workspaceTampered, sha256)).rejects.toThrow(/workspace|snapshot|hash/i)
  })
})
