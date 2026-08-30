import { describe, expect, it } from 'vitest'

import {
  classifyApiClaimsV2,
  parseApiClaimsV2,
  type ApiClaimResolutionV2,
} from './m2-api-claims-v2.js'
import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'

const SHA = '1'.repeat(64)

function truth(completeB = true): ApiTruthUniverseV2 {
  return Object.freeze({
    schema: 'dsh-api-truth-v2',
    targetFingerprint: `dsh-target-v2:${'2'.repeat(64)}`,
    workspaceSnapshotSha256: '3'.repeat(64),
    fingerprint: `dsh-api-truth-v2:${'4'.repeat(64)}`,
    packages: Object.freeze([
      Object.freeze({
        name: '@example/a',
        version: '1.0.0',
        entrypoints: Object.freeze(['/a/index.d.ts']),
        visitedDeclarations: Object.freeze(['/a/index.d.ts']),
        unresolvedPublicEdges: Object.freeze([]),
        complete: true,
      }),
      Object.freeze({
        name: '@example/b',
        version: '1.0.0',
        entrypoints: Object.freeze(['/b/index.d.ts']),
        visitedDeclarations: Object.freeze(['/b/index.d.ts']),
        unresolvedPublicEdges: Object.freeze(completeB ? [] : ['missing.d.ts']),
        complete: completeB,
      }),
    ]),
    entries: Object.freeze([
      Object.freeze({
        package: '@example/a',
        kind: 'export',
        symbol: 'defineThing',
        qualifiedSymbol: 'defineThing',
        evidence: Object.freeze([{ path: '/a/index.d.ts', sha256: SHA }]),
      }),
      Object.freeze({
        package: '@example/b',
        kind: 'class-member',
        owner: 'ApprovalService',
        symbol: 'setPolicy',
        qualifiedSymbol: 'ApprovalService.setPolicy',
        evidence: Object.freeze([{ path: '/b/index.d.ts', sha256: SHA }]),
      }),
    ]),
  })
}

function classification(
  answer: string,
  universe: ApiTruthUniverseV2 = truth(),
) {
  const [claim] = classifyApiClaimsV2(parseApiClaimsV2(answer), universe)
  expect(claim).toBeDefined()
  return claim!
}

describe('task-neutral API claims v2', () => {
  it('parses qualified public-member spellings without task-specific knowledge', () => {
    expect(parseApiClaimsV2(
      'API_CLAIM package=@example/b symbol=ApprovalService.setPolicy assertion=exists',
    )).toEqual([{
      package: '@example/b',
      symbol: 'ApprovalService.setPolicy',
      segments: ['ApprovalService', 'setPolicy'],
      leaf: 'setPolicy',
      assertion: 'exists',
    }])
  })

  it('classifies exact and uniquely resolvable public members generically', () => {
    expect(classification(
      'API_CLAIM package=@example/b symbol=ApprovalService.setPolicy assertion=exists',
    )).toMatchObject({ classification: 'VALID', resolution: 'exact-member' satisfies ApiClaimResolutionV2 })

    expect(classification(
      'API_CLAIM package=@example/b symbol=setPolicy assertion=exists',
    )).toMatchObject({ classification: 'VALID', resolution: 'unique-member-leaf' satisfies ApiClaimResolutionV2 })
  })

  it('distinguishes wrong-package claims from complete absence', () => {
    expect(classification(
      'API_CLAIM package=@example/a symbol=setPolicy assertion=exists',
    )).toMatchObject({ classification: 'INVALID', resolution: 'wrong-package' })

    expect(classification(
      'API_CLAIM package=@example/a symbol=missingSymbol assertion=absent',
    )).toMatchObject({ classification: 'VALID', resolution: 'complete-absence' })
  })

  it('fails closed for target-wide absence when any authoritative package is incomplete', () => {
    expect(classification(
      'API_CLAIM package=* symbol=missingSymbol assertion=absent',
      truth(false),
    )).toMatchObject({ classification: 'UNKNOWN', resolution: 'incomplete-universe' })

    expect(classification(
      'API_CLAIM package=* symbol=missingSymbol assertion=absent',
      truth(true),
    )).toMatchObject({ classification: 'VALID', resolution: 'complete-absence' })
  })
})
