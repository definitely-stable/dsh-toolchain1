import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  createFrozenP0Inputs,
  type FrozenP0ProviderIdentity,
} from './m2-agent-p0-definition.js'

const FLASH_PROVIDER: FrozenP0ProviderIdentity = Object.freeze({
  provider: 'opencode-go',
  requestModel: 'deepseek-v4-flash',
  reviewedSnapshot: `opencode-go-probe:${'a'.repeat(64)}`,
  expectedResponseModel: 'deepseek-v4-flash',
  thinking: 'enabled',
  reasoningEffort: 'high',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  adapterVersion: 'opencode-go-deepseek-chat-v1',
  providerProbeSha256: 'a'.repeat(64),
})

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

describe('M2.3 second DeepSeek V4 Flash P0 calibration envelope', () => {
  it('re-freezes P0 to 32 turns and 180k cumulative input without changing the output or wall-time budgets', async () => {
    const frozen = await createFrozenP0Inputs(FLASH_PROVIDER)
    const definition = record(frozen.definition, 'P0 definition')
    expect(definition.resources).toEqual({
      maxTurns: 32,
      maxInputTokens: 180000,
      maxOutputTokens: 12000,
      wallTimeMs: 300000,
      concurrency: 1,
    })

    const execution = record(definition.execution, 'P0 execution')
    const resourcePolicy = JSON.parse(record(execution.resourcePolicy, 'resource policy').inline as string) as Record<string, unknown>
    expect(resourcePolicy).toEqual({
      maxWallTimeMs: 300000,
      maxTurns: 32,
      maxAttempts: 2,
      concurrency: 1,
      maxInputTokens: 180000,
      maxOutputTokens: 12000,
      tokenMeasurementRequired: true,
    })
  })

  it('aligns the OpenCode Go child to 31 tool rounds plus final turn and a 180 second provider request timeout', async () => {
    const source = await readFile(new URL('../../scripts/m2-opencode-go-p0-child.mjs', import.meta.url), 'utf8')
    expect(source).toContain('const MAX_TOOL_ROUNDS = 31')
    expect(source).toContain('AbortSignal.timeout(180_000)')
    expect(source).not.toContain('AbortSignal.timeout(120_000)')
  })
})
