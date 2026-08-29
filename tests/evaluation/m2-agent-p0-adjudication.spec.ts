import { describe, expect, it } from 'vitest'

import {
  adjudicateP0ModelOutcome,
  adjudicateP0TaskSuccess,
  classifyP0ApiClaims,
  parseP0ApiClaims,
  type ClassifiedP0ApiClaim,
  type ParsedP0ApiClaim,
} from './m2-agent-p0-adjudication.js'

function claim(
  packageName: string,
  symbol: string,
  assertion: 'exists' | 'absent',
): ParsedP0ApiClaim {
  return { package: packageName, symbol, assertion }
}

function classified(
  packageName: string,
  symbol: string,
  assertion: 'exists' | 'absent',
  classification: 'VALID' | 'INVALID' | 'UNKNOWN' = 'VALID',
): ClassifiedP0ApiClaim {
  return {
    package: packageName,
    symbol,
    assertion,
    classification,
    reason: `${classification} test fixture`,
    evidenceIds: classification === 'VALID' ? ['evidence:test'] : [],
  }
}

describe('M2.3 P0 structured API claim parsing', () => {
  it('parses exact structured claim lines and deduplicates exact repeats', () => {
    const answer = [
      'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists',
      'API_CLAIM package=* symbol=patchReload assertion=absent',
      'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists',
      'Explanation follows.',
    ].join('\n')

    expect(parseP0ApiClaims(answer)).toEqual([
      claim('@deepseek-ai/dsh-tools', 'defineTool', 'exists'),
      claim('*', 'patchReload', 'absent'),
    ])
  })

  it('ignores malformed or unsafe claim lines rather than guessing a repair', () => {
    const answer = [
      'API_CLAIM package=@deepseek-ai/dsh-tools symbol= assertion=exists',
      'API_CLAIM package=../dsh-tools symbol=defineTool assertion=exists',
      'API_CLAIM package=@deepseek-ai/dsh tools symbol=defineTool assertion=exists',
      'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=maybe',
      'API_CLAIM package=@deepseek-ai/dsh-tools symbol=defineTool assertion=exists extra=value',
      'API_CLAIM symbol=defineTool package=@deepseek-ai/dsh-tools assertion=exists',
      'not a claim',
    ].join('\n')

    expect(parseP0ApiClaims(answer)).toEqual([])
  })

  it('fails closed when raw answer or retained structured claim count exceeds bounds', () => {
    expect(() => parseP0ApiClaims('x'.repeat(128 * 1024 + 1))).toThrow(/128 KiB/u)

    const claims = Array.from({ length: 33 }, (_, index) => (
      `API_CLAIM package=@deepseek-ai/dsh-tools symbol=Symbol${index} assertion=exists`
    )).join('\n')
    expect(() => parseP0ApiClaims(claims)).toThrow(/32/u)
  })
})

describe('M2.3 P0 frozen rc.2 API oracle classification', () => {
  it('classifies authoritative positive declarations from the complete frozen Contract Index', async () => {
    const classified = await classifyP0ApiClaims([
      claim('@deepseek-ai/dsh-tools', 'defineTool', 'exists'),
      claim('@deepseek-ai/dsh-session-query', 'compileSessionTextFilter', 'exists'),
    ])

    expect(classified.map(item => item.classification)).toEqual(['VALID', 'VALID'])
    expect(classified[0]?.evidenceIds.length).toBeGreaterThan(0)
    expect(classified[1]?.evidenceIds.length).toBeGreaterThan(0)
  })

  it('rejects positive hallucinations and later-train symbols without importing latest-upstream knowledge', async () => {
    const classified = await classifyP0ApiClaims([
      claim('@deepseek-ai/dsh-tools', 'ToolAutopilot', 'exists'),
      claim('@deepseek-ai/dsh', 'patchReload', 'exists'),
    ])

    expect(classified[0]?.classification).toBe('INVALID')
    expect(classified[1]?.classification).toBe('INVALID')
  })

  it('validates exact target-wide absence only after checking the complete frozen declaration universe', async () => {
    const classified = await classifyP0ApiClaims([
      claim('*', 'ToolAutopilot', 'absent'),
      claim('*', 'patchReload', 'absent'),
      claim('*', 'defineTool', 'absent'),
    ])

    expect(classified[0]?.classification).toBe('VALID')
    expect(classified[1]?.classification).toBe('VALID')
    expect(classified[2]?.classification).toBe('INVALID')
    expect(classified[2]?.evidenceIds.length).toBeGreaterThan(0)
  })

  it('keeps ambiguous target-wide positive claims UNKNOWN instead of coercing them', async () => {
    const [classified] = await classifyP0ApiClaims([
      claim('*', 'defineTool', 'exists'),
    ])

    expect(classified?.classification).toBe('UNKNOWN')
  })
})

