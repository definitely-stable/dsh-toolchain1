import { describe, expect, it } from 'vitest'

import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import { adjudicateH1ModelOutcomeV2 } from './m2-h1-task-adjudication-v2.js'
import { reAdjudicateH1ModelAttemptV2 } from './m2-h1-terminal-result-v2.js'

const rule = Object.freeze({
  kind: 'api-exists-any' as const,
  package: '@example/pkg',
  symbols: Object.freeze(['Service.run']),
})

const truth: ApiTruthUniverseV2 = Object.freeze({
  schema: 'dsh-api-truth-v2',
  targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
  workspaceSnapshotSha256: '2'.repeat(64),
  packages: Object.freeze([Object.freeze({
    name: '@example/pkg',
    version: '1.0.0',
    entrypoints: Object.freeze(['/exact-target/node_modules/@example/pkg/index.d.ts']),
    visitedDeclarations: Object.freeze(['/exact-target/node_modules/@example/pkg/index.d.ts']),
    unresolvedPublicEdges: Object.freeze([]),
    complete: true,
  })]),
  entries: Object.freeze([Object.freeze({
    package: '@example/pkg',
    kind: 'class-member' as const,
    symbol: 'run',
    qualifiedSymbol: 'Service.run',
    owner: 'Service',
    evidence: Object.freeze([Object.freeze({
      path: '/exact-target/node_modules/@example/pkg/index.d.ts',
      sha256: 'a'.repeat(64),
    })]),
  })]),
  fingerprint: `dsh-api-truth-v2:${'3'.repeat(64)}`,
})

const answer = 'API_CLAIM package=@example/pkg symbol=Service.run assertion=exists\nUse Service.run.'

describe('M2 H1 terminal result v2', () => {
  it('re-adjudicates retained raw answer bytes with the frozen H1 adjudicator', () => {
    const stored = adjudicateH1ModelOutcomeV2(rule, answer, truth)
    expect(reAdjudicateH1ModelAttemptV2(
      rule,
      answer,
      stored.parsedApiClaims,
      stored.taskSuccess,
      truth,
    )).toEqual(stored)
  })

  it('fails closed if persisted derived adjudication differs from fresh frozen adjudication', () => {
    const stored = adjudicateH1ModelOutcomeV2(rule, answer, truth)
    expect(() => reAdjudicateH1ModelAttemptV2(
      rule,
      answer,
      stored.parsedApiClaims,
      'FAILURE',
      truth,
    )).toThrow(/adjudication|drift/u)
  })
})
