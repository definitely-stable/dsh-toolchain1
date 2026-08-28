import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { createFrozenM2RetrievalIndex, M2_RETRIEVAL_TARGET } from './m2-retrieval-index.js'

interface ExactTargetIdentity {
  readonly package: '@deepseek-ai/dsh'
  readonly version: '0.1.1-rc.2'
  readonly profile: 'web'
  readonly targetFingerprint: string
  readonly contractIndexFingerprint: string
}

interface OracleDocument {
  readonly status: 'FROZEN'
  readonly target: ExactTargetIdentity
  readonly authoritativeUniverse: {
    readonly contractCount: number
    readonly evidenceCount: number
  }
  readonly classifications: readonly ['VALID', 'INVALID', 'UNKNOWN']
  readonly unknownAutoInvalid: false
  readonly policy: {
    readonly externalModelJudgeAllowed: false
    readonly latestDocumentationMayOverrideFrozenTarget: false
    readonly unknownCountsAsInvalidAutomatically: false
    readonly postOutcomeOracleEditsAllowed: false
  }
}

interface PilotTask {
  readonly id: string
  readonly oracleHints: {
    readonly validPackage?: string
    readonly validSymbols?: readonly string[]
    readonly evidenceIds?: readonly string[]
    readonly expectedAbsence?: readonly string[]
  }
}

interface PilotDocument {
  readonly datasetId: 'P0'
  readonly status: 'FROZEN-NON-SCORING'
  readonly target: ExactTargetIdentity
  readonly taskCount: number
  readonly tasks: readonly PilotTask[]
  readonly policy: {
    readonly scoringForM2Decision: false
    readonly mayCalibrateHarness: true
    readonly mayCalibrateOracleParsing: true
    readonly mayChooseH1MCIDAfterP0BeforeH1: true
    readonly mayRewriteH1AfterViewingH1Outcomes: false
  }
}

interface HoldoutCommitment {
  readonly schema: 'dsh-toolchain-m2-agent-holdout-commitment-v1'
  readonly datasetId: 'H1'
  readonly status: 'NOT_COMMITTED'
  readonly target: ExactTargetIdentity
  readonly commitmentSha256: null
  readonly taskCount: null
  readonly runAllowed: false
  readonly prerequisites: {
    readonly p0Completed: false
    readonly mcidFrozen: false
    readonly noninferiorityMarginFrozen: false
    readonly taskSetHashCommitted: false
  }
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(new URL(`../../docs/evaluation/m2/${name}`, import.meta.url), 'utf8'),
  ) as T
}

function expectedTarget(): ExactTargetIdentity {
  return {
    package: '@deepseek-ai/dsh',
    version: M2_RETRIEVAL_TARGET.dshVersion,
    profile: M2_RETRIEVAL_TARGET.profile,
    targetFingerprint: M2_RETRIEVAL_TARGET.targetFingerprint,
    contractIndexFingerprint: M2_RETRIEVAL_TARGET.contractIndexFingerprint,
  }
}

describe('M2.3 agent evaluation frozen documents', () => {
  it('binds the oracle and public P0 calibration set to the same exact frozen target', async () => {
    const [oracle, pilot, index] = await Promise.all([
      readJson<OracleDocument>('api-oracle-v1.json'),
      readJson<PilotDocument>('agent-pilot-p0.json'),
      createFrozenM2RetrievalIndex(),
    ])

    expect(oracle.target).toEqual(expectedTarget())
    expect(pilot.target).toEqual(expectedTarget())
    expect(oracle.authoritativeUniverse).toMatchObject({
      contractCount: index.contracts.length,
      evidenceCount: index.evidence.length,
    })
    expect(oracle.classifications).toEqual(['VALID', 'INVALID', 'UNKNOWN'])
    expect(oracle.unknownAutoInvalid).toBe(false)
    expect(oracle.policy).toEqual({
      externalModelJudgeAllowed: false,
      latestDocumentationMayOverrideFrozenTarget: false,
      unknownCountsAsInvalidAutomatically: false,
      postOutcomeOracleEditsAllowed: false,
    })
    expect(pilot.taskCount).toBe(pilot.tasks.length)
    expect(pilot.taskCount).toBeGreaterThanOrEqual(6)
    expect(pilot.policy.scoringForM2Decision).toBe(false)
  })

  it('proves every positive P0 oracle hint from authoritative declaration evidence', async () => {
    const [pilot, index] = await Promise.all([
      readJson<PilotDocument>('agent-pilot-p0.json'),
      createFrozenM2RetrievalIndex(),
    ])
    const contracts = new Map(index.contracts.map(contract => [contract.id, contract]))
    const evidence = new Map(index.evidence.map(item => [item.id, item]))

    for (const task of pilot.tasks) {
      const hints = task.oracleHints
      if (hints.validPackage === undefined) continue

      const contract = contracts.get(`package:${hints.validPackage}`)
      expect(contract, `missing package oracle for ${task.id}`).toBeDefined()
      for (const symbol of hints.validSymbols ?? []) {
        const fact = contract!.facts.find(
          item => item.key === 'declaration-export' && item.value === symbol,
        )
        expect(fact, `missing symbol oracle ${symbol} for ${task.id}`).toBeDefined()
        expect(
          fact!.evidenceIds.some(id => hints.evidenceIds?.includes(id) === true),
          `unproven P0 symbol ${symbol} for ${task.id}`,
        ).toBe(true)
        for (const evidenceId of fact!.evidenceIds) {
          const item = evidence.get(evidenceId)
          if (hints.evidenceIds?.includes(evidenceId) !== true) continue
          expect(item?.kind).toBe('type-declaration')
          expect(item?.strength).toBe('authoritative')
        }
      }
    }
  })

  it('proves every negative P0 oracle hint is absent from the complete frozen universe', async () => {
    const [pilot, index] = await Promise.all([
      readJson<PilotDocument>('agent-pilot-p0.json'),
      createFrozenM2RetrievalIndex(),
    ])
    const exportedSymbols = new Set(
      index.contracts.flatMap(contract => contract.facts)
        .filter(fact => fact.key === 'declaration-export')
        .map(fact => fact.value),
    )

    for (const task of pilot.tasks) {
      for (const symbol of task.oracleHints.expectedAbsence ?? []) {
        expect(exportedSymbols.has(symbol), `negative oracle leaked into rc.2 for ${task.id}`).toBe(false)
      }
    }
  })

  it('fails closed before H1 is hash-committed and documents the no-peeking boundary', async () => {
    const [commitment, protocol] = await Promise.all([
      readJson<HoldoutCommitment>('agent-holdout-h1.commitment.json'),
      readFile(new URL('../../docs/evaluation/m2/agent-comparison.md', import.meta.url), 'utf8'),
    ])

    expect(commitment).toEqual({
      schema: 'dsh-toolchain-m2-agent-holdout-commitment-v1',
      datasetId: 'H1',
      status: 'NOT_COMMITTED',
      target: expectedTarget(),
      commitmentSha256: null,
      taskCount: null,
      runAllowed: false,
      prerequisites: {
        p0Completed: false,
        mcidFrozen: false,
        noninferiorityMarginFrozen: false,
        taskSetHashCommitted: false,
      },
    })
    expect(protocol).toContain('H1 MUST NOT run while `status` is `NOT_COMMITTED`')
    expect(protocol).toContain('UNKNOWN is not INVALID')
    expect(protocol).toContain('C is never forced to call Toolchain')
    expect(protocol).toContain('MCID')
    expect(protocol).toContain('non-inferiority')
  })
})
