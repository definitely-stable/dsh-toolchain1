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
    expect(source).toContain('h1-hidden-dataset-v2.json')
  })

  it('executes terminal analysis only from the frozen CI-green source commit', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    expect(source).toContain(`H1_TERMINAL_SOURCE_COMMIT: ${TERMINAL_SOURCE_COMMIT}`)
    expect(source).toContain('ref: ${{ env.H1_TERMINAL_SOURCE_COMMIT }}')
    expect(source).toContain('clean: true')
    expect(source).toContain('Checkout exact frozen terminal adjudication source')
  })

  it('reveals the exact hidden dataset only after the terminal finalizer succeeds', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    const finalizer = source.indexOf('- name: Finalize and adjudicate completed H1')
    const disclosure = source.indexOf('- name: Disclose exact hidden H1 dataset after terminal gate')
    const manifest = source.indexOf('- name: Write terminal H1 evidence manifest')
    const upload = source.indexOf('- name: Upload terminal H1 evidence')

    expect(finalizer).toBeGreaterThanOrEqual(0)
    expect(disclosure).toBeGreaterThan(finalizer)
    expect(manifest).toBeGreaterThan(disclosure)
    expect(upload).toBeGreaterThan(manifest)
    expect(source).toContain('H1_DATASET_RAW_SHA256: c007472514fa6fd1daa06cffb94f4052062a03bdceba475773830e73a01e32e6')
    expect(source).toContain('install -m 600 "$H1_DATASET" "$H1_TERMINAL_OUTPUT/h1-hidden-dataset-v2.json"')
    expect(source).toContain('sha256sum --check --status')
  })

  it('emits a terminal evidence manifest and provenance attestation for every disclosed output file', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    const manifest = source.indexOf('- name: Write terminal H1 evidence manifest')
    const attest = source.indexOf('- name: Attest terminal H1 evidence provenance')
    const upload = source.indexOf('- name: Upload terminal H1 evidence')

    expect(source).toContain('attestations: write')
    expect(source).toContain('id-token: write')
    expect(manifest).toBeGreaterThanOrEqual(0)
    expect(attest).toBeGreaterThan(manifest)
    expect(upload).toBeGreaterThan(attest)
    expect(source).toContain('h1-terminal-sha256sums.txt')
    expect(source).toContain('h1-terminal-manifest-v1.json')
    expect(source).toContain('dsh-toolchain-m2-h1-terminal-evidence-manifest-v1')
    expect(source).toContain('actions/attest@f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6')
    expect(source).toContain('subject-checksums: ${{ runner.temp }}/m2-h1-terminal/h1-terminal-sha256sums.txt')
    expect(source).toContain('jq -e \'.files | length == 4\' h1-terminal-manifest-v1.json')
  })

  it('does not run concurrently with H1 execution', async () => {
    const source = await readFile(WORKFLOW, 'utf8')
    expect(source).toContain('group: m2-h1-execution-main')
    expect(source).toContain('cancel-in-progress: false')
  })
})
