import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const workflowUrl = new URL('.github/workflows/m2-p0-live.yml', root)

function stepBlock(source: string, name: string): string {
  const marker = `      - name: ${name}`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Missing workflow step: ${name}`)
  const next = source.indexOf('\n      - ', start + marker.length)
  return source.slice(start, next < 0 ? undefined : next)
}

describe('M2.3 live P0 workflow policy', () => {
  it('is explicit issue-comment-only execution gated to #43, one command and one actor', async () => {
    const workflow = await readFile(workflowUrl, 'utf8')

    expect(workflow).toContain('  issue_comment:')
    expect(workflow).toContain('    types: [created]')
    expect(workflow).not.toMatch(/^\s{2}(push|pull_request|schedule|workflow_run):/mu)
    expect(workflow).toContain('github.event.issue.number == 43')
    expect(workflow).toContain("github.event.comment.body == '/run-m2-p0-opencode-go'")
    expect(workflow).toContain("github.event.comment.user.login == 'MrFr3di'")
    expect(workflow).toContain('github.event.issue.pull_request == null')
  })

  it('keeps permissions read-only and checks out the exact workflow revision with pinned bootstrap actions', async () => {
    const workflow = await readFile(workflowUrl, 'utf8')

    expect(workflow).toMatch(/permissions:\n\s+contents: read/u)
    expect(workflow).toContain('actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09')
    expect(stepBlock(workflow, 'Checkout exact live-evaluation revision')).toContain('ref: ${{ github.workflow_sha }}')
    expect(workflow).toContain('pnpm/setup@84cb39b217b10273981911c288cd62326dc7c6d2')
    expect(workflow).toContain('actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444')
    expect(workflow).toContain('cache: pnpm')
    expect(workflow).toContain('cache-dependency-path: pnpm-lock.yaml')
    expect(workflow).toContain('package-manager-cache: false')
    expect(workflow).not.toContain('actions/cache@')
  })

  it('scopes the provider secret only to probe and P0 execution and preserves their ordering/binding', async () => {
    const workflow = await readFile(workflowUrl, 'utf8')
    const probe = stepBlock(workflow, 'Probe OpenCode Go backend identity')
    const execute = stepBlock(workflow, 'Execute live P0 calibration')

    expect((workflow.match(/OPENCODE_API_KEY:/gu) ?? [])).toHaveLength(2)
    expect(probe).toContain('OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}')
    expect(execute).toContain('OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}')
    expect(probe).toContain('node scripts/probe-m2-opencode-go.mjs --output "$RUNNER_TEMP/m2-p0-live/probe.json"')
    expect(execute).toContain('node scripts/run-m2-p0-opencode-go.mjs')
    expect(execute).toContain('--probe "$RUNNER_TEMP/m2-p0-live/probe.json"')
    expect(execute).toContain('--output "$RUNNER_TEMP/m2-p0-live/result.json"')
    expect(workflow.indexOf('Probe OpenCode Go backend identity')).toBeLessThan(workflow.indexOf('Execute live P0 calibration'))
  })

  it('retains only probe/result JSON for one day and never persists product/build state', async () => {
    const workflow = await readFile(workflowUrl, 'utf8')
    const upload = stepBlock(workflow, 'Upload canonical P0 evidence')

    expect(upload).toContain('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02')
    expect(upload).toContain('retention-days: 1')
    expect(upload).toContain('${{ runner.temp }}/m2-p0-live/probe.json')
    expect(upload).toContain('${{ runner.temp }}/m2-p0-live/result.json')
    for (const forbidden of ['node_modules', '.artifacts', 'dsh-toolchain.tgz', 'dsh-home', 'lib/']) {
      expect(upload).not.toContain(forbidden)
    }
  })

  it('does not alter the required CI workflow to inject provider credentials or live execution', async () => {
    const required = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8')

    expect(required).not.toContain('OPENCODE_API_KEY')
    expect(required).not.toContain('run-m2-p0-opencode-go')
    expect(required).not.toContain('probe-m2-opencode-go')
  })
})
