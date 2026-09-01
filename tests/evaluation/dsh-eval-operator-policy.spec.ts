import { readFile } from 'node:fs/promises'

import { describe, expect, test } from 'vitest'

describe('DSH eval operator repository policy', () => {
  test('workflow is one-dispatch bounded evaluation with dev default and no cron', async () => {
    const workflow = await readFile('.github/workflows/dsh-eval.yml', 'utf8')
    expect(workflow).toContain('name: DSH Eval')
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toContain('schedule:')
    expect(workflow).toContain("default: 'dev'")
    for (const mode of ['smoke', 'dev', 'release', 'research']) {
      expect(workflow).toContain(`- '${mode}'`)
    }
    const planIndex = workflow.indexOf('pnpm eval:plan')
    const runIndex = workflow.indexOf('pnpm eval:run')
    expect(planIndex).toBeGreaterThan(-1)
    expect(runIndex).toBeGreaterThan(planIndex)
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('MEASUREMENT_INVALID')
  })

  test('skill defaults to small dev evaluation and stops instead of escalating unhealthy measurement', async () => {
    const skill = await readFile('.agents/skills/dsh-eval/SKILL.md', 'utf8')
    expect(skill).toContain('$dsh-eval')
    expect(skill).toContain('default')
    expect(skill).toContain('dev')
    expect(skill).toContain('40')
    expect(skill).toContain('16')
    expect(skill).toContain('MEASUREMENT_INVALID')
    expect(skill).toContain('DISCLOSED_CALIBRATION')
    expect(skill).toMatch(/research.*explicit/is)
    expect(skill).toMatch(/do not.*chunk/is)
  })

  test('one-shot H1 finalizer is retired after canonical terminal and post-analysis completed', async () => {
    await expect(readFile('.github/workflows/m2-h1-finalize-once.yml', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})