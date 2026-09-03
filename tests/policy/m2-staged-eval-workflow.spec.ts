import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowUrl = new URL('.github/workflows/m2-staged-eval.yml', root)

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('M2 staged development evaluation workflow policy', () => {
  it('exposes one manual mode selector and no experimental tuning knobs', async () => {
    const source = await readFile(workflowUrl, 'utf8')

    expect(source).toContain('workflow_dispatch:')
    expect(source).not.toMatch(/^\s*push:/mu)
    expect(source).not.toMatch(/^\s*pull_request:/mu)
    expect(source).toContain('mode:')
    expect(source).toContain('type: choice')
    for (const mode of ['canary', 'dev', 'release', 'research']) expect(source).toContain(`- ${mode}`)
    for (const forbidden of ['chunk-size', 'chunk_size', 'arms:', 'repetitions:', 'max_committed_attempts']) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('probes the exact managed provider and executes the closed command exactly once', async () => {
    const source = await readFile(workflowUrl, 'utf8')

    expect(source).toContain('OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}')
    expect(source).toContain('M2_STAGED_PROVIDER_PROBE: .artifacts/m2-staged-provider-probe.json')
    expect(occurrences(source, 'probe-m2-opencode-go.mjs')).toBe(1)
    expect(source).toContain('--model deepseek-v4-flash')
    expect(source).toContain('--output .artifacts/m2-staged-provider-probe.json')
    expect(occurrences(source, 'pnpm eval:run --')).toBe(1)
    expect(source).toContain('--mode ${{ inputs.mode }}')
    expect(source).toContain('--manifest docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')
    expect(source).toContain('--output .artifacts/m2-staged-eval-report.json')
  })

  it('stores only run-local staged evidence and never invokes historical H1 execution', async () => {
    const source = await readFile(workflowUrl, 'utf8')

    expect(source).toContain('permissions:')
    expect(source).toContain('contents: read')
    expect(source).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
    expect(source).toContain('m2-staged-eval-${{ github.run_id }}-${{ github.run_attempt }}')
    expect(source).toContain('.artifacts/m2-staged-provider-probe.json')
    expect(source).toContain('.artifacts/m2-staged-eval-report.json')
    for (const forbidden of [
      'run-m2-h1',
      'm2:h1:run',
      'finalize-m2-h1',
      'post-analyze-m2-h1',
      'm2-h1-run-store',
    ]) expect(source).not.toContain(forbidden)
  })
})
