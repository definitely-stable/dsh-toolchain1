import { describe, expect, it } from 'vitest'

import type { ClassifiedApiClaimV2 } from './m2-api-claims-v2.js'
import type { ApiTruthEntryV2, ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import {
  H1_TASK_ADJUDICATOR_ID,
  adjudicateH1ModelOutcomeV2,
  adjudicateH1TaskSuccessV2,
  validateH1TaskSuccessRuleV2,
} from './m2-h1-task-adjudication-v2.js'

function evidence(path = '/exact-target/node_modules/@example/pkg/index.d.ts') {
  return Object.freeze([{ path, sha256: 'a'.repeat(64) }])
}

function apiEntry(
  packageName: string,
  qualifiedSymbol: string,
  kind: ApiTruthEntryV2['kind'] = qualifiedSymbol.includes('.') ? 'class-member' : 'export',
): ApiTruthEntryV2 {
  const owner = qualifiedSymbol.includes('.') ? qualifiedSymbol.slice(0, qualifiedSymbol.lastIndexOf('.')) : undefined
  return Object.freeze({
    package: packageName,
    kind,
    symbol: qualifiedSymbol.slice(qualifiedSymbol.lastIndexOf('.') + 1),
    qualifiedSymbol,
    ...(owner === undefined ? {} : { owner }),
    evidence: evidence(),
  })
}

function truth(
  entries: readonly ApiTruthEntryV2[],
  packages: readonly { readonly name: string; readonly complete: boolean }[] = [
    { name: '@example/pkg', complete: true },
  ],
): ApiTruthUniverseV2 {
  return Object.freeze({
    schema: 'dsh-api-truth-v2',
    targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
    workspaceSnapshotSha256: '2'.repeat(64),
    packages: Object.freeze(packages.map(item => Object.freeze({
      name: item.name,
      version: '1.0.0',
      entrypoints: Object.freeze([`/exact-target/node_modules/${item.name}/index.d.ts`]),
      visitedDeclarations: Object.freeze([`/exact-target/node_modules/${item.name}/index.d.ts`]),
      unresolvedPublicEdges: Object.freeze([]),
      complete: item.complete,
    }))),
    entries: Object.freeze([...entries]),
    fingerprint: `dsh-api-truth-v2:${'3'.repeat(64)}`,
  })
}

function claim(
  overrides: Partial<ClassifiedApiClaimV2> & Pick<
    ClassifiedApiClaimV2,
    'package' | 'symbol' | 'assertion' | 'classification'
  >,
): ClassifiedApiClaimV2 {
  const segments = Object.freeze(overrides.symbol.split('.'))
  return Object.freeze({
    segments,
    leaf: segments.at(-1) ?? overrides.symbol,
    resolution: 'exact-export',
    reason: 'test',
    evidence: Object.freeze([]),
    canonicalMatches: Object.freeze([overrides.symbol]),
    ...overrides,
  })
}

const positiveRule = Object.freeze({
  kind: 'api-exists-any' as const,
  package: '@example/pkg',
  symbols: Object.freeze(['Service.run', 'run']),
})

const packageAbsenceRule = Object.freeze({
  kind: 'api-absent' as const,
  symbols: Object.freeze(['ToolAutopilot']),
  proofScope: Object.freeze({ kind: 'package' as const, package: '@example/pkg' }),
})

const targetAbsenceRule = Object.freeze({
  kind: 'api-absent' as const,
  symbols: Object.freeze(['ToolAutopilot']),
  proofScope: Object.freeze({ kind: 'target' as const }),
})

describe('M2.3 H1 declarative task adjudicator v2 rules', () => {
  it('exports one stable versioned adjudicator identity', () => {
    expect(H1_TASK_ADJUDICATOR_ID).toBe('dsh-toolchain-m2-h1-task-adjudicator-v2')
  })

  it('validates and freezes the closed positive/negative rule vocabulary', () => {
    expect(validateH1TaskSuccessRuleV2(positiveRule)).toEqual(positiveRule)
    expect(validateH1TaskSuccessRuleV2(packageAbsenceRule)).toEqual(packageAbsenceRule)
    expect(validateH1TaskSuccessRuleV2(targetAbsenceRule)).toEqual(targetAbsenceRule)
  })

  it('rejects unknown keys/kinds, malformed identities, duplicates and invalid proof scopes', () => {
    expect(() => validateH1TaskSuccessRuleV2({
      ...positiveRule,
      unexpected: true,
    })).toThrow(/unknown|unexpected/u)
    expect(() => validateH1TaskSuccessRuleV2({
      kind: 'llm-judge',
      package: '@example/pkg',
      symbols: ['Service.run'],
    })).toThrow(/kind/u)
    expect(() => validateH1TaskSuccessRuleV2({
      kind: 'api-exists-any',
      package: '*',
      symbols: ['Service.run'],
    })).toThrow(/package/u)
    expect(() => validateH1TaskSuccessRuleV2({
      kind: 'api-exists-any',
      package: '@example/pkg',
      symbols: ['bad..symbol'],
    })).toThrow(/symbol/u)
    expect(() => validateH1TaskSuccessRuleV2({
      kind: 'api-exists-any',
      package: '@example/pkg',
      symbols: ['run', 'run'],
    })).toThrow(/unique|duplicate/u)
    expect(() => validateH1TaskSuccessRuleV2({
      kind: 'api-absent',
      symbols: ['ToolAutopilot'],
      proofScope: { kind: 'target', package: '@example/pkg' },
    })).toThrow(/proof|unknown|package/u)
  })
})

describe('M2.3 H1 positive task-success semantics', () => {
  it('returns SUCCESS for one valid accepted API in the required package', () => {
    expect(adjudicateH1TaskSuccessV2(positiveRule, [claim({
      package: '@example/pkg',
      symbol: 'Service.run',
      assertion: 'exists',
      classification: 'VALID',
    })], truth([apiEntry('@example/pkg', 'Service.run')]))).toBe('SUCCESS')
  })

  it('returns FAILURE when the accepted API is asserted in the wrong package', () => {
    expect(adjudicateH1TaskSuccessV2(positiveRule, [claim({
      package: '@wrong/pkg',
      symbol: 'Service.run',
      assertion: 'exists',
      classification: 'INVALID',
      resolution: 'wrong-package',
      canonicalMatches: ['@example/pkg:Service.run'],
    })], truth([apiEntry('@example/pkg', 'Service.run')], [
      { name: '@example/pkg', complete: true },
      { name: '@wrong/pkg', complete: true },
    ]))).toBe('FAILURE')
  })

  it('returns UNKNOWN instead of cherry-picking when correct and conflicting relevant claims coexist', () => {
    const claims = [
      claim({
        package: '@example/pkg',
        symbol: 'Service.run',
        assertion: 'exists',
        classification: 'VALID',
      }),
      claim({
        package: '@wrong/pkg',
        symbol: 'Service.run',
        assertion: 'exists',
        classification: 'INVALID',
        resolution: 'wrong-package',
        canonicalMatches: ['@example/pkg:Service.run'],
      }),
    ]
    expect(adjudicateH1TaskSuccessV2(positiveRule, claims, truth([apiEntry('@example/pkg', 'Service.run')], [
      { name: '@example/pkg', complete: true },
      { name: '@wrong/pkg', complete: true },
    ]))).toBe('UNKNOWN')
  })

  it('ignores unrelated INVALID claims and contradictions', () => {
    const claims = [
      claim({
        package: '@example/pkg',
        symbol: 'Service.run',
        assertion: 'exists',
        classification: 'VALID',
      }),
      claim({
        package: '@noise/pkg',
        symbol: 'Imaginary',
        assertion: 'exists',
        classification: 'INVALID',
      }),
      claim({
        package: '@noise/pkg',
        symbol: 'Imaginary',
        assertion: 'absent',
        classification: 'VALID',
      }),
    ]
    expect(adjudicateH1TaskSuccessV2(positiveRule, claims, truth([apiEntry('@example/pkg', 'Service.run')]))).toBe('SUCCESS')
  })

  it('returns UNKNOWN for relevant ambiguity/contradiction and for missing relevant evidence', () => {
    expect(adjudicateH1TaskSuccessV2(positiveRule, [claim({
      package: '@example/pkg',
      symbol: 'run',
      assertion: 'exists',
      classification: 'UNKNOWN',
      resolution: 'ambiguous-member',
      canonicalMatches: ['Service.run', 'Other.run'],
    })], truth([]))).toBe('UNKNOWN')

    expect(adjudicateH1TaskSuccessV2(positiveRule, [
      claim({
        package: '@example/pkg',
        symbol: 'Service.run',
        assertion: 'exists',
        classification: 'VALID',
      }),
      claim({
        package: '@example/pkg',
        symbol: 'Service.run',
        assertion: 'absent',
        classification: 'INVALID',
      }),
    ], truth([apiEntry('@example/pkg', 'Service.run')]))).toBe('UNKNOWN')

    expect(adjudicateH1TaskSuccessV2(positiveRule, [], truth([]))).toBe('UNKNOWN')
  })
})

describe('M2.3 H1 negative task-success semantics', () => {
  it('returns SUCCESS for a valid package-scoped absence and ignores existence in another package', () => {
    const claims = [
      claim({
        package: '@example/pkg',
        symbol: 'ToolAutopilot',
        assertion: 'absent',
        classification: 'VALID',
        resolution: 'complete-absence',
        canonicalMatches: [],
      }),
      claim({
        package: '@other/pkg',
        symbol: 'ToolAutopilot',
        assertion: 'exists',
        classification: 'VALID',
      }),
    ]
    expect(adjudicateH1TaskSuccessV2(packageAbsenceRule, claims, truth([
      apiEntry('@other/pkg', 'ToolAutopilot'),
    ], [
      { name: '@example/pkg', complete: true },
      { name: '@other/pkg', complete: true },
    ]))).toBe('SUCCESS')
  })

  it('uses package completeness to prove a package-scoped task from a broader UNKNOWN absence claim', () => {
    const broadUnknown = claim({
      package: '*',
      symbol: 'ToolAutopilot',
      assertion: 'absent',
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
      canonicalMatches: [],
    })
    const universe = truth([], [
      { name: '@example/pkg', complete: true },
      { name: '@incomplete/pkg', complete: false },
    ])

    expect(adjudicateH1TaskSuccessV2(packageAbsenceRule, [broadUnknown], universe)).toBe('SUCCESS')
    expect(adjudicateH1TaskSuccessV2(targetAbsenceRule, [broadUnknown], universe)).toBe('UNKNOWN')
  })

  it('returns FAILURE for a relevant existence claim or false absence', () => {
    expect(adjudicateH1TaskSuccessV2(targetAbsenceRule, [claim({
      package: '@example/pkg',
      symbol: 'ToolAutopilot',
      assertion: 'exists',
      classification: 'VALID',
    })], truth([apiEntry('@example/pkg', 'ToolAutopilot')]))).toBe('FAILURE')

    expect(adjudicateH1TaskSuccessV2(packageAbsenceRule, [claim({
      package: '@example/pkg',
      symbol: 'ToolAutopilot',
      assertion: 'absent',
      classification: 'INVALID',
    })], truth([apiEntry('@example/pkg', 'ToolAutopilot')]))).toBe('FAILURE')
  })

  it('returns UNKNOWN for task-relevant contradictions and unresolved incomplete proof', () => {
    const contradictory = [
      claim({
        package: '@example/pkg',
        symbol: 'ToolAutopilot',
        assertion: 'exists',
        classification: 'INVALID',
      }),
      claim({
        package: '@example/pkg',
        symbol: 'ToolAutopilot',
        assertion: 'absent',
        classification: 'VALID',
      }),
    ]
    expect(adjudicateH1TaskSuccessV2(packageAbsenceRule, contradictory, truth([]))).toBe('UNKNOWN')

    const incomplete = truth([], [{ name: '@example/pkg', complete: false }])
    expect(adjudicateH1TaskSuccessV2(packageAbsenceRule, [claim({
      package: '@example/pkg',
      symbol: 'ToolAutopilot',
      assertion: 'absent',
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
      canonicalMatches: [],
    })], incomplete)).toBe('UNKNOWN')
  })
})

describe('M2.3 H1 model-outcome wrapper', () => {
  it('uses the generic API parser/classifier and never needs a task id or prompt', () => {
    const universe = truth([apiEntry('@example/pkg', 'Service.run')])
    const outcome = adjudicateH1ModelOutcomeV2(
      positiveRule,
      'API_CLAIM package=@example/pkg symbol=Service.run assertion=exists\nUse Service.run.',
      universe,
    )

    expect(outcome.taskSuccess).toBe('SUCCESS')
    expect(outcome.parsedApiClaims).toHaveLength(1)
    expect(outcome.parsedApiClaims[0]).toMatchObject({
      package: '@example/pkg',
      symbol: 'Service.run',
      assertion: 'exists',
      classification: 'VALID',
    })
  })
})
