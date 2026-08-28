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

function definition(phase: 'P0' | 'H1' = 'P0'): JsonObject {
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
      maxTurns: 12,
      maxInputTokens: 30000,
      maxOutputTokens: 6000,
      wallTimeMs: 300000,
      concurrency: 1,
    },
    retries: {
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0,
      retryableReasons: ['provider-transport', 'tool-transport'],
    },
    runOrder: {
      seed: 'm2-agent-v2-seed',
      trialsPerTaskArm: 3,
      schedule: [
        { taskId: h1 ? 'h1-01' : 'p0-01', trial: 1, arm: 'A' },
      ],
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
          resamples: 10000,
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
          resamples: 10000,
          seed: 'm2-v2-guardrail',
          decisionRule: 'lower-bound-at-least-negative-margin',
        },
      },
      secondary: ['toolchain-use-rate', 'wall-time'],
    },
    oracle: {
      version: 'api-oracle-v1',
      sha256: '5'.repeat(64),
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    },
    dataset: {
      id: h1 ? 'H1' : 'P0',
      taskCount: h1 ? 24 : 8,
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

function executionEvidence(): JsonObject {
  return {
    runControl: contentRef('e'),
    modelEnvelope: contentRef('f'),
    trace: contentRef('1'),
    executorIdentity: contentRef('8'),
    isolationReceipt: contentRef('2'),
    resourceReceipt: contentRef('3'),
  }
}

function result(phase: 'P0' | 'H1' = 'H1'): JsonObject {
  const base = structuredClone(definition(phase)) as JsonObject
  return {
    ...base,
    recordType: 'result',
    status: phase === 'P0' ? 'CALIBRATED' : 'PASS',
    definitionSha256: '4'.repeat(64),
    executedAt: '2026-08-28T10:00:00.000Z',
    runs: [{
      taskId: phase === 'P0' ? 'p0-01' : 'h1-01',
      arm: 'A',
      trial: 1,
      attempts: [{
        attempt: 1,
        startedAt: '2026-08-28T09:59:00.000Z',
        completedAt: '2026-08-28T09:59:10.000Z',
        outcome: 'model-outcome',
        executionEvidence: executionEvidence(),
        rawAnswer: {
          ...contentRef('5'),
          mediaType: 'text/plain',
          byteLength: 6,
          inline: 'answer',
        },
        parsedApiClaims: [],
        taskSuccess: 'SUCCESS',
      }],
    }],
  }
}

describe('M2.3 agent evaluation v2 schema', () => {
  it('accepts closed v2 definition/result shapes with re-hashable execution evidence', async () => {
    const { ajv, validate } = await validator()
    expect(validate(definition()), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(result()), ajv.errorsText(validate.errors)).toBe(true)
  })

  it('rejects naked hashes or missing execution evidence in canonical attempts', async () => {
    const { ajv, validate } = await validator()
    const missing = structuredClone(result()) as JsonObject
    const attempt = ((((missing.runs as JsonObject[])[0]!).attempts as JsonObject[])[0]!)
    delete attempt.executionEvidence
    expect(validate(missing), ajv.errorsText(validate.errors)).toBe(false)

    const naked = structuredClone(result()) as JsonObject
    const nakedAttempt = ((((naked.runs as JsonObject[])[0]!).attempts as JsonObject[])[0]!)
    ;(nakedAttempt.executionEvidence as JsonObject).trace = '1'.repeat(64)
    expect(validate(naked), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('rejects executor-supplied authoritative tool/isolation/resource fields', async () => {
    const { ajv, validate } = await validator()
    const candidate = structuredClone(result()) as JsonObject
    const attempt = ((((candidate.runs as JsonObject[])[0]!).attempts as JsonObject[])[0]!)
    attempt.toolEvents = []
    attempt.sessionIsolation = 'isolated'
    attempt.resourceCompliance = 'compliant'
    expect(validate(candidate), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('rejects historical v1 identity as newly executed v2 evidence', async () => {
    const { ajv, validate } = await validator()
    expect(validate({ ...result(), schema: 'dsh-toolchain-m2-agent-eval-v1' }), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('requires frozen numeric H1 MCID and non-inferiority margin', async () => {
    const { ajv, validate } = await validator()
    const candidate = definition('H1')
    const metrics = candidate.metrics as JsonObject
    ;(metrics.primary as JsonObject).mcidAbsoluteReduction = null
    expect(validate(candidate), ajv.errorsText(validate.errors)).toBe(false)
    ;(metrics.primary as JsonObject).mcidAbsoluteReduction = 0.1
    ;(metrics.guardrail as JsonObject).margin = null
    expect(validate(candidate), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('requires runner evidence even for infrastructure failures and permits bounded partial output', async () => {
    const { ajv, validate } = await validator()
    const candidate = structuredClone(result()) as JsonObject
    const run = (candidate.runs as JsonObject[])[0]!
    run.attempts = [{
      attempt: 1,
      startedAt: '2026-08-28T09:59:00.000Z',
      completedAt: '2026-08-28T09:59:03.000Z',
      outcome: 'infrastructure-failure',
      reason: 'provider-transport',
      qualityIndependent: true,
      executionEvidence: executionEvidence(),
      partialOutput: {
        ...contentRef('6'),
        mediaType: 'text/plain',
        byteLength: 7,
        inline: 'partial',
      },
    }]
    candidate.status = 'INCONCLUSIVE'

    expect(validate(candidate), ajv.errorsText(validate.errors)).toBe(true)
    const missingEvidence = structuredClone(candidate) as JsonObject
    delete (((missingEvidence.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!.executionEvidence)
    expect(validate(missingEvidence), ajv.errorsText(validate.errors)).toBe(false)
  })
})
