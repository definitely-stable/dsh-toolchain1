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

  it('accepts a real git object id and rejects a digest-shaped non-commit', () => {
    // The repository's object format decides the length of a commit id; this
    // checkout is SHA-1. Validating it as a 64-char sha256 rejected every real
    // commit, so `h2 freeze` could not seal a receipt at all, and the fixtures
    // hid it by inventing a 64-char commit id.
    const gitSha1 = 'b749723000000000000000000000000000000000'
    const receipt = buildPreregistrationReceipt({ ...ARGS, candidate: { ...ARGS.candidate, gitCommitSha: gitSha1 } })
    expect(receipt.candidate.gitCommitSha).toBe(gitSha1)
    expect(buildPreregistrationReceipt({ ...ARGS, candidate: { ...ARGS.candidate, gitCommitSha: hex(7) } }).candidate.gitCommitSha).toBe(hex(7))
    for (const bad of ['b749723', 'B749723000000000000000000000000000000000', 'b74972300000000000000000000000000000000z']) {
      expect(() => buildPreregistrationReceipt({ ...ARGS, candidate: { ...ARGS.candidate, gitCommitSha: bad } })).toThrow(/git object id/)
    }
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
  /**
   * The sealed technical-observation record. Declared explicitly because the gates
   * under test re-derive `transportReady` and `resourceFit`, so a test must be able
   * to build an observation whose flags deliberately disagree with its terminal state.
   */
  interface DryRunObservation {
    arm: string
    scoring: boolean
    status: string
    terminalReason: string
    graderStatus: string
    budgetExhausted: boolean
    resourceFit: boolean
    transportReady: boolean
    wallTimeMs: number
    identityDrift: boolean
    telemetryResolved: boolean
    providerCompletions: number
  }
  const observations: DryRunObservation[] = [
    { arm: 'B', scoring: false, status: 'ok', terminalReason: 'COMPLETED', graderStatus: 'pass', budgetExhausted: false, resourceFit: true, transportReady: true, wallTimeMs: 1000, identityDrift: false, telemetryResolved: true, providerCompletions: 12 },
    { arm: 'C', scoring: false, status: 'ok', terminalReason: 'COMPLETED', graderStatus: 'pass', budgetExhausted: false, resourceFit: true, transportReady: true, wallTimeMs: 2000, identityDrift: false, telemetryResolved: true, providerCompletions: 13 },
  ]
  const armB = observations[0]!
  const armC = observations[1]!
  const parity = { verified: true, profile: 'acp', armBRows: 40, armCRows: 41, addedRow: { id: 'dsh-toolchain', name: 'dsh-toolchain/dsh' } }
  const build = (observationList: DryRunObservation[]) => buildDryRunReceipt({
    commitmentSha256: hex(9),
    candidate: { gitCommitSha: hex(1) },
    target: { targetFingerprint: hex(3) },
    compositionParity: parity,
    observations: observationList,
    generatedAt: 'x',
  })

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
    expect(() => build([armB])).toThrow(/exactly 2/)
    expect(() => build([armB, { ...armB }])).toThrow(/one Arm B and one Arm C/)
  })

  it('blocks a scoring run when the sealed receipt does not match the frozen inputs', () => {
    const ok = build(observations)
    expect(() => assertDryRunReceipt({ receipt: ok, expected: { datasetSha256: hex(8), gitCommitSha: hex(1), targetFingerprint: hex(3) } }))
      .toThrow(/commitment mismatch/)
    expect(() => assertDryRunReceipt({ receipt: ok, expected: { datasetSha256: hex(9), gitCommitSha: hex(2), targetFingerprint: hex(3) } }))
      .toThrow(/candidate mismatch/)
    expect(() => assertDryRunReceipt({ receipt: ok, expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(4) } }))
      .toThrow(/target mismatch/)
  })

  it('refuses to authorize scoring when the budget guard cut a trajectory short', () => {
    // The canonical H2 dry run authorized scoring with Arm C in exactly this shape:
    // a passing grader, but a trajectory stopped by the completion ceiling. The
    // dominant loss mode of the run that followed was that same exhaustion, so the
    // dry run must refuse this instead of recording it as `ok`.
    const exhausted = { ...armC, status: 'failed', terminalReason: 'RESOURCE_EXHAUSTED', budgetExhausted: true, resourceFit: false, providerCompletions: 25 }
    expect(() => build([armB, exhausted])).toThrow(/exhausted the frozen completion budget/)

    // A mislabelled flag is refused too: the readiness fields are re-derived, so a
    // caller cannot record exhaustion as resource-fit.
    expect(() => build([armB, { ...exhausted, resourceFit: true }])).toThrow(/inconsistent resource-fitness flag/)
    expect(() => assertDryRunReceipt({
      receipt: build(observations),
      expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(3) },
    })).not.toThrow()
  })

  it('refuses to authorize scoring when the independent grader failed', () => {
    expect(() => build([armB, { ...armC, status: 'failed', graderStatus: 'fail', resourceFit: false }]))
      .toThrow(/did not pass the independent grader/)
  })

  it('refuses to authorize scoring when no real trajectory completed', () => {
    // Terminal states that never reached a gradeable workspace are transport
    // failures, distinct from a budget that was too small.
    expect(() => build([armB, { ...armC, status: 'failed', terminalReason: 'INFRASTRUCTURE_FAILURE', transportReady: false, resourceFit: false, graderStatus: 'fail' }]))
      .toThrow(/did not complete a real trajectory/)
    expect(() => build([armB, { ...armC, transportReady: false }]))
      .toThrow(/inconsistent transport readiness flag/)
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
    expect(() => build([armB, { ...armC, identityDrift: true }])).toThrow(/stable model identity/)
    expect(() => build([armB, { ...armC, telemetryResolved: false }])).toThrow(/session log/)

    // The gates are re-checked when the receipt is consumed, not only when built.
    const sealed = build(observations)
    const tampered = { ...sealed, compositionParity: { ...parity, verified: false } }
    delete (tampered as { receiptSha256?: string }).receiptSha256
    expect(() => assertDryRunReceipt({
      receipt: { ...tampered, receiptSha256: sealed.receiptSha256 },
      expected: { datasetSha256: hex(9), gitCommitSha: hex(1), targetFingerprint: hex(3) },
    })).toThrow(/seal is invalid|composition parity/)
  })
})