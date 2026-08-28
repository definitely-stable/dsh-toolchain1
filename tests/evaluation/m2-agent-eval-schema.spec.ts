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
        mcidAbsoluteReduction: null,
      },
      guardrail: {
        name: 'task-success-noninferiority',
        margin: null,
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

  it('requires frozen MCID and noninferiority margin for H1 and a terminal result status for results', async () => {
    const { ajv, validate } = await validator()
    const definition = validDefinition()
    const h1 = {
      ...definition,
      evaluationId: 'm2-agent-eval-h1-v1',
      phase: 'H1',
      dataset: {
        id: 'H1',
        taskCount: 24,
        commitmentSha256: '1'.repeat(64),
        hiddenUntilRunComplete: true,
      },
      metrics: {
        ...(definition.metrics as JsonObject),
        primary: {
          name: 'invalid-api-task-rate',
          comparison: 'C-vs-B',
          mcidAbsoluteReduction: null,
        },
        guardrail: {
          name: 'task-success-noninferiority',
          margin: null,
        },
      },
    }
    expect(validate(h1), ajv.errorsText(validate.errors)).toBe(false)

    const frozenH1 = structuredClone(h1) as JsonObject
    const metrics = frozenH1.metrics as JsonObject
    ;(metrics.primary as JsonObject).mcidAbsoluteReduction = 0.1
    ;(metrics.guardrail as JsonObject).margin = 0.05
    expect(validate(frozenH1), ajv.errorsText(validate.errors)).toBe(true)

    expect(validate({ ...frozenH1, recordType: 'result', status: 'PREREGISTERED' }), ajv.errorsText(validate.errors)).toBe(false)
    for (const status of ['PASS', 'NEEDS-IMPROVEMENT', 'INCONCLUSIVE']) {
      expect(validate({ ...frozenH1, recordType: 'result', status }), ajv.errorsText(validate.errors)).toBe(true)
    }
  })
})
