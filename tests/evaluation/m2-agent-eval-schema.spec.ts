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

async function validator() {
  const path = fileURLToPath(
    new URL('../../docs/evaluation/m2/m2-agent-eval-v1.schema.json', import.meta.url),
  )
  const schema = JSON.parse(await readFile(path, 'utf8')) as object
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return { ajv, validate: ajv.compile(schema) }
}

function validDefinition(): JsonObject {
  return {
    schema: 'dsh-toolchain-m2-agent-eval-v1',
    recordType: 'definition',
    evaluationId: 'm2-agent-eval-p0-v1',
    phase: 'P0',
    status: 'PREREGISTERED',
    target: {
      package: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      profile: 'web',
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: INDEX_FINGERPRINT,
    },
    model: {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      snapshot: 'gpt-5.6-sol-2026-08-28',
      reasoning: 'medium',
    },
    harness: {
      runner: 'external-recorded-runner',
      version: '1',
      systemPromptSha256: 'a'.repeat(64),
      taskPromptSha256: 'b'.repeat(64),
      toolSchemaSha256: 'c'.repeat(64),
      staticDocsSha256: 'd'.repeat(64),
      networkPolicy: 'provider-only',
    },
    arms: {
      A: { mode: 'memory', ordinaryTools: false, toolchain: false },
      B: { mode: 'conventional-exact-target', ordinaryTools: true, toolchain: false },
      C: {
        mode: 'conventional-exact-target-plus-toolchain',
        ordinaryTools: true,
        toolchain: true,
        toolNames: ['contract.search', 'contract.inspect'],
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
      seed: 'm2-agent-p0-v1',
      trialsPerTaskArm: 3,
      schedule: [
        { taskId: 'p0-01', trial: 1, arm: 'A' },
        { taskId: 'p0-01', trial: 1, arm: 'B' },
        { taskId: 'p0-01', trial: 1, arm: 'C' },
      ],
    },
    metrics: {
      primary: {
        name: 'invalid-api-task-rate',
        comparison: 'C-vs-B',
        trialToTaskAggregation: 'mean-trial-invalid-indicator',
        mcidAbsoluteReduction: null,
        uncertainty: {
          method: 'paired-task-bootstrap',
          confidenceLevel: 0.95,
          resamples: 10000,
          seed: 'm2-agent-primary-bootstrap-v1',
          decisionRule: 'lower-bound-at-least-mcid',
        },
      },
      guardrail: {
        name: 'task-success-noninferiority',
        trialToTaskAggregation: 'mean-trial-success-indicator',
        margin: null,
        uncertainty: {
          method: 'paired-task-bootstrap',
          confidenceLevel: 0.95,
          resamples: 10000,
          seed: 'm2-agent-guardrail-bootstrap-v1',
          decisionRule: 'lower-bound-at-least-negative-margin',
        },
      },
      secondary: ['valid-first-api-claim-rate', 'toolchain-use-rate', 'model-tokens', 'wall-time'],
    },
    oracle: {
      version: 'api-oracle-v1',
      sha256: 'e'.repeat(64),
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    },
    dataset: {
      id: 'P0',
      taskCount: 8,
      commitmentSha256: 'f'.repeat(64),
      hiddenUntilRunComplete: false,
    },
  }
}

function frozenH1Definition(): JsonObject {
  const h1 = structuredClone(validDefinition()) as JsonObject
  h1.evaluationId = 'm2-agent-eval-h1-v1'
  h1.phase = 'H1'
  h1.dataset = {
    id: 'H1',
    taskCount: 24,
    commitmentSha256: '1'.repeat(64),
    hiddenUntilRunComplete: true,
  }
  const metrics = h1.metrics as JsonObject
  ;(metrics.primary as JsonObject).mcidAbsoluteReduction = 0.1
  ;(metrics.guardrail as JsonObject).margin = 0.05
  return h1
}

function validResult(): JsonObject {
  return {
    ...frozenH1Definition(),
    recordType: 'result',
    status: 'PASS',
    definitionSha256: '2'.repeat(64),
    executedAt: '2026-08-28T05:30:00.000Z',
    runs: [
      {
        taskId: 'h1-01',
        arm: 'C',
        trial: 1,
        attempts: [
          {
            attempt: 1,
            startedAt: '2026-08-28T05:29:00.000Z',
            completedAt: '2026-08-28T05:29:15.000Z',
            outcome: 'model-outcome',
            rawAnswer: {
              reference: 'evidence/h1/h1-01-C-1-answer.txt',
              sha256: '3'.repeat(64),
            },
            parsedApiClaims: [
              {
                text: 'ctx.tools.register',
                classification: 'VALID',
                oracleEvidenceIds: ['types:@deepseek-ai/dsh-tools:lib/types/index.d.ts'],
              },
            ],
            taskSuccess: 'SUCCESS',
          },
        ],
      },
    ],
  }
}

function removePath(source: JsonObject, first: string, second?: string): JsonObject {
  const candidate = structuredClone(source)
  if (second === undefined) {
    delete candidate[first]
    return candidate
  }
  const nested = candidate[first] as JsonObject
  delete nested[second]
  return candidate
}

describe('M2.3 agent evaluation v1 schema', () => {
  it('accepts the preregistered P0 shape and pins exact target/index plus A/B/C semantics', async () => {
    const { ajv, validate } = await validator()
    const definition = validDefinition()

    expect(validate(definition), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate({
      ...definition,
      target: {
        ...(definition.target as JsonObject),
        targetFingerprint: `dsh-target-v2:${'0'.repeat(64)}`,
      },
    }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate({
      ...definition,
      target: {
        ...(definition.target as JsonObject),
        contractIndexFingerprint: `dsh-contract-index-v1:${'0'.repeat(64)}`,
      },
    }), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('requires model, harness, global resource envelope, retry policy, run order and decision metrics', async () => {
    const { ajv, validate } = await validator()
    const definition = validDefinition()
    const invalid = [
      removePath(definition, 'model', 'snapshot'),
      removePath(definition, 'harness', 'toolSchemaSha256'),
      removePath(definition, 'resources', 'maxInputTokens'),
      removePath(definition, 'retries', 'maxInfrastructureRetries'),
      removePath(definition, 'runOrder', 'seed'),
      removePath(definition, 'runOrder', 'schedule'),
      removePath(definition, 'metrics', 'primary'),
      removePath(definition, 'metrics', 'guardrail'),
      removePath(definition, 'status'),
    ]

    for (const candidate of invalid) {
      expect(validate(candidate), ajv.errorsText(validate.errors)).toBe(false)
    }
  })

  it('forbids model-outcome retries, altered arm semantics and eval-specific UNKNOWN coercion', async () => {
    const { ajv, validate } = await validator()
    const definition = validDefinition()

    expect(validate({
      ...definition,
      retries: { ...(definition.retries as JsonObject), modelOutcomeRetries: 1 },
    }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate({
      ...definition,
      arms: {
        ...(definition.arms as JsonObject),
        C: { mode: 'memory', ordinaryTools: false, toolchain: false },
      },
    }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate({
      ...definition,
      oracle: { ...(definition.oracle as JsonObject), unknownAutoInvalid: true },
    }), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('requires frozen H1 thresholds and preregistered task-level aggregation plus uncertainty rules', async () => {
    const { ajv, validate } = await validator()
    const h1 = structuredClone(frozenH1Definition()) as JsonObject
    const metrics = h1.metrics as JsonObject

    ;(metrics.primary as JsonObject).mcidAbsoluteReduction = null
    expect(validate(h1), ajv.errorsText(validate.errors)).toBe(false)
    ;(metrics.primary as JsonObject).mcidAbsoluteReduction = 0.1
    ;(metrics.guardrail as JsonObject).margin = null
    expect(validate(h1), ajv.errorsText(validate.errors)).toBe(false)

    const frozen = frozenH1Definition()
    expect(validate(frozen), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate(removePath(frozen, 'metrics', 'primary')), ajv.errorsText(validate.errors)).toBe(false)

    const withoutAggregation = structuredClone(frozen) as JsonObject
    delete ((withoutAggregation.metrics as JsonObject).primary as JsonObject).trialToTaskAggregation
    expect(validate(withoutAggregation), ajv.errorsText(validate.errors)).toBe(false)

    const withoutUncertainty = structuredClone(frozen) as JsonObject
    delete ((withoutUncertainty.metrics as JsonObject).primary as JsonObject).uncertainty
    expect(validate(withoutUncertainty), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('requires every result to be definition-bound and carry auditable raw outcomes, claims and task success', async () => {
    const { ajv, validate } = await validator()
    const result = validResult()

    expect(validate(result), ajv.errorsText(validate.errors)).toBe(true)
    expect(validate({ ...result, status: 'PREREGISTERED' }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate(removePath(result, 'definitionSha256')), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate(removePath(result, 'executedAt')), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate(removePath(result, 'runs')), ajv.errorsText(validate.errors)).toBe(false)

    const missingRaw = structuredClone(result) as JsonObject
    const modelAttempt = (((missingRaw.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!)
    delete modelAttempt.rawAnswer
    expect(validate(missingRaw), ajv.errorsText(validate.errors)).toBe(false)

    const missingClaims = structuredClone(result) as JsonObject
    delete ((((missingClaims.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!) as JsonObject).parsedApiClaims
    expect(validate(missingClaims), ajv.errorsText(validate.errors)).toBe(false)

    const missingTaskSuccess = structuredClone(result) as JsonObject
    delete ((((missingTaskSuccess.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!) as JsonObject).taskSuccess
    expect(validate(missingTaskSuccess), ajv.errorsText(validate.errors)).toBe(false)

    const unknown = structuredClone(result) as JsonObject
    const claim = (((((unknown.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!).parsedApiClaims as JsonObject[])[0]!)
    claim.classification = 'UNKNOWN'
    claim.oracleEvidenceIds = []
    expect(validate(unknown), ajv.errorsText(validate.errors)).toBe(true)

    const unsupportedClassification = structuredClone(result) as JsonObject
    const unsupportedClaim = (((((unsupportedClassification.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!).parsedApiClaims as JsonObject[])[0]!)
    unsupportedClaim.classification = 'WRONG'
    expect(validate(unsupportedClassification), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('keeps infrastructure failures auditable without pretending they are model outcomes', async () => {
    const { ajv, validate } = await validator()
    const result = validResult()
    const infraResult = structuredClone(result) as JsonObject
    const run = (infraResult.runs as JsonObject[])[0]!
    run.attempts = [
      {
        attempt: 1,
        startedAt: '2026-08-28T05:29:00.000Z',
        completedAt: '2026-08-28T05:29:01.000Z',
        outcome: 'infrastructure-failure',
        reason: 'provider-transport',
        detail: 'connection reset before model outcome',
      },
      (((result.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!),
    ]
    ;(run.attempts as JsonObject[])[1]!.attempt = 2

    expect(validate(infraResult), ajv.errorsText(validate.errors)).toBe(true)

    const fakeModelEvidence = structuredClone(infraResult) as JsonObject
    const infraAttempt = (((fakeModelEvidence.runs as JsonObject[])[0]!.attempts as JsonObject[])[0]!)
    infraAttempt.rawAnswer = { reference: 'fake', sha256: '4'.repeat(64) }
    expect(validate(fakeModelEvidence), ajv.errorsText(validate.errors)).toBe(false)
  })

  it('does not allow result-only evidence fields on preregistered definitions', async () => {
    const { ajv, validate } = await validator()
    const definition = frozenH1Definition()

    expect(validate({ ...definition, definitionSha256: '2'.repeat(64) }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate({ ...definition, executedAt: '2026-08-28T05:30:00.000Z' }), ajv.errorsText(validate.errors)).toBe(false)
    expect(validate({ ...definition, runs: [] }), ajv.errorsText(validate.errors)).toBe(false)
  })
})
