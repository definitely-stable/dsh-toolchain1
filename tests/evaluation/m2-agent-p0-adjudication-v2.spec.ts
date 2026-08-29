import { describe, expect, it } from 'vitest'

import type { ApiTruthEntryV2, ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import {
  adjudicateP0TaskSuccessV2,
  classifyP0ApiClaimsV2,
  parseP0ApiClaimsV2,
  type ClassifiedP0ApiClaimV2,
} from './m2-agent-p0-adjudication-v2.js'

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

function classified(
  overrides: Partial<ClassifiedP0ApiClaimV2> & Pick<ClassifiedP0ApiClaimV2, 'package' | 'symbol' | 'assertion' | 'classification'>,
): ClassifiedP0ApiClaimV2 {
  return Object.freeze({
    segments: Object.freeze(overrides.symbol.split('.')),
    leaf: overrides.symbol.slice(overrides.symbol.lastIndexOf('.') + 1),
    resolution: 'exact-export',
    reason: 'test',
    evidence: Object.freeze([]),
    canonicalMatches: Object.freeze([]),
    ...overrides,
  })
}

describe('M2.3 P0 adjudication v2', () => {
  it('parses qualified API identities while rejecting malformed dotted paths', () => {
    const claims = parseP0ApiClaimsV2([
      'API_CLAIM package=* symbol=profile.patchReload assertion=absent',
      'API_CLAIM package=@example/pkg symbol=ApprovalService.setPolicy assertion=exists',
      'API_CLAIM package=@example/pkg symbol=foo..bar assertion=exists',
      'API_CLAIM package=@example/pkg symbol=.foo assertion=exists',
      'API_CLAIM package=@example/pkg symbol=foo() assertion=exists',
    ].join('\n'))

    expect(claims).toEqual([
      {
        package: '*',
        symbol: 'profile.patchReload',
        segments: ['profile', 'patchReload'],
        leaf: 'patchReload',
        assertion: 'absent',
      },
      {
        package: '@example/pkg',
        symbol: 'ApprovalService.setPolicy',
        segments: ['ApprovalService', 'setPolicy'],
        leaf: 'setPolicy',
        assertion: 'exists',
      },
    ])
  })

  it('classifies exact public members and unique historical bare-member claims', () => {
    const universe = truth([
      apiEntry('@example/pkg', 'ApprovalService'),
      apiEntry('@example/pkg', 'ApprovalService.setPolicy'),
    ])
    const claims = parseP0ApiClaimsV2([
      'API_CLAIM package=@example/pkg symbol=ApprovalService.setPolicy assertion=exists',
      'API_CLAIM package=@example/pkg symbol=setPolicy assertion=exists',
    ].join('\n'))

    const results = classifyP0ApiClaimsV2(claims, universe)

    expect(results[0]).toMatchObject({
      classification: 'VALID',
      resolution: 'exact-member',
      canonicalMatches: ['ApprovalService.setPolicy'],
    })
    expect(results[1]).toMatchObject({
      classification: 'VALID',
      resolution: 'unique-member-leaf',
      canonicalMatches: ['ApprovalService.setPolicy'],
    })
  })

  it('returns UNKNOWN for an ambiguous bare member instead of guessing an owner', () => {
    const universe = truth([
      apiEntry('@example/pkg', 'ApprovalService.setPolicy'),
      apiEntry('@example/pkg', 'PolicyStore.setPolicy'),
    ])
    const [result] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=@example/pkg symbol=setPolicy assertion=exists'),
      universe,
    )

    expect(result).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'ambiguous-member',
      canonicalMatches: ['ApprovalService.setPolicy', 'PolicyStore.setPolicy'],
    })
  })

  it('classifies wrong-package positives as INVALID when authoritative truth places the API elsewhere', () => {
    const universe = truth(
      [apiEntry('@other/pkg', 'Service.run')],
      [
        { name: '@example/pkg', complete: true },
        { name: '@other/pkg', complete: true },
      ],
    )
    const [result] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=@example/pkg symbol=Service.run assertion=exists'),
      universe,
    )

    expect(result).toMatchObject({
      classification: 'INVALID',
      resolution: 'wrong-package',
      canonicalMatches: ['@other/pkg:Service.run'],
    })
  })

  it('fails qualified target-wide absence closed when a matching leaf exists under another public owner', () => {
    const universe = truth([apiEntry('@example/pkg', 'Profile.patchReload', 'interface-member')])
    const [result] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=* symbol=profile.patchReload assertion=absent'),
      universe,
    )

    expect(result).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'qualified-absence-conflict',
      canonicalMatches: ['@example/pkg:Profile.patchReload'],
    })
  })

  it('accepts qualified target-wide absence only when the complete public universe has no matching leaf', () => {
    const universe = truth([apiEntry('@example/pkg', 'Service.run')])
    const [result] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=* symbol=profile.patchReload assertion=absent'),
      universe,
    )

    expect(result).toMatchObject({
      classification: 'VALID',
      resolution: 'complete-absence',
    })
  })

  it('returns UNKNOWN for absence when any authoritative package surface is incomplete', () => {
    const universe = truth(
      [],
      [
        { name: '@example/pkg', complete: true },
        { name: '@incomplete/pkg', complete: false },
      ],
    )
    const [result] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=* symbol=ToolAutopilot assertion=absent'),
      universe,
    )

    expect(result).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
    })
  })

  it('uses resolveChildDepth as the delegation-depth success claim', () => {
    const claims = [classified({
      package: '@deepseek-ai/dsh-subagent',
      symbol: 'resolveChildDepth',
      assertion: 'exists',
      classification: 'VALID',
    })]

    expect(adjudicateP0TaskSuccessV2('p0-05', claims)).toBe('SUCCESS')
  })

  it('does not fail positive task success because of an unrelated invalid API claim', () => {
    const claims = [
      classified({
        package: '@deepseek-ai/dsh-session-query',
        symbol: 'compileSessionTextFilter',
        assertion: 'exists',
        classification: 'VALID',
      }),
      classified({
        package: '@example/pkg',
        symbol: 'ImaginaryApi',
        assertion: 'exists',
        classification: 'INVALID',
      }),
    ]

    expect(adjudicateP0TaskSuccessV2('p0-04', claims)).toBe('SUCCESS')
  })

  it('does not fail a negative task because of an unrelated invalid claim or contradiction', () => {
    const claims = [
      classified({
        package: '*',
        symbol: 'ToolAutopilot',
        assertion: 'absent',
        classification: 'VALID',
      }),
      classified({
        package: '@example/pkg',
        symbol: 'ImaginaryApi',
        assertion: 'exists',
        classification: 'INVALID',
      }),
      classified({
        package: '@example/pkg',
        symbol: 'Unrelated',
        assertion: 'exists',
        classification: 'INVALID',
      }),
      classified({
        package: '@example/pkg',
        symbol: 'Unrelated',
        assertion: 'absent',
        classification: 'VALID',
      }),
    ]

    expect(adjudicateP0TaskSuccessV2('p0-08', claims)).toBe('SUCCESS')
  })

  it('keeps contradictions on the task-relevant identity UNKNOWN', () => {
    const claims = [
      classified({
        package: '*',
        symbol: 'ToolAutopilot',
        assertion: 'exists',
        classification: 'INVALID',
      }),
      classified({
        package: '*',
        symbol: 'ToolAutopilot',
        assertion: 'absent',
        classification: 'VALID',
      }),
    ]

    expect(adjudicateP0TaskSuccessV2('p0-08', claims)).toBe('UNKNOWN')
  })
})
