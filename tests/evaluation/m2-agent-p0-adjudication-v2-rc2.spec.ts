import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  buildApiTruthUniverseV2,
  type ApiTruthUniverseV2,
} from './m2-api-truth-v2.js'
import {
  adjudicateP0ModelOutcomeV2,
  classifyP0ApiClaimsV2,
  parseP0ApiClaimsV2,
} from './m2-agent-p0-adjudication-v2.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'

const sha256 = createNodeSha256Port()
let truth: ApiTruthUniverseV2

beforeAll(async () => {
  const fixture = new URL('./fixtures/m2/rc2-web-v1/ordinary-workspace.json', import.meta.url)
  const workspace = JSON.parse(await readFile(fixture, 'utf8')) as OrdinaryWorkspace
  truth = await buildApiTruthUniverseV2(workspace, sha256)
})

describe('M2.3 P0 adjudication v2 against frozen rc.2 truth', () => {
  it('recognizes exact approval class methods and keeps a genuinely ambiguous historical bare member UNKNOWN', () => {
    const claims = classifyP0ApiClaimsV2(parseP0ApiClaimsV2([
      'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=ApprovalService.setPolicy assertion=exists',
      'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=setPolicy assertion=exists',
      'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=ApprovalService.overrideOf assertion=exists',
    ].join('\n')), truth)

    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        symbol: 'ApprovalService.setPolicy',
        classification: 'VALID',
        resolution: 'exact-member',
      }),
      expect.objectContaining({
        symbol: 'setPolicy',
        classification: 'UNKNOWN',
        resolution: 'ambiguous-member',
        canonicalMatches: ['ApprovalService.setPolicy', 'default.setPolicy'],
      }),
      expect.objectContaining({
        symbol: 'ApprovalService.overrideOf',
        classification: 'VALID',
        resolution: 'exact-member',
      }),
    ]))
  })

  it('adjudicates resolveChildDepth as the public delegation-depth API', () => {
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-05',
      'API_CLAIM package=@deepseek-ai/dsh-subagent symbol=resolveChildDepth assertion=exists',
      truth,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      classification: 'VALID',
      resolution: 'exact-export',
    })
    expect(outcome.taskSuccess).toBe('SUCCESS')
  })

  it('keeps real missing declaration closure visible instead of pretending the whole target is complete', () => {
    expect(truth.packages.find(pkg => pkg.name === '@deepseek-ai/dsh-tools')?.complete).toBe(true)
    expect(truth.packages.some(pkg => !pkg.complete)).toBe(true)
    expect(truth.packages.find(pkg => pkg.name === '@deepseek-ai/dsh-client-runtime')).toMatchObject({
      complete: false,
    })
  })

  it('retains the qualified patchReload claim but fails target-wide absence closed on the partial frozen declaration universe', () => {
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-07',
      'API_CLAIM package=* symbol=profile.patchReload assertion=absent',
      truth,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      symbol: 'profile.patchReload',
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
    })
    expect(outcome.taskSuccess).toBe('UNKNOWN')
  })

  it('proves the ToolAutopilot task from the complete dsh-tools scope without overstating target-wide completeness', () => {
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-08',
      'API_CLAIM package=* symbol=ToolAutopilot assertion=absent',
      truth,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
    })
    expect(outcome.taskSuccess).toBe('SUCCESS')
  })
})
