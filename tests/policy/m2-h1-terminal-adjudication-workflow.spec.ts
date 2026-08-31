import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const WORKFLOW = new URL('../../.github/workflows/m2-h1-terminal-adjudication.yml', import.meta.url)
const TERMINAL_SOURCE_COMMIT = '2e3e49702d0581364952affd96d86c518dda361b'

describe('M2 H1 terminal adjudication workflow policy', () => {
  it('is manual-only, exact-cache, offline and artifact-producing', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('h1_execution_run_id:')
    expect(source).not.toMatch(/^\s{2}(?:push|pull_request|schedule):/mu)
    expect(source).toContain('contents: read')
    expect(source).toContain('runs-on: ubuntu-24.04')
    expect(source).toContain('node-version: 24.19.0')
    expect(source).toContain('M2_H1_DATASET_GZIP_BASE64')
    expect(source).toContain('actions/cache/restore@27d5ce7f107fe9357f9df03efb73ab90386fccae')
    expect(source).toContain('key: m2-h1-dc12ccf9-${{ inputs.h1_execution_run_id }}')
    expect(source).toContain('fail-on-cache-miss: true')
    expect(source).not.toContain('restore-keys:')
    expect(source).not.toContain('actions/cache/save')
    expect(source).not.toContain('OPENCODE_API_KEY')
    expect(source).not.toContain('--execute')
    expect(source).toContain('pnpm m2:h1:finalize')
    expect(source).toContain('actions/upload-artifact@')
    expect(source).toContain('h1-result-v2.json')
    expect(source).toContain('h1-analysis-v2.json')
    expect(source).toContain('h1-summary.md')
  })

  it('executes terminal analysis only from the frozen CI-green source commit', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    expect(source).toContain(`H1_TERMINAL_SOURCE_COMMIT: ${TERMINAL_SOURCE_COMMIT}`)
    expect(source).toContain('ref: ${{ env.H1_TERMINAL_SOURCE_COMMIT }}')
    expect(source).toContain('clean: true')
    expect(source).toContain('Checkout exact frozen terminal adjudication source')
  })

  it('does not run concurrently with H1 execution', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    expect(source).toContain('group: m2-h1-execution-main')
    expect(source).toContain('cancel-in-progress: false')
  })
})
