import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { buildApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import {
  adjudicateP0ModelOutcomeV2,
  classifyP0ApiClaimsV2,
  parseP0ApiClaimsV2,
} from './m2-agent-p0-adjudication-v2.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'

const sha256 = createNodeSha256Port()

async function frozenRc2Truth() {
  const fixture = new URL('./fixtures/m2/rc2-web-v1/ordinary-workspace.json', import.meta.url)
  const workspace = JSON.parse(await readFile(fixture, 'utf8')) as OrdinaryWorkspace
  return buildApiTruthUniverseV2(workspace, sha256)
}

describe('M2.3 P0 adjudication v2 against frozen rc.2 truth', () => {
  it('recognizes real approval class methods through exact and historical bare-member claims', async () => {
    const truth = await frozenRc2Truth()
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
        classification: 'VALID',
        resolution: 'unique-member-leaf',
        canonicalMatches: ['ApprovalService.setPolicy'],
      }),
      expect.objectContaining({
        symbol: 'ApprovalService.overrideOf',
        classification: 'VALID',
        resolution: 'exact-member',
      }),
    ]))
  })

  it('adjudicates resolveChildDepth as the public delegation-depth API', async () => {
    const truth = await frozenRc2Truth()
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

  it('parses the retained qualified drift claim and only accepts absence when frozen truth is complete enough', async () => {
    const truth = await frozenRc2Truth()
    const [claim] = classifyP0ApiClaimsV2(
      parseP0ApiClaimsV2('API_CLAIM package=* symbol=profile.patchReload assertion=absent'),
      truth,
    )

    expect(claim?.symbol).toBe('profile.patchReload')
    expect(claim?.classification).toBe('VALID')
    expect(claim?.resolution).toBe('complete-absence')
  })

  it('rejects ToolAutopilot as absent from the complete frozen target public surface', async () => {
    const truth = await frozenRc2Truth()
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-08',
      'API_CLAIM package=* symbol=ToolAutopilot assertion=absent',
      truth,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      classification: 'VALID',
      resolution: 'complete-absence',
    })
    expect(outcome.taskSuccess).toBe('SUCCESS')
  })
})
