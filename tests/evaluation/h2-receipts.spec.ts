import { describe, expect, it } from 'vitest'

import { H2_POLICY } from '../../scripts/eval/h2/h2-config.mjs'
import {
  assertDryRunReceipt,
  assertPreregistrationReceipt,
  buildDryRunReceipt,
  buildPreregistrationReceipt,
  sealReceipt,
} from '../../scripts/eval/h2/h2-receipts.mjs'

const hex = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64)

const DATASET = {
  schema: 'dsh-toolchain-h2-commitment-v1',
  taskCount: 18,
  strata: ['agent-tool', 'compatibility-debug', 'cordis-service', 'exact-target-api', 'plugin-composition', 'runtime-verification'],
  datasetSha256: hex(9),
  calibrationSha256: hex(10),
  tasks: Array.from({ length: 18 }, (_, index) => [`h2-task-${String(index + 1).padStart(2, '0')}`, 'exact-target-api', hex(index + 20)]),
}

const ARGS = {
  candidate: { gitCommitSha: hex(1), packedArtifactSha256: hex(2), packageName: 'dsh-toolchain', packageVersion: '0.0.0', protocolVersion: '1' },
  target: { dshTrain: '@deepseek-ai/dsh@0.1.5-rc.2', dshRootVersion: '0.1.5-rc.2', targetFingerprint: hex(3), profile: 'acp' },
  dataset: DATASET,
  schedule: { seed: H2_POLICY.schedule.seed, hash: hex(4) },
  source: { repository: 'definitely-stable/dsh-toolchain1', commit: hex(1), nodeVersion: 'v24.19.0', controllerEntry: 'scripts/eval/h2/h2-cli.mjs' },
  generatedAt: '2026-09-16T00:00:00Z',
}

