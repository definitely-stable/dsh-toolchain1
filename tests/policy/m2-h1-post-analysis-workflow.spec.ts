import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const WORKFLOW = new URL('../../.github/workflows/m2-h1-post-analysis.yml', import.meta.url)

describe('M2 H1 post-analysis workflow policy', () => {
  it('is manual-only and consumes an already successful terminal adjudication run', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('terminal_adjudication_run_id:')
    expect(source).not.toMatch(/^\s{2}(?:push|pull_request|schedule):/mu)
    expect(source).toContain('actions: read')
    expect(source).toContain('.name == "M2 H1 Terminal Adjudication"')
    expect(source).toContain('.path == ".github/workflows/m2-h1-terminal-adjudication.yml"')
    expect(source).toContain('.conclusion == "success"')
    expect(source).toContain('.head_branch == "main"')
  })

  it('uses Node 24 artifact actions and never calls the provider or frozen finalizer', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38')
    expect(source).toContain('actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131')
    expect(source).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a')
    expect(source).toContain('node-version: 24.19.0')
    expect(source).not.toContain('OPENCODE_API_KEY')
    expect(source).not.toContain('M2_H1_DATASET_GZIP_BASE64')
    expect(source).not.toContain('m2:h1:finalize')
    expect(source).not.toContain('--execute')
  })

  it('produces diagnostics, final report and machine-readable decision receipt', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('scripts/post-analyze-m2-h1.mjs')
    expect(source).toContain('h1-post-analysis-v1.json')
    expect(source).toContain('h1-task-diagnostics-v1.jsonl')
    expect(source).toContain('h1-final-report.md')
    expect(source).toContain('h1-decision-receipt-v1.json')
    expect(source).toContain('h1-post-analysis-sha256sums.txt')
    expect(source).toContain('$GITHUB_STEP_SUMMARY')
  })
})
