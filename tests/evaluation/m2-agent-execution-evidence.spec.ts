import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import {
  createModelEnvelope,
  createModelTask,
  createRunControl,
  hashCapabilityManifest,
  validateCapabilityManifests,
  type CapabilityManifest,
  type ModelVisibleTool,
} from './m2-agent-execution-evidence.js'

const SHA = {
  workspace: '1'.repeat(64),
  docs: '2'.repeat(64),
  dataset: '3'.repeat(64),
  resource: '4'.repeat(64),
  retry: '5'.repeat(64),
  executor: '6'.repeat(64),
  envelope: '7'.repeat(64),
}

function ordinaryTool(): ModelVisibleTool {
  return {
    family: 'ordinary',
    name: 'read_file',
    description: 'Read one file from the frozen exact-target workspace.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }
}

function toolchainTool(name: string): ModelVisibleTool {
  return {
    family: 'toolchain',
    name,
    description: `${name} production surface`,
    inputSchema: { type: 'object' },
  }
}

function exactTargetEvidence() {
  return {
    workspaceSnapshotSha256: SHA.workspace,
    roots: ['/workspace/target'],
    readOnly: true as const,
    staticDocsSha256: SHA.docs,
    networkPolicy: 'offline' as const,
    search: {
      backend: 'fixture-search',
      version: '1',
      maxResults: 20,
    },
  }
}

function manifests(): { A: CapabilityManifest; B: CapabilityManifest; C: CapabilityManifest } {
  const read = ordinaryTool()
  return {
    A: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'A',
      ordinaryEvidence: null,
      tools: [],
    },
    B: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'B',
      ordinaryEvidence: exactTargetEvidence(),
      tools: [read],
    },
    C: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'C',
      ordinaryEvidence: exactTargetEvidence(),
      tools: [
        read,
        toolchainTool('toolchain_contract_search'),
        toolchainTool('toolchain_contract_inspect'),
      ],
    },
  }
}

describe('M2.3 isolated model envelope', () => {
  it('projects a dataset task by allowlist so oracle and future fields never become model input', () => {
    const modelTask = createModelTask({
      id: 'p0-01',
      prompt: 'Identify the exact API.',
      oracleHints: { validSymbols: ['SecretExpectedSymbol'] },
      successCriteria: ['Must name SecretExpectedSymbol'],
      futurePrivateMetadata: { answer: 'still-secret' },
    })

    expect(modelTask).toEqual({ id: 'p0-01', prompt: 'Identify the exact API.' })
    expect(Object.keys(modelTask)).toEqual(['id', 'prompt'])
    expect(canonicalizeEvaluationJson(modelTask)).not.toContain('SecretExpectedSymbol')
    expect(canonicalizeEvaluationJson(modelTask)).not.toContain('futurePrivateMetadata')
  })

  it('keeps runner control metadata outside the model-visible envelope', () => {
    const { B } = manifests()
    const task = createModelTask({ id: 'p0-01', prompt: 'Identify the exact API.' })
    const envelope = createModelEnvelope({
      systemPrompt: 'Answer from the capabilities you can actually observe.',
      task,
      staticContext: [],
      capabilityManifest: B,
    })
    const serialized = canonicalizeEvaluationJson(envelope)

    for (const forbidden of [
      'evaluationId', 'phase', 'arm', 'trial', 'attempt', 'retryPolicy',
      'targetFingerprint', 'contractIndexFingerprint', 'datasetCommitmentSha256',
    ]) {
      expect(serialized).not.toContain(`\"${forbidden}\"`)
    }

    const control = createRunControl({
      evaluationId: 'm2-p0-v2',
      phase: 'P0',
      taskId: task.id,
      arm: 'B',
      trial: 3,
      attempt: 2,
      targetFingerprint: `dsh-target-v2:${'a'.repeat(64)}`,
      contractIndexFingerprint: `dsh-contract-index-v1:${'b'.repeat(64)}`,
      datasetCommitmentSha256: SHA.dataset,
      capabilityManifestSha256: '8'.repeat(64),
      resourcePolicySha256: SHA.resource,
      retryPolicySha256: SHA.retry,
      executorIdentitySha256: SHA.executor,
      modelEnvelopeSha256: SHA.envelope,
    })

    expect(control.arm).toBe('B')
    expect(control.trial).toBe(3)
    expect(control.attempt).toBe(2)
    expect('arm' in envelope).toBe(false)
    expect('trial' in envelope).toBe(false)
    expect('attempt' in envelope).toBe(false)
  })

  it('produces the same model envelope across trials and retries because control state is not an input', () => {
    const { B } = manifests()
    const task = createModelTask({ id: 'p0-02', prompt: 'Find the exact target API.' })
    const input = {
      systemPrompt: 'Use only visible evidence.',
      task,
      staticContext: [],
      capabilityManifest: B,
    } as const

    const trial1 = createModelEnvelope(input)
    const trial3 = createModelEnvelope(input)
    const retry = createModelEnvelope(input)

    expect(canonicalizeEvaluationJson(trial1)).toBe(canonicalizeEvaluationJson(trial3))
    expect(canonicalizeEvaluationJson(retry)).toBe(canonicalizeEvaluationJson(trial1))
  })

  it('makes C differ from B only by the two Toolchain model-visible definitions', () => {
    const { B, C } = manifests()
    const task = createModelTask({ id: 'p0-03', prompt: 'Resolve the API.' })
    const common = {
      systemPrompt: 'Use only visible evidence.',
      task,
      staticContext: [],
    } as const
    const b = createModelEnvelope({ ...common, capabilityManifest: B })
    const c = createModelEnvelope({ ...common, capabilityManifest: C })

    expect(c.systemPrompt).toBe(b.systemPrompt)
    expect(c.task).toEqual(b.task)
    expect(c.staticContext).toEqual(b.staticContext)
    expect(c.tools.slice(0, b.tools.length)).toEqual(b.tools)
    expect(c.tools.slice(b.tools.length).map(tool => tool.name)).toEqual([
      'toolchain_contract_search',
      'toolchain_contract_inspect',
    ])
  })

  it('validates exact capability equivalence and content-addresses every manifest field', async () => {
    const sha256 = createNodeSha256Port()
    const base = manifests()

    expect(() => validateCapabilityManifests(base)).not.toThrow()
    const bHash = await hashCapabilityManifest(base.B, sha256)
    expect(bHash).toMatch(/^[0-9a-f]{64}$/)

    const changedRoot = structuredClone(base)
    changedRoot.C.ordinaryEvidence!.roots = ['/different-root']
    expect(() => validateCapabilityManifests(changedRoot)).toThrow(/C.*B|ordinary|capabilit/i)

    const extraTool = structuredClone(base)
    extraTool.C.tools.push(toolchainTool('toolchain_contract_extra'))
    expect(() => validateCapabilityManifests(extraTool)).toThrow(/exactly|Toolchain|capabilit/i)

    const changedBackend = structuredClone(base.B)
    changedBackend.ordinaryEvidence!.search.backend = 'different-search'
    await expect(hashCapabilityManifest(changedBackend, sha256)).resolves.not.toBe(bHash)
  })
})
