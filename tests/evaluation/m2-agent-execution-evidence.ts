import type { Sha256Port } from '../../src/model/digest.js'

import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'

export type AgentArm = 'A' | 'B' | 'C'

export interface ModelTask {
  id: string
  prompt: string
}

export interface ModelVisibleTool {
  family: 'ordinary' | 'toolchain'
  name: string
  description: string
  inputSchema: unknown
}

export interface OrdinaryEvidenceCapability {
  workspaceSnapshotSha256: string
  roots: string[]
  readOnly: true
  staticDocsSha256: string
  networkPolicy: 'offline' | 'provider-only'
  search: {
    backend: string
    version: string
    maxResults: number
  }
}

export interface CapabilityManifest {
  schema: 'dsh-toolchain-m2-capability-manifest-v1'
  arm: AgentArm
  ordinaryEvidence: OrdinaryEvidenceCapability | null
  tools: ModelVisibleTool[]
}

export interface ModelEnvelope {
  schema: 'dsh-toolchain-m2-model-envelope-v1'
  systemPrompt: string
  task: ModelTask
  staticContext: readonly unknown[]
  tools: readonly ModelVisibleTool[]
}

export interface RunControl {
  schema: 'dsh-toolchain-m2-run-control-v1'
  evaluationId: string
  phase: 'P0' | 'H1'
  taskId: string
  arm: AgentArm
  trial: 1 | 2 | 3
  attempt: number
  targetFingerprint: string
  contractIndexFingerprint: string
  datasetCommitmentSha256: string
  capabilityManifestSha256: string
  resourcePolicySha256: string
  retryPolicySha256: string
  executorIdentitySha256: string
  modelEnvelopeSha256: string
}

type RunControlInput = Omit<RunControl, 'schema'>

const TOOLCHAIN_SEARCH = 'toolchain_contract_search'
const TOOLCHAIN_INSPECT = 'toolchain_contract_inspect'

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty`)
}

function assertManifestArm(manifest: CapabilityManifest, expected: AgentArm): void {
  if (manifest.arm !== expected) {
    throw new Error(`Capability manifest ${expected} must declare arm ${expected}`)
  }
}

function assertNoToolchainTools(manifest: CapabilityManifest): void {
  if (manifest.tools.some(tool => tool.family === 'toolchain')) {
    throw new Error(`Capability manifest ${manifest.arm} must not expose Toolchain tools`)
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalizeEvaluationJson(left) === canonicalizeEvaluationJson(right)
}

export function createModelTask(source: { id: string; prompt: string; [key: string]: unknown }): ModelTask {
  assertNonEmpty(source.id, 'Model task id')
  assertNonEmpty(source.prompt, 'Model task prompt')
  return { id: source.id, prompt: source.prompt }
}

export function createModelEnvelope(input: {
  systemPrompt: string
  task: ModelTask
  staticContext: readonly unknown[]
  capabilityManifest: CapabilityManifest
}): ModelEnvelope {
  assertNonEmpty(input.systemPrompt, 'Model system prompt')
  return {
    schema: 'dsh-toolchain-m2-model-envelope-v1',
    systemPrompt: input.systemPrompt,
    task: { id: input.task.id, prompt: input.task.prompt },
    staticContext: structuredClone(input.staticContext),
    tools: structuredClone(input.capabilityManifest.tools),
  }
}

export function createRunControl(input: RunControlInput): RunControl {
  assertNonEmpty(input.evaluationId, 'RunControl evaluationId')
  assertNonEmpty(input.taskId, 'RunControl taskId')
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error('RunControl attempt must be a positive integer')
  }
  return { schema: 'dsh-toolchain-m2-run-control-v1', ...input }
}

export async function hashCapabilityManifest(
  manifest: CapabilityManifest,
  sha256: Sha256Port,
): Promise<string> {
  return sha256.sha256Utf8(canonicalizeEvaluationJson(manifest))
}

export function validateCapabilityManifests(manifests: {
  A: CapabilityManifest
  B: CapabilityManifest
  C: CapabilityManifest
}): void {
  const { A, B, C } = manifests
  assertManifestArm(A, 'A')
  assertManifestArm(B, 'B')
  assertManifestArm(C, 'C')

  if (A.ordinaryEvidence !== null || A.tools.length !== 0) {
    throw new Error('Capability manifest A must expose no exact-target evidence or tools')
  }

  if (B.ordinaryEvidence === null || C.ordinaryEvidence === null) {
    throw new Error('Capability manifests B and C require ordinary exact-target evidence')
  }
  assertNoToolchainTools(B)

  if (!canonicalEqual(B.ordinaryEvidence, C.ordinaryEvidence)) {
    throw new Error('Capability manifest C ordinary evidence must equal B exactly')
  }

  if (C.tools.length !== B.tools.length + 2) {
    throw new Error('Capability manifest C must equal B plus exactly two Toolchain tools')
  }

  for (let index = 0; index < B.tools.length; index += 1) {
    if (!canonicalEqual(B.tools[index], C.tools[index])) {
      throw new Error('Capability manifest C ordinary tool surface must equal B exactly')
    }
  }

  const toolchain = C.tools.slice(B.tools.length)
  if (
    toolchain[0]?.family !== 'toolchain'
    || toolchain[0].name !== TOOLCHAIN_SEARCH
    || toolchain[1]?.family !== 'toolchain'
    || toolchain[1].name !== TOOLCHAIN_INSPECT
  ) {
    throw new Error('Capability manifest C must add exactly Toolchain search and inspect')
  }
}
