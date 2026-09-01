import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { promisify } from 'node:util'

import { afterEach, describe, expect, test } from 'vitest'

import { writeSyntheticCalibrationDataset } from './dsh-eval-test-fixture.js'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH eval calibration runner', () => {
  test('plan-only dev validates disclosed calibration corpus without provider calls', async () => {
    const fixture = await writeSyntheticCalibrationDataset()
    temporaryRoots.push(fixture.root)
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/eval/run-dsh-eval.mjs',
      '--dataset', fixture.path,
      '--mode', 'dev',
      '--output-dir', fixture.root,
      '--plan-only',
    ], { encoding: 'utf8' })
    const result = JSON.parse(stdout) as Record<string, unknown>
    expect(result.status).toBe('PLAN_READY')
    expect(result.corpusRole).toBe('DISCLOSED_CALIBRATION')
    expect(result.mode).toBe('dev')
    expect(result.taskCount).toBe(20)
    expect(result.maxModelOutcomes).toBe(40)
    expect(result.canaryModelOutcomes).toBe(16)
  })

  test('runner source cannot append to the historical H1 durable ledger', async () => {
    const source = await readFile('scripts/eval/run-dsh-eval.mjs', 'utf8')
    expect(source).not.toContain('m2-h1-run-store-v2')
    expect(source).not.toContain('m2-h1-run-ledger-v2')
    expect(source).not.toContain('runH1DurableScheduleV2')
    expect(source).toContain('DISCLOSED_CALIBRATION')
  })
})