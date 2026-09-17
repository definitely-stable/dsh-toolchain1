import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const WORKFLOW_PATH = '.github/workflows/real-plugin-corpus.yml'

async function workflowText(): Promise<string> {
  return readFile(WORKFLOW_PATH, 'utf8')
}

describe('real plugin corpus workflow policy', () => {
  it('keeps the network-heavy corpus separate from required CI and bounded by event mode', async () => {
    const workflow = await workflowText()

    expect(workflow).toContain('name: Real Plugin Corpus')
    expect(workflow).toContain('pull_request:')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('schedule:')
    expect(workflow).toMatch(/PERF|CORPUS_MODE/u)
    expect(workflow).toContain('smoke')
    expect(workflow).toContain('static')
    expect(workflow).toContain('full')
    expect(workflow).toMatch(/github\.event_name == ['"]pull_request['"][\s\S]*smoke/u)
    expect(workflow).toMatch(/github\.event_name == ['"]schedule['"][\s\S]*full/u)
  })

  it('runs read-only without exposing repository secrets or persisted checkout credentials', async () => {
    const workflow = await workflowText()

    expect(workflow).toContain('permissions:')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).not.toContain('secrets.')
    expect(workflow).not.toContain('pull_request_target')
  })

  it('uses the supported measurement runtime and suppresses lifecycle scripts during repo setup', async () => {
    const workflow = await workflowText()

    expect(workflow).toContain("node-version: '24.19.0'")
    expect(workflow).toContain('pnpm install --frozen-lockfile --ignore-scripts')
    expect(workflow).toContain('pnpm pack --out .artifacts/dsh-toolchain.tgz')
    expect(workflow).toContain('scripts/real-plugin-corpus/run.mjs')
    expect(workflow).toContain('--toolchain-tarball .artifacts/dsh-toolchain.tgz')
  })

  it('persists only bounded run evidence with the repository-supported retention', async () => {
    const workflow = await workflowText()

    expect(workflow).toContain('environment.json')
    expect(workflow).toContain('results.jsonl')
    expect(workflow).toContain('summary.json')
    expect(workflow).toContain('summary.md')
    expect(workflow).toContain('retention-days: 7')
    expect(workflow).not.toContain('node_modules')
  })
})
