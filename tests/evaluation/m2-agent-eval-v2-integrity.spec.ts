import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  canonicalizeEvaluationJson,
  createBalancedAgentSchedule,
  hashEvaluationDefinition,
} from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  createModelEnvelope,
  createResourceReceipt,
  createRunControl,
  createTraceReceipt,
  type CapabilityManifest,
  type ContentRef,
  type IsolationReceipt,
  type ResourcePolicy,
} from './m2-agent-execution-evidence.js'
import { validateAgentV2ResultAgainstDefinition } from './m2-agent-eval-v2-integrity.js'

const TARGET_FINGERPRINT = 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe'
const INDEX_FINGERPRINT = 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2'
const sha256 = createNodeSha256Port()

type JsonObject = Record<string, unknown>

async function jsonRef(value: unknown): Promise<ContentRef> {
  return createInlineContentRef(
    canonicalizeEvaluationJson(value),
    'application/json',
    'utf8-bytes-v1',
    sha256,
  )
}

function manifest(arm: 'A' | 'B' | 'C'): CapabilityManifest {
  const ordinaryEvidence = arm === 'A' ? null : {
    workspaceSnapshotSha256: 'a'.repeat(64),
    roots: ['/workspace/target'],
    readOnly: true as const,
    staticDocsSha256: 'b'.repeat(64),
    networkPolicy: 'provider-only' as const,
    search: { backend: 'frozen-search', version: '1', maxResults: 20 },
  }
  const ordinaryTools = arm === 'A' ? [] : [{
    family: 'ordinary' as const,
    name: 'read_file',
    description: 'Read one file from the frozen exact-target workspace.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  }]
  const toolchain = arm === 'C' ? [
    {
      family: 'toolchain' as const,
      name: 'toolchain_contract_search',
      description: 'Search deterministic evidence-backed contracts for one exact installed DSH target.',
      inputSchema: { type: 'object', required: ['target', 'query'] },
    },
    {
      family: 'toolchain' as const,
      name: 'toolchain_contract_inspect',
      description: 'Inspect one evidence-backed contract against an exact contract-index fingerprint.',
      inputSchema: { type: 'object', required: ['target', 'contractIndexFingerprint', 'contractId'] },
    },
  ] : []
  return {
    schema: 'dsh-toolchain-m2-capability-manifest-v1',
    arm,
    ordinaryEvidence,
    tools: [...ordinaryTools, ...toolchain],
  }
}

async function buildFixture() {
  const manifests = { A: manifest('A'), B: manifest('B'), C: manifest('C') }
  const manifestRefs = {
    A: await jsonRef(manifests.A),
    B: await jsonRef(manifests.B),
    C: await jsonRef(manifests.C),
  }
  const runnerIdentity = await jsonRef({ runner: 'dsh-m2-isolated-runner', version: '2' })
  const executorIdentity = await jsonRef({ provider: 'frozen-provider', model: 'frozen-model', snapshot: 'frozen-snapshot' })
  const resourcePolicy: ResourcePolicy = {
    maxWallTimeMs: 300000,
    maxTurns: 12,
    maxAttempts: 2,
    concurrency: 1,
    maxInputTokens: 30000,
    maxOutputTokens: 6000,
    tokenMeasurementRequired: true,
  }
  const resourcePolicyRef = await jsonRef(resourcePolicy)
  const retryPolicy = {
    maxInfrastructureRetries: 1,
    modelOutcomeRetries: 0 as const,
    retryableReasons: ['provider-transport', 'tool-transport'],
  }
  const retryPolicyRef = await jsonRef(retryPolicy)
  const schedule = await createBalancedAgentSchedule(['p0-01'], 'm2-v2-integrity', sha256)

  const definition: JsonObject = {
    schema: 'dsh-toolchain-m2-agent-eval-v2',
    recordType: 'definition',
    evaluationId: 'm2-agent-p0-v2-integrity',
    phase: 'P0',
    status: 'PREREGISTERED',
    target: {
      package: '@deepseek-ai/dsh', version: '0.1.1-rc.2', profile: 'web',
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: INDEX_FINGERPRINT,
    },
    model: { provider: 'frozen-provider', model: 'frozen-model', snapshot: 'frozen-snapshot', reasoning: 'frozen-reasoning' },
    harness: {
      runner: 'dsh-m2-isolated-runner', version: '2',
      systemPromptSha256: '1'.repeat(64), taskPromptSha256: '2'.repeat(64),
      toolSchemaSha256: '3'.repeat(64), staticDocsSha256: '4'.repeat(64), networkPolicy: 'provider-only',
    },
    arms: {
      A: { mode: 'memory', ordinaryTools: false, toolchain: false },
      B: { mode: 'conventional-exact-target', ordinaryTools: true, toolchain: false },
      C: {
        mode: 'conventional-exact-target-plus-toolchain', ordinaryTools: true, toolchain: true,
        toolNames: ['toolchain_contract_search', 'toolchain_contract_inspect'],
      },
    },
    resources: { maxTurns: 12, maxInputTokens: 30000, maxOutputTokens: 6000, wallTimeMs: 300000, concurrency: 1 },
    retries: retryPolicy,
    runOrder: { seed: 'm2-v2-integrity', trialsPerTaskArm: 3, schedule },
    metrics: {
      primary: {
        name: 'invalid-api-task-rate', comparison: 'C-vs-B', trialToTaskAggregation: 'mean-trial-invalid-indicator',
        mcidAbsoluteReduction: null,
        uncertainty: { method: 'paired-task-bootstrap', confidenceLevel: 0.95, resamples: 10000, seed: 'p', decisionRule: 'lower-bound-at-least-mcid' },
      },
      guardrail: {
        name: 'task-success-noninferiority', trialToTaskAggregation: 'mean-trial-success-indicator', margin: null,
        uncertainty: { method: 'paired-task-bootstrap', confidenceLevel: 0.95, resamples: 10000, seed: 'g', decisionRule: 'lower-bound-at-least-negative-margin' },
      },
      secondary: ['toolchain-use-rate'],
    },
    oracle: { version: 'api-oracle-v1', sha256: '5'.repeat(64), classifications: ['VALID', 'INVALID', 'UNKNOWN'], unknownAutoInvalid: false },
    dataset: { id: 'P0', taskCount: 1, commitmentSha256: '6'.repeat(64), hiddenUntilRunComplete: false },
    execution: {
      runnerIdentity,
      executorIdentity,
      capabilityManifests: manifestRefs,
      resourcePolicy: resourcePolicyRef,
      retryPolicy: retryPolicyRef,
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

  const runs = []
  for (let index = 0; index < schedule.length; index += 1) {
    const entry = schedule[index]!
    const currentManifest = manifests[entry.arm]
    const modelEnvelope = createModelEnvelope({
      systemPrompt: 'Answer the exact-target developer task.',
      task: { id: entry.taskId, prompt: 'Identify a valid DSH API route.' },
      staticContext: entry.arm === 'A' ? [] : [{ docs: 'frozen-rc2' }],
      capabilityManifest: currentManifest,
    })
    const modelEnvelopeRef = await jsonRef(modelEnvelope)
    const runControl = createRunControl({
      evaluationId: definition.evaluationId as string,
      phase: 'P0',
      taskId: entry.taskId,
      arm: entry.arm,
      trial: entry.trial,
      attempt: 1,
      targetFingerprint: TARGET_FINGERPRINT,
      contractIndexFingerprint: INDEX_FINGERPRINT,
      datasetCommitmentSha256: '6'.repeat(64),
      capabilityManifestSha256: manifestRefs[entry.arm].sha256,
      resourcePolicySha256: resourcePolicyRef.sha256,
      retryPolicySha256: retryPolicyRef.sha256,
      executorIdentitySha256: executorIdentity.sha256,
      modelEnvelopeSha256: modelEnvelopeRef.sha256,
    })
    const runControlRef = await jsonRef(runControl)
    const traceReceipt = await createTraceReceipt(runControlRef.sha256, [], sha256)
    const traceRef = await jsonRef(traceReceipt)
    const sessionIdSha256 = await sha256.sha256Utf8(`session-${index}`)
    const mutableEnvironmentIdSha256 = await sha256.sha256Utf8(`environment-${index}`)
    const ordinaryEvidenceSha256 = await sha256.sha256Utf8(entry.arm === 'A' ? 'none' : 'frozen-ordinary-evidence')
    const isolationReceipt: IsolationReceipt = {
      schema: 'dsh-toolchain-m2-isolation-v1',
      runControlSha256: runControlRef.sha256,
      sessionIdSha256,
      freshModelSession: true,
      memoryCarryover: false,
      workspaceMode: 'read-only-reset',
      workspaceSnapshotSha256: 'a'.repeat(64),
      toolStateReset: true,
      ordinaryEvidenceSha256,
      mutableEnvironmentIdSha256,
      parallelMutableStateShared: false,
      retrySessionPolicy: 'fresh-session-per-attempt',
    }
    const isolationRef = await jsonRef(isolationReceipt)
    const resourceReceipt = await createResourceReceipt(
      runControlRef.sha256,
      resourcePolicy,
      { wallTimeMs: 1000, turns: 1, attempts: 1, inputTokens: 100, outputTokens: 50 },
      { wallTime: 'runner', turns: 'runner', tokens: 'provider-reported' },
      sha256,
    )
    const resourceRef = await jsonRef(resourceReceipt)
    const rawAnswer = await createInlineContentRef('Use the frozen exact-target API.', 'text/plain', 'utf8-bytes-v1', sha256)
    const providerMetadata = await jsonRef({ completionId: `completion-${index}`, finishReason: 'stop', inputTokens: 100, outputTokens: 50 })

    runs.push({
      taskId: entry.taskId,
      arm: entry.arm,
      trial: entry.trial,
      attempts: [{
        attempt: 1,
        startedAt: '2026-08-28T10:00:00.000Z',
        completedAt: '2026-08-28T10:00:01.000Z',
        outcome: 'model-outcome',
        executionEvidence: {
          runControl: runControlRef,
          modelEnvelope: modelEnvelopeRef,
          trace: traceRef,
          executorIdentity,
          isolationReceipt: isolationRef,
          resourceReceipt: resourceRef,
        },
        rawAnswer,
        providerMetadata,
        parsedApiClaims: [],
        taskSuccess: 'SUCCESS',
      }],
    })
  }

  const definitionSha256 = await hashEvaluationDefinition(definition, sha256)
  const result: JsonObject = {
    ...structuredClone(definition),
    recordType: 'result',
    status: 'CALIBRATED',
    definitionSha256,
    executedAt: '2026-08-28T10:01:00.000Z',
    runs,
  }
  return { definition, result }
}

function firstAttempt(result: JsonObject): JsonObject {
  return ((((result.runs as JsonObject[])[0]!).attempts as JsonObject[])[0]!)
}

describe('M2.3 agent evaluation v2 integrity', () => {
  it('accepts a complete v2 result whose execution evidence re-hashes and binds to the frozen definition', async () => {
    const { definition, result } = await buildFixture()
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).resolves.toBeUndefined()
  })

  it('rejects changed frozen execution preregistration even when ordinary v1 fields are unchanged', async () => {
    const { definition, result } = await buildFixture()
    const execution = result.execution as JsonObject
    ;(execution.capabilityManifests as JsonObject).B = await jsonRef({ changed: true })
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/preregistration|execution|definition/i)
  })

  it('rejects tampered retained bytes and a naked-but-plausible execution digest', async () => {
    const { definition, result } = await buildFixture()
    const evidence = firstAttempt(result).executionEvidence as JsonObject
    const trace = evidence.trace as JsonObject
    trace.inline = `${trace.inline as string} `
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/hash|byte|content/i)

    const fresh = await buildFixture()
    ;(firstAttempt(fresh.result).executionEvidence as JsonObject).trace = 'f'.repeat(64)
    await expect(validateAgentV2ResultAgainstDefinition(fresh.definition, fresh.result, sha256)).rejects.toThrow(/content|evidence|object/i)
  })

  it('rejects tampered retained provider-native completion metadata', async () => {
    const { definition, result } = await buildFixture()
    const providerMetadata = firstAttempt(result).providerMetadata as JsonObject
    providerMetadata.inline = `${providerMetadata.inline as string} `
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/provider|metadata|hash|byte|content/i)
  })

  it('rejects a re-hashable trace or receipt that is bound to another RunControl', async () => {
    const { definition, result } = await buildFixture()
    const evidence = firstAttempt(result).executionEvidence as JsonObject
    const wrongTrace = await createTraceReceipt('f'.repeat(64), [], sha256)
    evidence.trace = await jsonRef(wrongTrace)
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/runcontrol|trace|binding/i)
  })

  it('rejects a valid ModelEnvelope blob when RunControl committed a different envelope hash', async () => {
    const { definition, result } = await buildFixture()
    const evidence = firstAttempt(result).executionEvidence as JsonObject
    evidence.modelEnvelope = await jsonRef({ schema: 'dsh-toolchain-m2-model-envelope-v1', systemPrompt: 'different' })
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/model.?envelope|runcontrol|hash/i)
  })

  it('preserves v1 UNKNOWN/terminal decision semantics through the compatibility projection', async () => {
    const { definition, result } = await buildFixture()
    const bRun = (result.runs as JsonObject[]).find(run => run.arm === 'B')!
    const attempt = (bRun.attempts as JsonObject[])[0]!
    attempt.taskSuccess = 'UNKNOWN'
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/UNKNOWN|INCONCLUSIVE|resolved/i)
  })

  it('never accepts historical v1 records as newly executed v2 evidence', async () => {
    const { definition, result } = await buildFixture()
    definition.schema = 'dsh-toolchain-m2-agent-eval-v1'
    result.schema = 'dsh-toolchain-m2-agent-eval-v1'
    await expect(validateAgentV2ResultAgainstDefinition(definition, result, sha256)).rejects.toThrow(/v2|schema|historical/i)
  })
})
