import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default

const TARGET_FINGERPRINT = 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe'
const INDEX_FINGERPRINT = 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2'

type JsonObject = Record<string, unknown>

function contentRef(char: string): JsonObject {
  return {
    sha256: char.repeat(64),
    mediaType: 'application/json',
    canonicalization: 'utf8-bytes-v1',
    byteLength: 2,
    inline: '{}',
  }
}

async function validator() {
  const path = fileURLToPath(new URL(
    '../../docs/evaluation/m2/m2-agent-eval-v2.schema.json',
    import.meta.url,
  ))
  const schema = JSON.parse(await readFile(path, 'utf8')) as object
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return { ajv, validate: ajv.compile(schema) }
}

function definition(phase: 'P0' | 'H1', oracleVersion: 'api-oracle-v1' | 'dsh-api-truth-v2'): JsonObject {
  const h1 = phase === 'H1'
  return {
    schema: 'dsh-toolchain-m2-agent-eval-v2',
    recordType: 'definition',
    evaluationId: h1 ? 'm2-agent-h1-v2' : 'm2-agent-p0-v2',
    phase,
    status: 'PREREGISTERED',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: INDEX_FINGERPRINT,
    },
    model: {
      provider: 'frozen-provider',
      model: 'frozen-model',
      snapshot: 'frozen-snapshot',
      reasoning: 'frozen-reasoning',
    },
    harness: {
      runner: 'dsh-m2-isolated-runner',
      version: '2',
      systemPromptSha256: '1'.repeat(64),
      taskPromptSha256: '2'.repeat(64),
      toolSchemaSha256: '3'.repeat(64),
      staticDocsSha256: '4'.repeat(64),
      networkPolicy: 'provider-only',
    },
    arms: {
      A: { mode: 'memory', ordinaryTools: false, toolchain: false },
      B: { mode: 'conventional-exact-target', ordinaryTools: true, toolchain: false },
      C: {
        mode: 'conventional-exact-target-plus-toolchain',
        ordinaryTools: true,
        toolchain: true,
        toolNames: ['toolchain_contract_search', 'toolchain_contract_inspect'],
      },
    },
    resources: {
      maxTurns: 32,
      maxInputTokens: 180_000,
      maxOutputTokens: 12_000,
      wallTimeMs: 300_000,
      concurrency: 1,
    },
    retries: {
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0,
      retryableReasons: ['provider-transport', 'tool-transport'],
    },
    runOrder: {
      seed: h1 ? 'm2-h1-holdout-v2' : 'm2-p0-calibration-v1',
      trialsPerTaskArm: 3,
      schedule: [{ taskId: h1 ? 'h1-synthetic-001' : 'p0-01', trial: 1, arm: 'A' }],
    },
    metrics: {
      primary: {
        name: 'invalid-api-task-rate',
        comparison: 'C-vs-B',
        trialToTaskAggregation: 'mean-trial-invalid-indicator',
        mcidAbsoluteReduction: h1 ? 0.1 : null,
        uncertainty: {
          method: 'paired-task-bootstrap',
          confidenceLevel: 0.95,
          resamples: 10_000,
          seed: 'm2-v2-primary',
          decisionRule: 'lower-bound-at-least-mcid',
        },
      },
      guardrail: {
        name: 'task-success-noninferiority',
        trialToTaskAggregation: 'mean-trial-success-indicator',
        margin: h1 ? 0.05 : null,
        uncertainty: {
          method: 'paired-task-bootstrap',
          confidenceLevel: 0.95,
          resamples: 10_000,
          seed: 'm2-v2-guardrail',
          decisionRule: 'lower-bound-at-least-negative-margin',
        },
      },
      secondary: ['toolchain-use-rate', 'wall-time'],
    },
    oracle: {
      version: oracleVersion,
      sha256: '5'.repeat(64),
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    },
    dataset: {
      id: h1 ? 'H1' : 'P0',
      taskCount: h1 ? 96 : 8,
      commitmentSha256: '6'.repeat(64),
      hiddenUntilRunComplete: h1,
    },
    execution: {
      runnerIdentity: contentRef('7'),
      executorIdentity: contentRef('8'),
      capabilityManifests: {
        A: contentRef('9'),
        B: contentRef('a'),
        C: contentRef('b'),
      },
      resourcePolicy: contentRef('c'),
      retryPolicy: contentRef('d'),
      isolationPolicy: {
        freshModelSession: true,
        memoryCarryover: false,
        workspaceModes: ['fresh', 'read-only-reset'],
        toolStateReset: true,
        parallelMutableStateShared: false,
        retrySessionPolicy: 'fresh-session-per-attempt',
      },
    },
  }
}

describe('M2.3 H1 oracle schema boundary v2', () => {
  it('keeps historical/new P0 on api-oracle-v1 and requires Truth v2 for H1', async () => {
    const { ajv, validate } = await validator()

    expect(validate(definition('P0', 'api-oracle-v1')), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(definition('P0', 'dsh-api-truth-v2')), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate(definition('H1', 'dsh-api-truth-v2')), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(definition('H1', 'api-oracle-v1')), ajv.errorsText(validate.errors)).toBe(false)
  })
})
