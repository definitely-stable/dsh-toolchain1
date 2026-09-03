import { readFile, readdir } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowsDir = new URL('.github/workflows/', root)
const h1ProviderProbeWorkflow = 'm2-h1-provider-probe.yml'
const stagedWorkflow = 'm2-staged-eval.yml'

async function activeWorkflowSources(excluded: readonly string[] = []): Promise<readonly string[]> {
  const entries = await readdir(workflowsDir)
  const workflowFiles = entries
    .filter(entry => (entry.endsWith('.yml') || entry.endsWith('.yaml')) && !excluded.includes(entry))
    .toSorted()

  return Promise.all(workflowFiles.map(async entry => readFile(new URL(entry, workflowsDir), 'utf8')))
}

describe('M2.3 retired live P0 workflow policy', () => {
  it('has no active provider-backed P0 workflow, trigger or execution command', async () => {
    const entries = await readdir(workflowsDir)
    expect(entries).not.toContain('m2-p0-live.yml')

    const allWorkflows = (await activeWorkflowSources()).join('\n--- workflow boundary ---\n')
    expect(allWorkflows).not.toContain('/run-m2-p0-opencode-go')
    expect(allWorkflows).not.toContain('run-m2-p0-opencode-go.mjs')

    const nonProviderProbeWorkflows = (await activeWorkflowSources([h1ProviderProbeWorkflow, stagedWorkflow]))
      .join('\n--- workflow boundary ---\n')
    expect(nonProviderProbeWorkflows).not.toContain('probe-m2-opencode-go.mjs')

    for (const providerProbeWorkflow of [h1ProviderProbeWorkflow, stagedWorkflow]) {
      const source = await readFile(new URL(providerProbeWorkflow, workflowsDir), 'utf8')
      expect(source).not.toContain('/run-m2-p0-opencode-go')
      expect(source).not.toContain('run-m2-p0-opencode-go.mjs')
    }
  })

  it('keeps the required CI workflow free of P0 provider credentials and live execution', async () => {
    const required = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')

    expect(required).not.toContain('OPENCODE_API_KEY')
    expect(required).not.toContain('run-m2-p0-opencode-go')
    expect(required).not.toContain('probe-m2-opencode-go')
  })
})