describe('M2.3 P0 frozen task-success adjudication', () => {
  it.each([
    ['p0-01', '@deepseek-ai/dsh-tools', 'defineTool'],
    ['p0-02', '@deepseek-ai/dsh-user-approval', 'ApprovalService'],
    ['p0-03', '@deepseek-ai/dsh-scope', 'createScope'],
    ['p0-04', '@deepseek-ai/dsh-session-query', 'compileSessionTextFilter'],
    ['p0-05', '@deepseek-ai/dsh-subagent', 'assertSubagentMaxDepth'],
    ['p0-06', '@deepseek-ai/dsh-compaction', 'compactCheckpointSource'],
  ] as const)('marks %s successful only with a valid required positive API claim', (taskId, packageName, symbol) => {
    expect(adjudicateP0TaskSuccess(taskId, [
      classified(packageName, symbol, 'exists'),
    ])).toBe('SUCCESS')
  })

  it('accepts every frozen positive alternative explicitly allowed by the public P0 criteria', () => {
    expect(adjudicateP0TaskSuccess('p0-01', [
      classified('@deepseek-ai/dsh-tools', 'DefineToolOptions', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-01', [
      classified('@deepseek-ai/dsh-tools', 'ParameterSchemaSpec', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-02', [
      classified('@deepseek-ai/dsh-user-approval', 'effectiveApprovalPolicy', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-02', [
      classified('@deepseek-ai/dsh-user-approval', 'setApprovalPolicy', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-03', [
      classified('@deepseek-ai/dsh-scope', 'bindScopeParent', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-03', [
      classified('@deepseek-ai/dsh-scope', 'ScopeParentBinding', 'exists'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-06', [
      classified('@deepseek-ai/dsh-compaction', 'CompactionCheckpointSource', 'exists'),
    ])).toBe('SUCCESS')
  })

  it('requires authoritative target-wide absence for the two negative calibration tasks', () => {
    expect(adjudicateP0TaskSuccess('p0-07', [
      classified('*', 'patchReload', 'absent'),
    ])).toBe('SUCCESS')
    expect(adjudicateP0TaskSuccess('p0-08', [
      classified('*', 'ToolAutopilot', 'absent'),
    ])).toBe('SUCCESS')

    expect(adjudicateP0TaskSuccess('p0-07', [
      classified('@deepseek-ai/dsh', 'patchReload', 'exists', 'INVALID'),
    ])).toBe('FAILURE')
    expect(adjudicateP0TaskSuccess('p0-08', [
      classified('@deepseek-ai/dsh-tools', 'ToolAutopilot', 'exists', 'INVALID'),
    ])).toBe('FAILURE')
  })

  it('returns UNKNOWN for missing, unresolved, or contradictory required evidence', () => {
    expect(adjudicateP0TaskSuccess('p0-01', [])).toBe('UNKNOWN')
    expect(adjudicateP0TaskSuccess('p0-04', [
      classified('@deepseek-ai/dsh-session-query', 'compileSessionTextFilter', 'exists', 'UNKNOWN'),
    ])).toBe('UNKNOWN')
    expect(adjudicateP0TaskSuccess('p0-07', [
      classified('*', 'patchReload', 'absent'),
      classified('@deepseek-ai/dsh', 'patchReload', 'exists', 'INVALID'),
    ])).toBe('UNKNOWN')
  })

  it('fails a task when an unrelated concrete API claim is definitively INVALID', () => {
    expect(adjudicateP0TaskSuccess('p0-01', [
      classified('@deepseek-ai/dsh-tools', 'defineTool', 'exists'),
      classified('@deepseek-ai/dsh-tools', 'ToolAutopilot', 'exists', 'INVALID'),
    ])).toBe('FAILURE')
  })

  it('rejects unknown P0 task ids rather than silently inventing an adjudication rule', () => {
    expect(() => adjudicateP0TaskSuccess('p0-99', [])).toThrow(/unknown P0 task/u)
  })

  it('parses, classifies and adjudicates retained model output end-to-end', async () => {
    const result = await adjudicateP0ModelOutcome('p0-04', [
      'API_CLAIM package=@deepseek-ai/dsh-session-query symbol=compileSessionTextFilter assertion=exists',
      'The frozen rc.2 declaration exposes this helper in the generic session-query package.',
    ].join('\n'))

    expect(result.taskSuccess).toBe('SUCCESS')
    expect(result.parsedApiClaims).toHaveLength(1)
    expect(result.parsedApiClaims[0]).toMatchObject({
      package: '@deepseek-ai/dsh-session-query',
      symbol: 'compileSessionTextFilter',
      assertion: 'exists',
      classification: 'VALID',
    })
  })
})
