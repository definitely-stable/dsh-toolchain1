import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { captureOrdinaryWorkspaceFromAcquiredEvidence } from '../../scripts/m2-ordinary-acquired-evidence.mjs'
import { validateOrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'

const roots: string[] = []

async function put(root: string, relativePath: string, content: string): Promise<string> {
  const location = join(root, relativePath)
  await mkdir(dirname(location), { recursive: true })
  await writeFile(location, content)
  return location
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('M2.3 ordinary capture from production acquisition evidence', () => {
  it('uses only production-approved declaration evidence while retaining conventional docs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-m2-acquired-'))
    roots.push(root)
    const manifest = await put(root, 'package.json', '{"name":"@deepseek-ai/dsh-tools","version":"0.1.1-rc.2"}\n')
    const publicDeclaration = await put(root, 'lib/types/index.d.ts', 'export interface ToolRuntime {}\n')
    await put(root, 'lib/types/private.d.ts', 'export interface HiddenInternal {}\n')
    await put(root, 'README.md', '# dsh-tools\n')

    const workspace = await captureOrdinaryWorkspaceFromAcquiredEvidence({
      fixtureVersion: 'rc2-web-v1',
      target: {
        package: '@deepseek-ai/dsh',
        version: '0.1.1-rc.2',
        profile: 'web',
        targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
        contractIndexFingerprint: `dsh-contract-index-v1:${'2'.repeat(64)}`,
      },
      acquired: {
        contracts: [{
          id: 'package:@deepseek-ai/dsh-tools',
          kind: 'package',
          name: '@deepseek-ai/dsh-tools',
          facts: [{ key: 'version', value: '0.1.1-rc.2', evidenceIds: ['manifest:tools'] }],
          evidenceIds: ['manifest:tools', 'types:tools:index'],
        }],
        evidence: [
          { id: 'manifest:tools', kind: 'manifest', location: manifest },
          { id: 'types:tools:index', kind: 'type-declaration', location: publicDeclaration },
        ],
      },
    })

    await expect(validateOrdinaryWorkspace(workspace, createNodeSha256Port())).resolves.toBeUndefined()
    expect(workspace.packages).toEqual([{ name: '@deepseek-ai/dsh-tools', version: '0.1.1-rc.2' }])
    expect(workspace.files.map(file => file.path)).toEqual([
      '/exact-target/node_modules/@deepseek-ai/dsh-tools/README.md',
      '/exact-target/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts',
      '/exact-target/node_modules/@deepseek-ai/dsh-tools/package.json',
    ])
    expect(workspace.files.some(file => file.content.includes('HiddenInternal'))).toBe(false)
  })
})
