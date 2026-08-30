import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  evaluateH1ReadinessV2,
  type H1CommitmentV2,
} from './m2-h1-readiness-v2.js'

const commitmentUrl = new URL(
  '../../docs/evaluation/m2/agent-holdout-h1-v2.commitment.json',
  import.meta.url,
)
const TASK_ADJUDICATOR_ID = 'dsh-toolchain-m2-h1-task-adjudicator-v2'
const TASK_ADJUDICATOR_SOURCE_COMMIT = '8539d8cc173512233c5a04ff9be65a1583c3e9cf'

describe('M2.3 H1 adjudicator identity binding', () => {
  it('binds the public commitment to the exact merged task adjudicator source commit', async () => {
    const commitment = JSON.parse(await readFile(commitmentUrl, 'utf8')) as H1CommitmentV2

    expect(commitment.measurement.taskAdjudicator).toEqual({
      id: TASK_ADJUDICATOR_ID,
      sourceCommit: TASK_ADJUDICATOR_SOURCE_COMMIT,
    })
    expect(evaluateH1ReadinessV2(commitment)).toEqual({
      status: 'BLOCKED',
      blockers: [
        'COMMITMENT_NOT_FINALIZED',
        'MCID_NOT_FROZEN',
        'NONINFERIORITY_MARGIN_NOT_FROZEN',
        'TASK_SET_NOT_COMMITTED',
        'PROVIDER_IDENTITY_NOT_FROZEN',
      ],
      runAllowed: false,
    })
  })

  it('fails closed when a different syntactically valid adjudicator commit is substituted', async () => {
    const commitment = JSON.parse(await readFile(commitmentUrl, 'utf8')) as H1CommitmentV2
    const drifted: H1CommitmentV2 = {
      ...commitment,
      measurement: {
        ...commitment.measurement,
        taskAdjudicator: {
          id: TASK_ADJUDICATOR_ID,
          sourceCommit: '9'.repeat(40),
        },
      },
    }

    expect(evaluateH1ReadinessV2(drifted)).toEqual({
      status: 'BLOCKED',
      blockers: [
        'COMMITMENT_NOT_FINALIZED',
        'TASK_ADJUDICATOR_NOT_FROZEN',
        'MCID_NOT_FROZEN',
        'NONINFERIORITY_MARGIN_NOT_FROZEN',
        'TASK_SET_NOT_COMMITTED',
        'PROVIDER_IDENTITY_NOT_FROZEN',
      ],
      runAllowed: false,
    })
  })
})
