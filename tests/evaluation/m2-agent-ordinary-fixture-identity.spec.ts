import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createOrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import { createOrdinaryWorkspaceFixture } from '../../scripts/m2-ordinary-evidence.mjs'

const target = {
  package: '@deepseek-ai/dsh' as const,
  version: '0.1.1-rc.2' as const,
  profile: 'web' as const,
  targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
  contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
}
const packages = [
  { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2' },
  { name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' },
]
const files = [
  {
    path: '/exact-target/node_modules/@deepseek-ai/dsh/package.json',
    mediaType: 'application/json' as const,
    content: '{"name":"@deepseek-ai/dsh","version":"0.1.1-rc.2"}\n',
  },
  {
    path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
    mediaType: 'text/plain' as const,
    content: '# dsh-tools\n',
  },
  {
    path: '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts',
    mediaType: 'text/typescript' as const,
    content: 'export interface ToolRuntime {}\n',
  },
]

describe('M2.3 generator workspace identity parity', () => {
  it('matches the TypeScript ordinary workspace contract byte-for-byte', async () => {
    const expected = await createOrdinaryWorkspace({
      fixtureVersion: 'rc2-web-v1',
      target,
      packages,
      files,
    }, createNodeSha256Port())

    const generated = createOrdinaryWorkspaceFixture({
      fixtureVersion: 'rc2-web-v1',
      target,
      packages: packages.toReversed(),
      files: files.toReversed(),
    })

    expect(generated).toEqual(expected)
    expect(generated.documentationSha256).toBe(expected.documentationSha256)
    expect(generated.workspaceSnapshotSha256).toBe(expected.workspaceSnapshotSha256)
  })
})
