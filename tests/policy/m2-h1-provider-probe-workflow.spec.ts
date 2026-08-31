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
    expect(source).toContain('m2-h1-provider-candidate-')
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

  it('discovers strong identity only across current OpenCode Go chat-completions candidates', async () => {
    const source = await workflowSource()
    const candidates = [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'glm-5.3-flash',
      'glm-5.3',
      'glm-5.2',
      'glm-5.1',
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.6',
      'longcat-2.0',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'hy4-preview',
      'hy3',
    ]

    expect(source).toContain('fail-fast: false')
    expect(source).toContain('continue-on-error: true')
    expect(source).toContain('--model "${{ matrix.model }}"')
    for (const candidate of candidates) expect(source).toContain(`- ${candidate}`)
    expect(source).not.toContain('- gpt-5.6-luna')
    expect(source).not.toContain('- grok-4.6')
    expect(source).not.toContain('- qwen3.8-max')
    expect(source).not.toContain('- deepseek-v4-flash-vision-exp')
  })

  it('publishes successful candidate receipts without making incompatible candidates fatal', async () => {
    const source = await workflowSource()

    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('m2-h1-provider-candidate-${{ matrix.model }}')
    expect(source).toContain('candidate-${{ matrix.model }}.json')
    expect(source).toContain("if: steps.probe.outcome == 'success'")
    expect(source).toContain('if-no-files-found: error')
    expect(source).toContain('retention-days: 1')
    expect(source).not.toMatch(/contents:\s*write/iu)
    expect(source).not.toMatch(/actions:\s*write/iu)
    expect(source).not.toMatch(/pull-requests:\s*write/iu)
  })
})
