import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

const fixtureRoot = new URL('./fixtures/m2/p0-live-33264398212/', import.meta.url)
const manifestUrl = new URL('manifest.json', fixtureRoot)
const probeUrl = new URL('probe.json', fixtureRoot)
const resultUrl = new URL('result.json', fixtureRoot)

interface RetainedManifest {
  readonly schema: string
  readonly source: {
    readonly headSha: string
    readonly definitionSha256: string
    readonly historicalStatus: string
    readonly scheduledRuns: number
    readonly modelOutcomes: number
  }
  readonly files: {
    readonly probe: { readonly sha256: string; readonly byteLength: number }
    readonly result: { readonly sha256: string; readonly byteLength: number }
  }
  readonly immutable: boolean
}

interface RetainedAttempt {
  readonly outcome?: string
  readonly reason?: string
}

interface RetainedRun {
  readonly taskId: string
  readonly arm: 'A' | 'B' | 'C'
  readonly trial: 1 | 2 | 3
  readonly attempts: readonly RetainedAttempt[]
}

interface RetainedResult {
  readonly status: string
  readonly definitionSha256: string
  readonly runs: readonly RetainedRun[]
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('retained M2.3 P0 live evidence', () => {
  it('binds the exact historical bytes and keeps B/C model outcomes complete', async () => {
    const [manifestBytes, probeBytes, resultBytes] = await Promise.all([
      readFile(manifestUrl),
      readFile(probeUrl),
      readFile(resultUrl),
    ])
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as RetainedManifest
    const result = JSON.parse(resultBytes.toString('utf8')) as RetainedResult

    expect(manifest).toMatchObject({
      schema: 'dsh-toolchain-m2-retained-p0-evidence-v1',
      source: {
        headSha: 'fee95e4613ffa32210f0800b7e5a9cbd929f0f6d',
        definitionSha256: '240d1e9ff32c976a55c6a312e16f2046833047c512d33f711bb0eef60c8be2c6',
        historicalStatus: 'INCONCLUSIVE',
        scheduledRuns: 72,
        modelOutcomes: 69,
      },
      immutable: true,
    })
    expect(sha256(probeBytes)).toBe(manifest.files.probe.sha256)
    expect(probeBytes.byteLength).toBe(manifest.files.probe.byteLength)
    expect(sha256(resultBytes)).toBe(manifest.files.result.sha256)
    expect(resultBytes.byteLength).toBe(manifest.files.result.byteLength)

    expect(result.status).toBe('INCONCLUSIVE')
    expect(result.definitionSha256).toBe(manifest.source.definitionSha256)
    expect(result.runs).toHaveLength(72)

    const modelOutcomes = result.runs.filter(run => run.attempts.some(attempt => attempt.outcome === 'model-outcome'))
    expect(modelOutcomes).toHaveLength(69)
    expect(modelOutcomes.filter(run => run.arm === 'B' || run.arm === 'C')).toHaveLength(48)

    const missing = result.runs
      .filter(run => !run.attempts.some(attempt => attempt.outcome === 'model-outcome'))
      .map(run => `${run.taskId}/${run.arm}/${run.trial}`)
      .toSorted()
    expect(missing).toEqual(['p0-03/A/1', 'p0-06/A/1', 'p0-06/A/2'])
  })
})
