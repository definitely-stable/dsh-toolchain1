import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { adjudicateDevelopmentClaim, validateDevelopmentTaskOracle } from '../../scripts/eval/staged-adjudication.mjs'
import { loadDevelopmentCorpus } from '../../scripts/eval/development-corpus.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const developmentManifest = path.join(repoRoot, 'docs/evaluation/m2/h1-dev-corpus-v1/manifest.json')

function positiveTask() {
  return {
    id: 'positive',
    domain: 'approval',
    prompt: 'Which API exists?',
    successRule: {
      kind: 'api-exists-any',
      package: '@deepseek-ai/dsh-user-approval',
      symbols: ['ApprovalPolicy', 'ApprovalPolicy.mode'],
    },
  }
}

function packageAbsenceTask() {
  return {
    id: 'negative',
    domain: 'approval',
    prompt: 'Does this API exist?',
    successRule: {
      kind: 'api-absent',
      symbols: ['ApprovalService.resetPolicy'],
      proofScope: { kind: 'package', package: '@deepseek-ai/dsh-user-approval' },
    },
  }
}

function result(taskId: string, claim: { package: string; symbol: string; assertion: 'exists' | 'absent' }) {
  return {
    schema: 'dsh-toolchain-staged-eval-result-v1',
    taskId,
    claims: [claim],
  }
}

describe('deterministic staged task adjudication', () => {
  it('resolves positive task claims against the frozen task oracle without model verdict fields', () => {
    expect(adjudicateDevelopmentClaim(positiveTask(), result('positive', {
      package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'exists',
    }))).toEqual({ status: 'resolved', decision: { apiValid: true, taskSuccess: true } })

    expect(adjudicateDevelopmentClaim(positiveTask(), result('positive', {
      package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'absent',
    }))).toEqual({ status: 'resolved', decision: { apiValid: false, taskSuccess: false } })
  })

  it('resolves package-scoped absence claims deterministically', () => {
    expect(adjudicateDevelopmentClaim(packageAbsenceTask(), result('negative', {
      package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalService.resetPolicy', assertion: 'absent',
    }))).toEqual({ status: 'resolved', decision: { apiValid: true, taskSuccess: true } })

    expect(adjudicateDevelopmentClaim(packageAbsenceTask(), result('negative', {
      package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalService.resetPolicy', assertion: 'exists',
    }))).toEqual({ status: 'resolved', decision: { apiValid: false, taskSuccess: false } })
  })

  it('keeps an unrelated API identity unresolved instead of inventing a correctness verdict', () => {
    expect(adjudicateDevelopmentClaim(positiveTask(), result('positive', {
      package: '@deepseek-ai/dsh-scope', symbol: 'Scope', assertion: 'exists',
    }))).toEqual({ status: 'unresolved', reason: 'CLAIM_OUTSIDE_TASK_ORACLE' })

    expect(adjudicateDevelopmentClaim(packageAbsenceTask(), result('negative', {
      package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalService.otherMethod', assertion: 'absent',
    }))).toEqual({ status: 'unresolved', reason: 'CLAIM_OUTSIDE_TASK_ORACLE' })
  })

  it('requires target-wide absence proofs to use the explicit * package scope', () => {
    const task = {
      id: 'target-negative', domain: 'target', prompt: 'Does GhostApi exist?',
      successRule: {
        kind: 'api-absent',
        symbols: ['GhostApi'],
        proofScope: { kind: 'target' },
      },
    }

    expect(adjudicateDevelopmentClaim(task, result('target-negative', {
      package: '*', symbol: 'GhostApi', assertion: 'absent',
    }))).toEqual({ status: 'resolved', decision: { apiValid: true, taskSuccess: true } })
    expect(adjudicateDevelopmentClaim(task, result('target-negative', {
      package: '@deepseek-ai/dsh-scope', symbol: 'GhostApi', assertion: 'absent',
    }))).toEqual({ status: 'unresolved', reason: 'CLAIM_OUTSIDE_TASK_ORACLE' })
  })

  it('validates every committed DEVELOPMENT_ONLY task oracle before provider execution', async () => {
    const corpus = await loadDevelopmentCorpus(developmentManifest)
    expect(corpus.tasks).toHaveLength(96)
    for (const task of corpus.tasks) expect(() => validateDevelopmentTaskOracle(task)).not.toThrow()
  })
})