describe('H2 preregistration receipt', () => {
  it('seals a receipt over its canonical envelope and verifies it', () => {
    const receipt = buildPreregistrationReceipt(ARGS)
    expect(receipt.schema).toBe('dsh-toolchain-h2-preregistration-v1')
    expect(receipt.receiptSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(() => assertPreregistrationReceipt({ receipt })).not.toThrow()
    expect(sealReceipt({ ...receipt, receiptSha256: undefined }).receiptSha256).toBe(receipt.receiptSha256)
  })

  it('detects a tampered receipt and any drift from the frozen policy', () => {
    const receipt = buildPreregistrationReceipt(ARGS)
    const tampered = { ...receipt, dataset: { ...receipt.dataset, commitmentSha256: hex(99) }, receiptSha256: receipt.receiptSha256 }
    expect(() => assertPreregistrationReceipt({ receipt: tampered })).toThrow(/seal is invalid/)
    const badPolicy = { ...receipt, model: { ...receipt.model, model: 'other-model' } }
    expect(() => assertPreregistrationReceipt({ receipt: badPolicy })).toThrow(/seal is invalid|model identity/)
  })

  it('verifies candidate, dataset, schedule, and target against live expectations', () => {
    const receipt = buildPreregistrationReceipt(ARGS)
    const good = {
      candidate: { gitCommitSha: hex(1), packedArtifactSha256: hex(2) },
      datasetSha256: hex(9),
      scheduleHash: hex(4),
      targetFingerprint: hex(3),
    }
    expect(() => assertPreregistrationReceipt({ receipt, expected: good })).not.toThrow()
    expect(() => assertPreregistrationReceipt({ receipt, expected: { ...good, datasetSha256: hex(99) } })).toThrow(/dataset commitment/)
    expect(() => assertPreregistrationReceipt({ receipt, expected: { ...good, candidate: { gitCommitSha: hex(88), packedArtifactSha256: hex(2) } } })).toThrow(/candidate gitCommitSha/)
    expect(() => assertPreregistrationReceipt({ receipt, expected: { ...good, targetFingerprint: hex(77) } })).toThrow(/target fingerprint/)
  })

  it('refuses a schedule whose seed was re-rolled', () => {
    expect(() => buildPreregistrationReceipt({ ...ARGS, schedule: { seed: 'new-seed', hash: hex(4) } }))
      .toThrow(/schedule seed/)
  })
})

describe('H2 technical dry-run receipt', () => {
  const observations = [
    { arm: 'B', scoring: false, status: 'ok', terminalReason: 'COMPLETED', wallTimeMs: 1000, identityDrift: false, telemetryResolved: true },
    { arm: 'C', scoring: false, status: 'ok', terminalReason: 'COMPLETED', wallTimeMs: 2000, identityDrift: false, telemetryResolved: true },
  ]
  const parity = { verified: true, profile: 'acp', armBRows: 40, armCRows: 41, addedRow: { id: 'dsh-toolchain', name: 'dsh-toolchain/dsh' } }

  it('seals exactly two non-scoring observations (one per arm)', () => {
    const receipt = buildDryRunReceipt({
      commitmentSha256: hex(9),
      candidate: { gitCommitSha: hex(1) },
      target: { targetFingerprint: hex(3) },
      compositionParity: parity,
      observations,
      generatedAt: '2026-09-16T00:00:00Z',
    })
    expect(receipt.scoring).toBe(false)
    expect(receipt.observations).toHaveLength(2)
    expect(receipt.compositionParity.addedRow).toEqual({ id: 'dsh-toolchain', name: 'dsh-toolchain/dsh' })
    expect(receipt.receiptSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(() => assertDryRunReceipt({
      receipt,
      expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(3) },
    })).not.toThrow()
  })

  it('rejects an incomplete or duplicated dry run', () => {
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: {}, target: {}, compositionParity: parity,
      observations: [observations[0]], generatedAt: 'x',
    })).toThrow(/exactly 2/)
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: {}, target: {}, compositionParity: parity,
      observations: [observations[0], { ...observations[0], arm: 'B' }], generatedAt: 'x',
    })).toThrow(/one Arm B and one Arm C/)
  })

  it('blocks a scoring run when the dry run did not pass or does not match', () => {
    const failed = buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: parity,
      observations: [observations[0], { ...observations[1], status: 'infrastructure-failure' }],
      generatedAt: 'x',
    })
    expect(() => assertDryRunReceipt({ receipt: failed, expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(3) } }))
      .toThrow(/dry run did not pass/)
    const ok = buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: parity, observations, generatedAt: 'x',
    })
    expect(() => assertDryRunReceipt({ receipt: ok, expected: { datasetSha256: hex(8), gitCommitSha: hex(1), targetFingerprint: hex(3) } }))
      .toThrow(/commitment mismatch/)
  })

  it('refuses to authorize scoring without an empirical arm-parity proof', () => {
    // The gate must reject a receipt built without the proof, so this call is
    // deliberately out of contract.
    const withoutParity = {
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      observations, generatedAt: 'x',
    } as unknown as Parameters<typeof buildDryRunReceipt>[0]
    expect(() => buildDryRunReceipt(withoutParity)).toThrow(/composition parity/)
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: { ...parity, addedRow: { id: 'something-else', name: 'something-else' } },
      observations, generatedAt: 'x',
    })).toThrow(/frozen Toolchain row/)
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: { ...parity, verified: false }, observations, generatedAt: 'x',
    })).toThrow(/composition parity/)
  })

  it('refuses to authorize scoring when the telemetry plane or model identity did not resolve', () => {
    // A harness that cannot read its own authoritative session log reports an
    // identity drift and zero completions; that must fail here, before scoring.
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: parity,
      observations: [observations[0], { ...observations[1], identityDrift: true }], generatedAt: 'x',
    })).toThrow(/stable model identity/)
    expect(() => buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: parity,
      observations: [observations[0], { ...observations[1], telemetryResolved: false }], generatedAt: 'x',
    })).toThrow(/session log/)

    const sealed = buildDryRunReceipt({
      commitmentSha256: hex(9), candidate: { gitCommitSha: hex(1) }, target: { targetFingerprint: hex(3) },
      compositionParity: parity, observations, generatedAt: 'x',
    })
    // The gates are re-checked when the receipt is consumed, not only when built.
    const tampered = { ...sealed, compositionParity: { ...parity, verified: false } }
    delete (tampered as { receiptSha256?: string }).receiptSha256
    expect(() => assertDryRunReceipt({
      receipt: { ...tampered, receiptSha256: sealed.receiptSha256 },
      expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(3) },
    })).toThrow(/seal is invalid|composition parity/)
  })
})