import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowUrl = new URL('.github/workflows/m2-staged-eval-acceptance-once.yml', root)

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('M2 staged transport one-shot acceptance harness', () => {
  it('can trigger only once from its own addition on the blocker branch', async () => {
    const source = await readFile(workflowUrl, 'utf8')

    expect(source).toContain('name: M2 Staged Transport Acceptance Once')
    expect(source).toContain('push:')
    expect(source).toContain('- fix/m2-staged-measurement-transport')
    expect(source).toContain('- .github/workflows/m2-staged-eval-acceptance-once.yml')
    expect(source).not.toContain('workflow_dispatch:')
    expect(source).not.toContain('pull_request:')
  })

  it('fails before the canary unless the exact staged provider transport preflight is verified', async () => {
    const source = await readFile(workflowUrl, 'utf8')
    const probeIndex = source.indexOf('node scripts/probe-m2-opencode-go.mjs')
    const namedToolCheckIndex = source.indexOf("receipt.stagedNamedToolChoice !== 'verified'")
    const strictSchemaCheckIndex = source.indexOf("receipt.stagedStrictResultSchema !== 'verified'")
    const evalIndex = source.indexOf('pnpm eval:run --')

    expect(source).toContain('--model deepseek-v4-flash')
    expect(source).toContain('--staged-transport')
    expect(source).toContain('--output .artifacts/m2-staged-provider-probe.json')
    expect(probeIndex).toBeGreaterThan(-1)
    expect(namedToolCheckIndex).toBeGreaterThan(probeIndex)
    expect(strictSchemaCheckIndex).toBeGreaterThan(probeIndex)
    expect(evalIndex).toBeGreaterThan(namedToolCheckIndex)
    expect(evalIndex).toBeGreaterThan(strictSchemaCheckIndex)
  })

  it('runs exactly one closed 16-call canary and never exposes a remainder mode', async () => {
    const source = await readFile(workflowUrl, 'utf8')

    expect(occurrences(source, 'pnpm eval:run --')).toBe(1)
    expect(source).toContain('--mode canary')
    expect(source).toContain('--manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    expect(source).toContain('--output .artifacts/m2-staged-eval-report.json')
    expect(source).not.toContain('--mode dev')
    expect(source).not.toContain('--mode release')
    expect(source).not.toContain('--mode research')
    for (const forbidden of ['run-m2-h1', 'm2:h1:run', 'finalize-m2-h1', 'post-analyze-m2-h1', 'm2-h1-run-store']) {
      expect(source).not.toContain(forbidden)
    }
    expect(source).toContain('.artifacts/m2-staged-provider-probe.json')
    expect(source).toContain('.artifacts/m2-staged-eval-report.json')
  })
})
