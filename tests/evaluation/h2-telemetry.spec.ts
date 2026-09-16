import { describe, expect, it } from 'vitest'

import {
  assertModelIdentityMatches,
  assertReceiptSanitized,
  buildObservationReceipt,
  classifyToolName,
  parseSessionLog,
} from '../../scripts/eval/h2/h2-telemetry.mjs'

const HEADER = { type: 'session', version: 5, id: 'session-1', createdAt: 1_700_000_000_000, cwd: 'C:/ws' }
const record = (type: string, data: unknown, seq: number) => ({ type, seq, time: 1_700_000_000_000 + seq, data })

const SESSION_LOG = [
  HEADER,
  record('turn/start', { turn: 1 }, 1),
  record('request/header', { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 256_000 } }, 2),
  record('assistant/message', {
    message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'SUPER_SECRET_MODEL_PROSE' }], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
    usage: { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 10, reasoningTokens: 20 },
  }, 3),
  record('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: '{"path":"SECRET_PATH_/etc/passwd"}' }, 4),
  record('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'toolchain_contract_search', arguments: '{"query":"SK-SECRET-TOKEN"}' }, 5),
  record('request/header', { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 256_000 } }, 6),
  record('assistant/message', {
    message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'more secret prose' }], source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' } },
    usage: { inputTokens: 2000, outputTokens: 30 },
  }, 7),
  record('turn/end', { turn: 1, reason: { kind: 'completed' } }, 8),
].map(item => JSON.stringify(item)).join('\n') + '\n'

describe('H2 session telemetry', () => {
  it('extracts token, completion, turn, and tool metrics from the append-only session log', () => {
    const { metrics, records } = parseSessionLog(SESSION_LOG)
    expect(records).toHaveLength(9)
    expect(metrics.providerCompletions).toBe(2)
    expect(metrics.turns).toBe(1)
    expect(metrics.terminalReason).toBe('completed')
    expect(metrics.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 80,
      totalTokens: 3080,
      cachedInputTokens: 800,
      cacheWriteTokens: 10,
      reasoningTokens: 20,
      providerCompletions: 2,
    })
    expect(metrics.tools.totalToolCalls).toBe(2)
    expect(metrics.tools.ordinaryToolCalls).toBe(1)
    expect(metrics.tools.toolchainToolCalls).toBe(1)
    expect(metrics.tools.perTool).toEqual({ read_file: 1, toolchain_contract_search: 1 })
    expect(metrics.modelIdentities.request).toEqual([{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }])
    expect(metrics.modelIdentities.responseModels).toEqual(['deepseek-flash'])
  })

  it('classifies toolchain tools by the frozen prefix', () => {
    expect(classifyToolName('toolchain_contract_search')).toBe('toolchain')
    expect(classifyToolName('toolchain_plugin_verify')).toBe('toolchain')
    expect(classifyToolName('read_file')).toBe('ordinary')
    expect(classifyToolName('unknown')).toBe('ordinary')
  })

  it('tolerates an empty or header-only log without inventing metrics', () => {
    const { metrics } = parseSessionLog(JSON.stringify(HEADER) + '\n')
    expect(metrics.providerCompletions).toBe(0)
    expect(metrics.usage.inputTokens).toBe(0)
    expect(metrics.tools.totalToolCalls).toBe(0)
    expect(metrics.terminalReason).toBe(null)
  })
})

describe('H2 observation receipts', () => {
  const base = {
    runId: 'run-1',
    taskId: 'h2-exact-target-api-90',
    stratum: 'exact-target-api',
    arm: 'C',
    attempt: 1,
    terminalReason: 'COMPLETED',
    budgetExhausted: false,
    success: true,
    grader: { status: 'pass', checks: [{ name: 'static', status: 'pass' }] },
    metrics: parseSessionLog(SESSION_LOG).metrics,
    wallTimeMs: 61_000,
    stopReason: 'end_turn',
    usageUpdates: 2,
    workspaceDigestBefore: 'a'.repeat(64),
    workspaceDigestAfter: 'b'.repeat(64),
    acpToolCalls: 2,
  }

  it('retains only whitelisted operational metadata and never model prose or tool arguments', () => {
    const receipt = buildObservationReceipt(base)
    const serialized = JSON.stringify(receipt)
    expect(serialized).not.toContain('SECRET_PATH_/etc/passwd')
    expect(serialized).not.toContain('SK-SECRET-TOKEN')
    expect(serialized).not.toContain('SUPER_SECRET_MODEL_PROSE')
    expect(serialized).not.toContain('arguments')
    expect(receipt.usage.inputTokens).toBe(3000)
    expect(receipt.tools.totalToolCalls).toBe(2)
    expect(receipt.identity.systemFingerprint).toBe(null)
    expect(receipt.identity.revision).toBe(null)
    expect(() => assertReceiptSanitized(receipt)).not.toThrow()
  })

  it('rejects a receipt carrying forbidden fields or secret-shaped values', () => {
    expect(() => assertReceiptSanitized({ ...buildObservationReceipt(base), reasoning: 'chain of thought' })).toThrow(/forbidden/)
    expect(() => assertReceiptSanitized({ ...buildObservationReceipt(base), prompt: 'hidden task text' })).toThrow(/forbidden/)
    expect(() => assertReceiptSanitized({ ...buildObservationReceipt(base), note: 'sk-live-secret' })).toThrow(/secret/)
    expect(() => assertReceiptSanitized({ ...buildObservationReceipt(base), note: 'x'.repeat(9000) })).toThrow(/length/)
  })

  it('fails closed when the observed model identity drifts from the frozen policy', () => {
    const frozen = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
    expect(assertModelIdentityMatches({ frozen, observed: { request: [{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }], responseModels: ['deepseek-flash'] } })).toBe(true)
    expect(() => assertModelIdentityMatches({ frozen, observed: { request: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' }], responseModels: ['deepseek-v4-flash'] } })).toThrow(/identity drift/)
    expect(() => assertModelIdentityMatches({ frozen, observed: { request: [{ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' }], responseModels: ['deepseek-flash'] } })).toThrow(/identity drift/)
    expect(() => assertModelIdentityMatches({ frozen, observed: { request: [], responseModels: [] } })).toThrow(/identity drift/)
  })
})