import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, test } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

type HealthRow = {
  arm: 'B' | 'C'
  hasModelOutcome: boolean
  formatCompliant: boolean
  decisionResolved: boolean
  unrecoveredInfrastructure: boolean
}

function cleanRows(): HealthRow[] {
  return Array.from({ length: 8 }, (_, index) => index).flatMap(() => ([
    { arm: 'B', hasModelOutcome: true, formatCompliant: true, decisionResolved: true, unrecoveredInfrastructure: false },
    { arm: 'C', hasModelOutcome: true, formatCompliant: true, decisionResolved: true, unrecoveredInfrastructure: false },
  ] as const))
}

async function evaluate(rows: readonly HealthRow[]): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-health-test-'))
  temporaryRoots.push(root)
  const input = join(root, 'rows.json')
  await writeFile(input, JSON.stringify({ schema: 'dsh-toolchain-eval-health-input-v1', rows }), 'utf8')
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/eval/dsh-eval-health.mjs',
    '--input', input,
  ], { encoding: 'utf8' })
  return JSON.parse(stdout) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH eval measurement health', () => {
  test('clean 16-outcome canary is healthy', async () => {
    const result = await evaluate(cleanRows())
    expect(result.status).toBe('HEALTHY')
    expect(result.violations).toEqual([])
    expect(result.decisionResolutionRate).toBe(1)
    expect(result.armDecisionResolutionGap).toBe(0)
  })

  test('H1-like 50 percent decision resolution aborts expansion', async () => {
    const rows = cleanRows().map((row, index) => ({ ...row, decisionResolved: index % 2 === 0 }))
    const result = await evaluate(rows)
    expect(result.status).toBe('MEASUREMENT_INVALID')
    expect(result.violations).toContain('decisionResolutionRate')
  })

  test('large B/C resolution gap is invalid even when aggregate resolution looks high', async () => {
    const rows = cleanRows()
    rows[1] = { ...rows[1]!, decisionResolved: false }
    const result = await evaluate(rows)
    expect(result.status).toBe('MEASUREMENT_INVALID')
    expect(result.violations).toContain('armDecisionResolutionGap')
  })

  test('unrecovered infrastructure beyond threshold is invalid', async () => {
    const rows = cleanRows()
    rows[0] = {
      ...rows[0]!,
      hasModelOutcome: false,
      formatCompliant: false,
      decisionResolved: false,
      unrecoveredInfrastructure: true,
    }
    const result = await evaluate(rows)
    expect(result.status).toBe('MEASUREMENT_INVALID')
    expect(result.violations).toContain('unrecoveredInfrastructureRate')
  })

  test('recovered infrastructure is not counted as unrecovered missingness', async () => {
    const result = await evaluate(cleanRows())
    expect(result.unrecoveredInfrastructureRate).toBe(0)
  })
})