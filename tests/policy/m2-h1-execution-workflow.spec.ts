import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const WORKFLOW = new URL('../../.github/workflows/m2-h1-execution.yml', import.meta.url)

describe('M2 H1 execution workflow policy', () => {
  it('is manual-only, Flash-only, bounded, secret-backed and resumable without caching plaintext outcomes', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('workflow_dispatch:')
    expect(source).not.toMatch(/^\s{2}(?:push|pull_request|schedule):/mu)
    expect(source).toContain('contents: read')
    expect(source).toContain('runs-on: ubuntu-24.04')
    expect(source).toContain('timeout-minutes: 330')
    expect(source).toContain('M2_H1_DATASET_GZIP_BASE64')
    expect(source).toContain('OPENCODE_API_KEY')
    expect(source).toContain('deepseek-v4-flash')
    expect(source).toContain('pnpm m2:h1:run')
    expect(source).not.toContain('pnpm m2:h1:run -- ')
    expect(source).toContain('--execute')
    expect(source).toContain('--max-committed-attempts')
    expect(source).toContain('actions/cache/restore@27d5ce7f107fe9357f9df03efb73ab90386fccae')
    expect(source).toContain('actions/cache/save@27d5ce7f107fe9357f9df03efb73ab90386fccae')
    expect(source).toContain('m2-h1-dc12ccf9-')
    expect(source).toContain('h1-run-store.enc')
    expect(source).toContain('openssl enc -aes-256-cbc -pbkdf2')
    expect(source).toContain('umask 077')
    expect(source).toContain('H1_DATASET=$RUNNER_TEMP/m2-h1-private-dataset.json')
    expect(source).not.toMatch(/\n    env:\n(?:      .*\n)*?      .*\$\{\{\s*runner\./u)
    expect(source).not.toContain('actions/upload-artifact')
    expect(source).not.toContain('m2-h1-private-candidate')
    expect(source).not.toMatch(/path:\s*\$\{\{\s*runner\.temp\s*\}\}\/m2-h1-run-store\s*$/mu)
  })

  it('executes H1 only from the exact source-bound checkout while keeping the publication envelope outside that checkout', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('H1_SOURCE_BOUND_PREREGISTRATION')
    expect(source).toContain('H1_BOUND_SOURCE_COMMIT')
    expect(source).toContain('h1-source-bound-preregistration-v2.json')
    expect(source).toContain('ref: ${{ env.H1_BOUND_SOURCE_COMMIT }}')
    expect(source).toContain('--source-bound-preregistration "$H1_SOURCE_BOUND_PREREGISTRATION"')
  })
})
