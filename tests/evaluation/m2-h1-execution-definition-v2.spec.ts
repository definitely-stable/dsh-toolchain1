import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { FROZEN_P0_SYSTEM_PROMPT } from './m2-agent-p0-definition.js'
import type { H1FinalizationResultV2 } from './m2-h1-finalization-v2.js'
import {
  createFrozenH1ExecutionDefinitionV2,
  FROZEN_H1_SYSTEM_PROMPT,
} from './m2-h1-execution-definition-v2.js'
import {
  createSyntheticH1Finalization,
  readSyntheticH1Workspace,
} from './m2-h1-synthetic-fixture-v2.js'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020.js').default as typeof import('ajv/dist/2020.js').default
const addFormats = require('ajv-formats').default as typeof import('ajv-formats').default
const sha256 = createNodeSha256Port()

async function schemaValidator() {
  const path = fileURLToPath(new URL(
    '../../docs/evaluation/m2/m2-agent-eval-v2.schema.json',
    import.meta.url,
  ))
  const schema = JSON.parse(await readFile(path, 'utf8')) as object
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return { ajv, validate: ajv.compile(schema) }
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

describe('M2.3 H1 exact execution definition v2', () => {
  it('constructs one deterministic schema-valid 864-entry H1 definition from finalized private inputs', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const left = await createFrozenH1ExecutionDefinitionV2(finalized, workspace, sha256)
    const right = await createFrozenH1ExecutionDefinitionV2(finalized, workspace, sha256)
    const { ajv, validate } = await schemaValidator()

    expect(left.definitionSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(left.definitionSha256).toBe(right.definitionSha256)
    expect(canonicalizeEvaluationJson(left.definition)).toBe(canonicalizeEvaluationJson(right.definition))
    expect(left.schedule).toHaveLength(864)
    expect(left.modelTasks).toHaveLength(96)
    expect(validate(left.definition), ajv.errorsText(validate.errors)).toBe(true)

    const definition = record(left.definition)
    expect(definition).toMatchObject({
      schema: 'dsh-toolchain-m2-agent-eval-v2',
      recordType: 'definition',
      evaluationId: 'm2-agent-h1-v2',
      phase: 'H1',
      status: 'PREREGISTERED',
    })
    expect(record(definition.dataset)).toMatchObject({
      id: 'H1',
      taskCount: 96,
      commitmentSha256: finalized.commitment.hiddenDataset.sha256,
      hiddenUntilRunComplete: true,
    })
  })

  it('binds Truth v2 and the full finalized measurement/design/analysis commitment without leaking private evaluator fields', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalized, workspace, sha256)
    const definition = record(frozen.definition)
    const oracle = record(definition.oracle)
    const metrics = record(definition.metrics)
    const primary = record(metrics.primary)
    const guardrail = record(metrics.guardrail)
    const commitmentSha256 = await sha256.sha256Utf8(canonicalizeEvaluationJson(finalized.commitment))
    const execution = record(definition.execution)
    const runnerIdentity = JSON.parse(String(record(execution.runnerIdentity).inline)) as Record<string, unknown>

    expect(oracle).toEqual({
      version: 'dsh-api-truth-v2',
      sha256: '14ab2c32fa1307de300d09715b30a147a9ffe7884335ee0f19ebc5cb018871bb',
      classifications: ['VALID', 'INVALID', 'UNKNOWN'],
      unknownAutoInvalid: false,
    })
    expect(primary).toMatchObject({
      mcidAbsoluteReduction: 0.1,
      uncertainty: {
        method: 'paired-task-percentile-bootstrap',
        confidenceLevel: 0.95,
        sidedness: 'two-sided',
        lowerQuantile: 0.025,
        resamples: 10_000,
        seed: 'm2-v2-primary',
        decisionRule: 'lower-bound-at-least-mcid',
      },
    })
    expect(guardrail).toMatchObject({
      margin: 0.05,
      uncertainty: {
        method: 'paired-task-percentile-bootstrap',
        confidenceLevel: 0.95,
        sidedness: 'two-sided',
        lowerQuantile: 0.025,
        resamples: 10_000,
        seed: 'm2-v2-guardrail',
        decisionRule: 'lower-bound-at-least-negative-margin',
      },
    })
    expect(runnerIdentity).toMatchObject({
      runner: 'dsh-m2-isolated-runner',
      version: '2',
      executorProtocol: 'closed-ndjson-v1',
      scheduleSeed: 'm2-h1-holdout-v2',
      h1CommitmentSha256: commitmentSha256,
      measurement: finalized.commitment.measurement,
      prospectiveDesign: finalized.commitment.prospectiveDesign,
      thresholds: finalized.commitment.thresholds,
      analysis: finalized.commitment.analysis,
    })

    const serialized = canonicalizeEvaluationJson(frozen.definition)
    expect(serialized).not.toContain('successRule')
    expect(serialized).not.toContain('"domain"')
    expect(serialized).not.toContain('On the exact installed DSH target')
    expect(frozen.modelTasks.every(task => Object.keys(task).join(',') === 'id,prompt')).toBe(true)
  })

  it('keeps the P0/H1 model-visible prompt and capability boundary identical except for the frozen task set', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalized, workspace, sha256)

    expect(FROZEN_H1_SYSTEM_PROMPT).toBe(FROZEN_P0_SYSTEM_PROMPT)
    expect(frozen.capabilityManifests.A.tools).toEqual([])
    expect(frozen.capabilityManifests.C.tools.slice(0, frozen.capabilityManifests.B.tools.length))
      .toEqual(frozen.capabilityManifests.B.tools)
    expect(frozen.capabilityManifests.C.tools.slice(frozen.capabilityManifests.B.tools.length).map(tool => tool.name))
      .toEqual(['toolchain_contract_search', 'toolchain_contract_inspect'])

    const definition = record(frozen.definition)
    const harness = record(definition.harness)
    expect(harness.systemPromptSha256).toBe(await sha256.sha256Utf8(FROZEN_P0_SYSTEM_PROMPT))
    expect(harness.staticDocsSha256).toBe(workspace.documentationSha256)
    expect(harness.networkPolicy).toBe('provider-only')
  })

  it('freezes the calibrated resource/retry envelope and binds execution to the managed-gateway receipt and response model', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const frozen = await createFrozenH1ExecutionDefinitionV2(finalized, workspace, sha256)
    const provider = finalized.commitment.provider!

    expect(frozen.resourcePolicy).toEqual({
      maxWallTimeMs: 300_000,
      maxTurns: 32,
      maxAttempts: 2,
      concurrency: 1,
      maxInputTokens: 180_000,
      maxOutputTokens: 12_000,
      tokenMeasurementRequired: true,
    })
    expect(frozen.retryPolicy).toEqual({
      maxInfrastructureRetries: 1,
      modelOutcomeRetries: 0,
      retryableReasons: ['provider-transport', 'tool-transport'],
    })
    expect(frozen.ledgerBinding).toEqual({
      definitionSha256: frozen.definitionSha256,
      datasetCommitmentSha256: finalized.commitment.hiddenDataset.sha256,
      providerIdentityReceiptSha256: provider.identityReceiptSha256,
      expectedResponseModel: provider.responseModel,
    })

    const definition = record(frozen.definition)
    const model = record(definition.model)
    expect(model).toEqual({
      provider: provider.provider,
      model: provider.requestModel,
      snapshot: `provider-identity-receipt:${provider.identityReceiptSha256}`,
      reasoning: `thinking=${provider.thinking};effort=${provider.reasoningEffort}`,
    })
    const executorRef = record(record(definition.execution).executorIdentity)
    const executor = JSON.parse(String(executorRef.inline)) as Record<string, unknown>
    expect(executor).toEqual({
      provider: provider.provider,
      baseUrl: provider.baseUrl,
      requestModel: provider.requestModel,
      expectedResponseModel: provider.responseModel,
      adapterVersion: provider.adapterVersion,
      thinking: provider.thinking,
      reasoningEffort: provider.reasoningEffort,
      identityMode: 'managed-gateway',
      providerIdentityReceiptSha256: provider.identityReceiptSha256,
    })
    expect(JSON.stringify(executor)).not.toContain('SystemFingerprint')
    expect(JSON.stringify(frozen.ledgerBinding)).not.toContain('BackendFingerprint')
  })

  it('fails closed when the exact ordinary workspace drifts', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const drifted = structuredClone(workspace)
    drifted.documentationSha256 = '0'.repeat(64)

    await expect(createFrozenH1ExecutionDefinitionV2(finalized, drifted, sha256))
      .rejects.toThrow(/workspace|documentation|identity|drift/iu)
  })

  it('fails closed when finalized model-visible task bytes no longer match their committed projection hash', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const tampered = structuredClone(finalized) as unknown as H1FinalizationResultV2 & {
      modelTasks: Array<{ id: string; prompt: string }>
    }
    tampered.modelTasks[0]!.prompt = `${tampered.modelTasks[0]!.prompt} drift`

    await expect(createFrozenH1ExecutionDefinitionV2(tampered, workspace, sha256))
      .rejects.toThrow(/projection|task|commitment|hash/iu)
  })

  it('fails closed on internally inconsistent COMMITTED-looking finalization state', async () => {
    const [finalized, workspace] = await Promise.all([
      createSyntheticH1Finalization(),
      readSyntheticH1Workspace(),
    ])
    const tampered = structuredClone(finalized) as unknown as H1FinalizationResultV2 & {
      readiness: { status: 'READY' | 'BLOCKED'; blockers: string[]; runAllowed: boolean }
    }
    tampered.readiness = { status: 'READY', blockers: ['PROVIDER_IDENTITY_NOT_FROZEN'], runAllowed: true }

    await expect(createFrozenH1ExecutionDefinitionV2(tampered, workspace, sha256))
      .rejects.toThrow(/readiness|finalization|blocker|consistent/iu)
  })

  it('changes definition and ledger receipt binding when committed provider probe evidence changes', async () => {
    const workspace = await readSyntheticH1Workspace()
    const [leftFinalized, rightFinalized] = await Promise.all([
      createSyntheticH1Finalization(64),
      createSyntheticH1Finalization(65),
    ])
    const [left, right] = await Promise.all([
      createFrozenH1ExecutionDefinitionV2(leftFinalized, workspace, sha256),
      createFrozenH1ExecutionDefinitionV2(rightFinalized, workspace, sha256),
    ])

    expect(left.definitionSha256).not.toBe(right.definitionSha256)
    expect(left.ledgerBinding.providerIdentityReceiptSha256).not.toBe(right.ledgerBinding.providerIdentityReceiptSha256)
    expect(left.ledgerBinding.expectedResponseModel).toBe('deepseek-v4-flash')
    expect(right.ledgerBinding.expectedResponseModel).toBe('deepseek-v4-flash')
  })
})
