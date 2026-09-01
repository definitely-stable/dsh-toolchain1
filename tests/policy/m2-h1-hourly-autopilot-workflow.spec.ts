import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const WORKFLOW = new URL('../../.github/workflows/m2-h1-hourly-autopilot.yml', import.meta.url)

describe('M2 H1 hourly autopilot workflow policy', () => {
  it('checks H1 hourly and may dispatch only one new 48-attempt execution chunk', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('name: M2 H1 Hourly Autopilot')
    expect(source).toContain('schedule:')
    expect(source).toMatch(/cron:\s*['"]17 \* \* \* \*['"]/u)
    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('actions: write')
    expect(source).toContain('contents: read')
    expect(source).toContain('m2-h1-execution.yml')
    expect(source).toContain('max_committed_attempts=48')
    expect(source).toContain('status=PAUSED')
    expect(source).toContain('status=COMPLETE')
    expect(source).toContain('status=RECOVERY_REQUIRED')
    expect(source).toContain('gh workflow run m2-h1-execution.yml --ref main -f max_committed_attempts=48')
    expect(source).not.toContain('OPENCODE_API_KEY')
    expect(source).not.toContain('M2_H1_DATASET_GZIP_BASE64')
    expect(source).not.toContain('pnpm m2:h1:run')
  })

  it('fails closed on failed/unknown terminal state and rechecks the latest execution before dispatch', async () => {
    const source = await readFile(WORKFLOW, 'utf8')

    expect(source).toContain('LATEST_CONCLUSION')
    expect(source).toContain('LATEST_STATUS')
    expect(source).toContain('CURRENT_LATEST_ID')
    expect(source).toContain('if [[ "$CURRENT_LATEST_ID" != "$LATEST_ID" ]]')
    expect(source).toContain('Latest H1 execution did not succeed; autopilot will not dispatch')
    expect(source).toContain('H1 execution requires recovery; autopilot will not dispatch')
    expect(source).toContain('Unable to determine terminal H1 execution status')
  })
})
