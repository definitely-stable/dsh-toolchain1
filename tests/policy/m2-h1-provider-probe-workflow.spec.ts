import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowUrl = new URL('.github/workflows/m2-h1-provider-probe.yml', root)

async function workflowSource(): Promise<string> {
  return readFile(workflowUrl, 'utf8')
}

describe('M2.3 H1 provider identity probe workflow', () => {
  it('is a narrow provider-only identity probe with no H1 execution surface', async () => {
    const source = await workflowSource()

    expect(source).toContain('probe-m2-opencode-go.mjs')
    expect(source).toContain('OPENCODE_API_KEY')
    expect(source).toContain('m2-h1-provider-identity')
    expect(source).not.toContain('run-m2-p0-opencode-go')
    expect(source).not.toContain('prepare-m2-h1-preregistration')
    expect(source).not.toContain('m2:h1:preregister')
    expect(source).not.toContain('agent-holdout-h1')
    expect(source).not.toContain('h1-private')
    expect(source).not.toContain('dataset')
  })

  it('runs once when introduced on main and remains manually repeatable without broad push triggers', async () => {
    const source = await workflowSource()

    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('push:')
    expect(source).toContain('m2-h1-provider-probe.yml')
    expect(source).toContain('branches: [main]')
    expect(source).toContain('permissions:')
    expect(source).toContain('contents: read')
    expect(source).toContain('timeout-minutes: 5')
  })

  it('publishes only the probe receipt artifact and never grants write permissions', async () => {
    const source = await workflowSource()

    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('m2-h1-provider-identity.json')
    expect(source).toContain('if-no-files-found: error')
    expect(source).toContain('retention-days: 1')
    expect(source).not.toMatch(/contents:\s*write/iu)
    expect(source).not.toMatch(/actions:\s*write/iu)
    expect(source).not.toMatch(/pull-requests:\s*write/iu)
  })
})
