import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowUrl = new URL('.github/workflows/m2-h1-provider-probe.yml', root)

async function workflowSource(): Promise<string> {
  return readFile(workflowUrl, 'utf8')
}

describe('M2.3 H1 provider identity probe workflow', () => {
  it('is a narrow provider-only Flash probe with no H1 execution surface', async () => {
    const source = await workflowSource()

    expect(source).toContain('probe-m2-opencode-go.mjs')
    expect(source).toContain('OPENCODE_API_KEY')
    expect(source).toContain('--model deepseek-v4-flash')
    expect(source).toContain('m2-h1-provider-identity.json')
    expect(source).not.toContain('matrix:')
    expect(source).not.toContain('deepseek-v4-pro')
    expect(source).not.toContain('glm-5.3')
    expect(source).not.toContain('kimi-k3')
    expect(source).not.toContain('mimo-v2.5')
    expect(source).not.toContain('run-m2-p0-opencode-go')
    expect(source).not.toContain('prepare-m2-h1-preregistration')
    expect(source).not.toContain('m2:h1:preregister')
    expect(source).not.toContain('agent-holdout-h1')
    expect(source).not.toContain('h1-private')
    expect(source).not.toContain('dataset')
  })

  it('runs once when introduced on main and remains manually repeatable with read-only repository permissions', async () => {
    const source = await workflowSource()

    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('push:')
    expect(source).toContain('m2-h1-provider-probe.yml')
    expect(source).toContain('branches: [main]')
    expect(source).toContain('permissions:')
    expect(source).toContain('contents: read')
    expect(source).toContain('timeout-minutes: 5')
    expect(source).not.toMatch(/contents:\s*write/iu)
    expect(source).not.toMatch(/actions:\s*write/iu)
    expect(source).not.toMatch(/pull-requests:\s*write/iu)
  })

  it('requires the exact managed-gateway capability receipt without requiring a hidden backend fingerprint', async () => {
    const source = await workflowSource()

    for (const fragment of [
      "provider !== 'opencode-go'",
      "baseUrl !== 'https://opencode.ai/zen/go/v1'",
      "requestModel !== 'deepseek-v4-flash'",
      "responseModel !== 'deepseek-v4-flash'",
      "thinking !== 'enabled'",
      "reasoningEffort !== 'high'",
      "functionToolCall !== 'verified'",
      "reasoningContinuation !== 'verified'",
      "tokenMeasurement !== 'verified'",
    ]) expect(source).toContain(fragment)

    expect(source).toContain('Number.isInteger(r.inputTokens)')
    expect(source).toContain('Number.isInteger(r.outputTokens)')
    expect(source).not.toContain('Require strong backend identity')
    expect(source).not.toContain("backendIdentityStrength !== 'system-fingerprint'")
    expect(source).not.toContain('systemFingerprint.length')
  })

  it('publishes exactly one short-lived provider receipt artifact', async () => {
    const source = await workflowSource()

    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('name: m2-h1-provider-identity')
    expect(source).toContain('path: .artifacts/m2-h1-provider-identity.json')
    expect(source).toContain('if-no-files-found: error')
    expect(source).toContain('retention-days: 1')
    expect(source).not.toContain('continue-on-error: true')
  })
})
