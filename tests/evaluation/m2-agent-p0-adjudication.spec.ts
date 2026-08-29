import { describe, expect, it } from 'vitest'

import {
  classifyP0ApiClaims,
  parseP0ApiClaims,
  type ParsedP0ApiClaim,
} from './m2-agent-p0-adjudication.js'

function claim(
  packageName: string,
  symbol: string,
  assertion: 'exists' | 'absent',
): ParsedP0ApiClaim {
  return { package: packageName, symbol, assertion }
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
