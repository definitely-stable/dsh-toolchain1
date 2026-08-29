import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { validateAgentV2ResultAgainstDefinition } from './m2-agent-eval-v2-integrity.js'
import {
  createFrozenP0Inputs,
  type FrozenP0ProviderIdentity,
} from './m2-agent-p0-definition.js'
import { executeFrozenP0, type P0ProcessConfiguration } from './m2-agent-p0-runner.js'

const SUCCESS_CHILD = fileURLToPath(new URL(
  './fixtures/process-executor/p0-calibration-success.mjs',
  import.meta.url,
))
const PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'deepseek',
  requestModel: 'deepseek-v4-pro',
  reviewedSnapshot: 'DeepSeek-V4-Pro-0813',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://api.deepseek.com',
  adapterVersion: 'deepseek-chat-v1',
})

function processConfig(environment: Readonly<Record<string, string>> = {}): P0ProcessConfiguration {
  return {
    command: process.execPath,
    args: [SUCCESS_CHILD],
    cwd: process.cwd(),
    environment: {
      PATH: process.env.PATH ?? '',
      ...environment,
    },
    timeoutMs: 5_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 16 * 1024,
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

describe('M2.3 frozen P0 suite runner', () => {
  it('executes all 72 scheduled runs in order through one fresh process per attempt and finalizes CALIBRATED', async () => {
    const frozen = await createFrozenP0Inputs(PROVIDER)
    const { definition, result } = await executeFrozenP0(frozen, processConfig())
    const resultRecord = record(result, 'P0 result')
    const runs = array(resultRecord.runs, 'P0 result runs')

    expect(resultRecord.status).toBe('CALIBRATED')
    expect(runs).toHaveLength(72)
    expect(runs.map(runValue => {
      const run = record(runValue, 'P0 run')
      return { taskId: run.taskId, trial: run.trial, arm: run.arm }
    })).toEqual(frozen.schedule)

    const envelopeHashes = new Map<string, Set<string>>()
    for (const runValue of runs) {
      const run = record(runValue, 'P0 run')
      const arm = string(run.arm, 'P0 run arm')
      const attempts = array(run.attempts, 'P0 attempts')
      expect(attempts).toHaveLength(1)
      const attempt = record(attempts[0], 'P0 attempt')
      expect(attempt.attempt).toBe(1)
      expect(attempt.outcome).toBe('model-outcome')
      expect(attempt.taskSuccess).toBe('SUCCESS')

      const claims = array(attempt.parsedApiClaims, 'P0 parsed claims')
      expect(claims.length).toBeGreaterThan(0)
      for (const claimValue of claims) {
        const claim = record(claimValue, 'P0 canonical claim')
        expect(typeof claim.text).toBe('string')
        expect(['VALID', 'INVALID', 'UNKNOWN']).toContain(claim.classification)
        expect(Array.isArray(claim.oracleEvidenceIds)).toBe(true)
        expect(claim).not.toHaveProperty('package')
        expect(claim).not.toHaveProperty('reason')
      }

      const evidence = record(attempt.executionEvidence, 'P0 execution evidence')
      const envelope = record(evidence.modelEnvelope, 'P0 model envelope ref')
      const envelopeSha = string(envelope.sha256, 'P0 model envelope sha')
      const envelopeKey = `${String(run.taskId)}/${arm}`
      const hashes = envelopeHashes.get(envelopeKey) ?? new Set<string>()
      hashes.add(envelopeSha)
      envelopeHashes.set(envelopeKey, hashes)

      const traceRef = record(evidence.trace, 'P0 trace ref')
      const trace = record(JSON.parse(string(traceRef.inline, 'P0 trace inline')), 'P0 trace')
      const entries = array(trace.entries, 'P0 trace entries').map(value => record(value, 'P0 trace entry'))
      if (arm === 'A') {
        expect(entries).toEqual([])
      } else if (arm === 'B') {
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ family: 'ordinary', name: 'search_text', status: 'ok' })
      } else {
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({ family: 'toolchain', name: 'toolchain_contract_search', status: 'ok' })
      }
    }

    expect([...envelopeHashes.values()].every(hashes => hashes.size === 1)).toBe(true)
    await expect(validateAgentV2ResultAgainstDefinition(
      definition,
      result,
      createNodeSha256Port(),
    )).resolves.toBeUndefined()
  }, 120_000)

  it('retries only the preregistered provider-transport failures, preserves evidence, and finalizes INCONCLUSIVE', async () => {
    const frozen = await createFrozenP0Inputs(PROVIDER)
    const { definition, result } = await executeFrozenP0(frozen, processConfig({
      M2_FIXTURE_FAIL_ORDINARY_P0_01: '1',
    }))
    const resultRecord = record(result, 'P0 result')
    const runs = array(resultRecord.runs, 'P0 result runs')

    expect(resultRecord.status).toBe('INCONCLUSIVE')
    expect(runs).toHaveLength(72)

    const failedRuns = runs
      .map(value => record(value, 'P0 run'))
      .filter(run => run.taskId === 'p0-01' && run.arm === 'B')
    expect(failedRuns).toHaveLength(3)

    for (const run of failedRuns) {
      const attempts = array(run.attempts, 'failed P0 attempts')
      expect(attempts).toHaveLength(2)
      expect(attempts.map(value => record(value, 'failed P0 attempt').outcome)).toEqual([
        'infrastructure-failure',
        'infrastructure-failure',
      ])
      expect(attempts.map(value => record(value, 'failed P0 attempt').reason)).toEqual([
        'provider-transport',
        'provider-transport',
      ])

      const evidence = attempts.map(value => record(record(value, 'failed P0 attempt').executionEvidence, 'failed evidence'))
      const envelopeHashes = evidence.map(item => string(record(item.modelEnvelope, 'model envelope ref').sha256, 'model envelope sha'))
      expect(new Set(envelopeHashes).size).toBe(1)

      const isolations = evidence.map(item => {
        const ref = record(item.isolationReceipt, 'isolation ref')
        return record(JSON.parse(string(ref.inline, 'isolation inline')), 'isolation receipt')
      })
      expect(new Set(isolations.map(item => item.sessionIdSha256)).size).toBe(2)
      expect(new Set(isolations.map(item => item.mutableEnvironmentIdSha256)).size).toBe(2)
    }

    const allAttempts = runs.flatMap(runValue => array(record(runValue, 'P0 run').attempts, 'P0 attempts'))
    expect(allAttempts).toHaveLength(75)
    await expect(validateAgentV2ResultAgainstDefinition(
      definition,
      result,
      createNodeSha256Port(),
    )).resolves.toBeUndefined()
  }, 120_000)
})
