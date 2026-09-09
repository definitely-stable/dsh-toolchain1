import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const smokeModule = await import('../../scripts/smoke-operation-lifecycle.mjs') as Record<string, unknown>
const smokeSource = await readFile(
  fileURLToPath(new URL('../../scripts/smoke-operation-lifecycle.mjs', import.meta.url)),
  'utf8',
)

describe('real DSH verification operation smoke policy', () => {
  it('requires one persistent Host start/get lifecycle through native tools', () => {
    expect(typeof smokeModule.assertVerificationOperationReceipt).toBe('function')
    expect(smokeSource).toContain("name: 'toolchain_plugin_verify_start'")
    expect(smokeSource).toContain("name: 'toolchain_operation_get'")
    expect(smokeSource).toContain("schema.name === 'toolchain_operation_cancel'")
    expect(smokeSource).toContain('DSH_TOOLCHAIN_SMOKE_CANDIDATE')
    expect(smokeSource).toContain("subject: { kind: 'packed', path: candidatePath }")
    expect(smokeSource).toContain("operation.state === 'queued' || operation.state === 'running'")
  })

  it('accepts only a succeeded operation containing the canonical verified exact-artifact/exact-target receipt', () => {
    const assertVerificationOperationReceipt = smokeModule.assertVerificationOperationReceipt as (
      receipt: unknown,
      targetFingerprint: string,
      artifactFingerprint: string,
    ) => void
    const targetFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const artifactFingerprint = `dsh-plugin-artifact-v1:${'b'.repeat(64)}`
    const receipt = {
      startVisible: true,
      getVisible: true,
      cancelVisible: true,
      start: {
        isError: false,
        status: 'ok',
        id: 'op-real-host',
        state: 'queued',
      },
      terminal: {
        isError: false,
        status: 'ok',
        id: 'op-real-host',
        state: 'succeeded',
        cancellationRequested: false,
        resultStatus: 'ok',
        verificationStatus: 'verified',
        snapshotFingerprint: targetFingerprint,
        artifactFingerprint,
        targetFingerprint,
        cleanup: 'succeeded',
      },
    }

    expect(() => assertVerificationOperationReceipt(receipt, targetFingerprint, artifactFingerprint)).not.toThrow()
    expect(() => assertVerificationOperationReceipt({
      ...receipt,
      terminal: { ...receipt.terminal, state: 'failed' },
    }, targetFingerprint, artifactFingerprint)).toThrow(/operation lifecycle/i)
    expect(() => assertVerificationOperationReceipt({
      ...receipt,
      terminal: { ...receipt.terminal, targetFingerprint: `dsh-target-v2:${'c'.repeat(64)}` },
    }, targetFingerprint, artifactFingerprint)).toThrow(/operation lifecycle/i)
    expect(() => assertVerificationOperationReceipt({
      ...receipt,
      terminal: { ...receipt.terminal, artifactFingerprint: `dsh-plugin-artifact-v1:${'d'.repeat(64)}` },
    }, targetFingerprint, artifactFingerprint)).toThrow(/operation lifecycle/i)
    expect(() => assertVerificationOperationReceipt({
      ...receipt,
      terminal: { ...receipt.terminal, verificationStatus: 'partial' },
    }, targetFingerprint, artifactFingerprint)).toThrow(/operation lifecycle/i)
  })
})
