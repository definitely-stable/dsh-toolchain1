import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'

import { afterEach, describe, expect, test } from 'vitest'

import { writeSyntheticCalibrationDataset } from './dsh-eval-test-fixture.js'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

async function plan(mode: string): Promise<Record<string, unknown>> {
  const fixture = await writeSyntheticCalibrationDataset()
  temporaryRoots.push(fixture.root)
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/eval/dsh-eval-plan.mjs',
    '--mode', mode,
    '--dataset', fixture.path,
  ], { encoding: 'utf8' })
  return JSON.parse(stdout) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('DSH eval bounded plans', () => {
  test.each([
    ['smoke', 8, 16],
    ['dev', 20, 40],
    ['release', 32, 64],
    ['research', 48, 96],
  ])('%s uses one B/C trial and the exact model-call budget', async (mode, taskCount, modelOutcomes) => {
    const result = await plan(mode)
    expect(result.schema).toBe('dsh-toolchain-eval-plan-v1')
    expect(result.mode).toBe(mode)
    expect(result.arms).toEqual(['B', 'C'])
    expect(result.trialsPerTask).toBe(1)
    expect(result.taskCount).toBe(taskCount)
    expect(result.maxModelOutcomes).toBe(modelOutcomes)
    expect(result.canaryTaskCount).toBe(8)
    expect(result.canaryModelOutcomes).toBe(16)
  })

  test('dev selection has one canary task per domain and no duplicates', async () => {
    const result = await plan('dev')
    const selected = result.selectedTasks as Array<{ id: string; domain: string }>
    const canary = result.canaryTasks as Array<{ id: string; domain: string }>
    expect(selected).toHaveLength(20)
    expect(new Set(selected.map(task => task.id)).size).toBe(20)
    expect(canary).toHaveLength(8)
    expect(new Set(canary.map(task => task.domain)).size).toBe(8)
  })

  test('unknown mode is rejected before any model execution', async () => {
    const fixture = await writeSyntheticCalibrationDataset()
    temporaryRoots.push(fixture.root)
    await expect(execFileAsync(process.execPath, [
      'scripts/eval/dsh-eval-plan.mjs',
      '--mode', 'huge',
      '--dataset', fixture.path,
    ], { encoding: 'utf8' })).rejects.toThrow()
  })
})