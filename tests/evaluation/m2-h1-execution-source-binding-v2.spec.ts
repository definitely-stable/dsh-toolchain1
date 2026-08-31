import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import {
  CANONICAL_H1_CHILD_ENTRYPOINT,
  CANONICAL_H1_NODE_VERSION,
  createCanonicalH1ExecutionSourceIdentityV2,
  createH1ExecutionSourceBindingV2,
  type H1ExecutionSourceIdentityV2,
} from './m2-h1-execution-source-binding-v2.js'
import { createSourceBoundH1AttemptInputFactoryV2 } from './m2-h1-source-bound-attempt-factory-v2.js'
import {
  createH1SourceBoundPreregistrationV2,
  validateH1SourceBoundPreregistrationV2,
} from './m2-h1-source-bound-preregistration-v2.js'
import { createSyntheticH1Finalization, readSyntheticH1Workspace } from './m2-h1-synthetic-fixture-v2.js'

const sha256 = createNodeSha256Port()
const SOURCE_COMMIT = '1'.repeat(40)
const OTHER_SOURCE_COMMIT = '2'.repeat(40)
const H1_SUCCESS = fileURLToPath(new URL('./fixtures/process-executor/h1-terminal-success.mjs', import.meta.url))

function providerEnvironment() {
  return {
    PATH: process.env.PATH ?? '',
    OPENCODE_API_KEY: 'sk-synthetic-h1-runtime-only',
    OPENCODE_GO_BASE_URL: 'https://opencode.ai/zen/go/v1',
    OPENCODE_GO_REQUEST_MODEL: 'deepseek-v4-flash',
    OPENCODE_GO_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-flash',
    OPENCODE_GO_THINKING: 'enabled',
    OPENCODE_GO_REASONING_EFFORT: 'high',
    OPENCODE_GO_MAX_OUTPUT_TOKENS: '12000',
  }
}

function processConfiguration(args: readonly string[] = [H1_SUCCESS], command = process.execPath) {
  return {
    command,
    args,
    cwd: process.cwd(),
    environment: providerEnvironment(),
  }
}

function syntheticSourceIdentity(overrides: Partial<H1ExecutionSourceIdentityV2> = {}): H1ExecutionSourceIdentityV2 {
  return {
    schema: 'dsh-toolchain-m2-h1-execution-source-v2',
    repository: 'definitely-stable/dsh-toolchain1',
    sourceCommitSha: SOURCE_COMMIT,
    entrypoint: relative(process.cwd(), H1_SUCCESS).split(sep).join('/'),
    runtime: 'node',
    runtimeVersion: process.versions.node,
    protocol: 'closed-ndjson-v1',
    ...overrides,
  }
}

async function fixture() {
  const [finalization, workspace] = await Promise.all([
    createSyntheticH1Finalization(),
    readSyntheticH1Workspace(),
  ])
  const frozen = await createFrozenH1ExecutionDefinitionV2(finalization, workspace, sha256)
  return { finalization, workspace, frozen }
}

describe('M2.3 H1 execution source binding v2', () => {
  it('content-addresses exact execution source without changing scientific definition or ledger identity', async () => {
    const { frozen } = await fixture()
    const originalDefinition = structuredClone(frozen.definition)
    const originalLedgerBinding = structuredClone(frozen.ledgerBinding)

    const binding = await createH1ExecutionSourceBindingV2(frozen, syntheticSourceIdentity(), sha256)
    const changed = await createH1ExecutionSourceBindingV2(
      frozen,
      syntheticSourceIdentity({ sourceCommitSha: OTHER_SOURCE_COMMIT }),
      sha256,
    )

    expect(binding.definitionSha256).toBe(frozen.definitionSha256)
    expect(binding.sourceBindingSha256).not.toBe(changed.sourceBindingSha256)
    expect(frozen.definition).toEqual(originalDefinition)
    expect(frozen.ledgerBinding).toEqual(originalLedgerBinding)
  })

  it('accepts only the bound checkout, Node runtime and repo-relative child entrypoint', async () => {
    const { frozen, workspace } = await fixture()
    const binding = await createH1ExecutionSourceBindingV2(frozen, syntheticSourceIdentity(), sha256)

    await expect(createSourceBoundH1AttemptInputFactoryV2(
      frozen,
      binding,
      workspace,
      processConfiguration(),
      SOURCE_COMMIT,
      sha256,
    )).resolves.toHaveProperty('buildAttemptInput')

    await expect(createSourceBoundH1AttemptInputFactoryV2(
      frozen,
      binding,
      workspace,
      processConfiguration(),
      OTHER_SOURCE_COMMIT,
      sha256,
    )).rejects.toThrow(/commit|source/iu)

    await expect(createSourceBoundH1AttemptInputFactoryV2(
      frozen,
      binding,
      workspace,
      processConfiguration(['different-child.mjs']),
      SOURCE_COMMIT,
      sha256,
    )).rejects.toThrow(/entrypoint/iu)

    const runtimeDrift = await createH1ExecutionSourceBindingV2(
      frozen,
      syntheticSourceIdentity({ runtimeVersion: '0.0.0' }),
      sha256,
    )
    await expect(createSourceBoundH1AttemptInputFactoryV2(
      frozen,
      runtimeDrift,
      workspace,
      processConfiguration(),
      SOURCE_COMMIT,
      sha256,
    )).rejects.toThrow(/runtime|version/iu)
  })

  it('publishes a self-hashed envelope over the existing scientific preregistration and source binding', async () => {
    const { finalization, frozen } = await fixture()
    const envelope = await createH1SourceBoundPreregistrationV2(
      finalization,
      frozen,
      syntheticSourceIdentity(),
      sha256,
    )

    await expect(validateH1SourceBoundPreregistrationV2(envelope, sha256)).resolves.toEqual(envelope)

    const tampered = structuredClone(envelope)
    ;(tampered.sourceBinding as { sourceBindingSha256: string }).sourceBindingSha256 = '0'.repeat(64)
    await expect(validateH1SourceBoundPreregistrationV2(tampered, sha256)).rejects.toThrow(/binding|hash|SHA/iu)
  })

  it('freezes the canonical real H1 source tuple without machine-specific paths', () => {
    expect(createCanonicalH1ExecutionSourceIdentityV2(SOURCE_COMMIT)).toEqual({
      schema: 'dsh-toolchain-m2-h1-execution-source-v2',
      repository: 'definitely-stable/dsh-toolchain1',
      sourceCommitSha: SOURCE_COMMIT,
      entrypoint: CANONICAL_H1_CHILD_ENTRYPOINT,
      runtime: 'node',
      runtimeVersion: CANONICAL_H1_NODE_VERSION,
      protocol: 'closed-ndjson-v1',
    })
  })
})
