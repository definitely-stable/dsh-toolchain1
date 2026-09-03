import { describe, expect, it } from 'vitest'

import {
  parseDevelopmentStructuredResult,
  STRUCTURED_RESULT_SCHEMA,
} from '../../scripts/eval/structured-result.mjs'

function validResult() {
  return {
    schema: 'dsh-toolchain-staged-eval-result-v1',
    taskId: 'h1-approval-policy-p01',
    claims: [
      { package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'exists' },
    ],
  }
}

describe('staged evaluation structured-result transport', () => {
  it('accepts only explicit API claims and freezes the normalized value', () => {
    expect(STRUCTURED_RESULT_SCHEMA).toBe('dsh-toolchain-staged-eval-result-v1')

    const result = parseDevelopmentStructuredResult(validResult())

    expect(result).toEqual(validResult())
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.claims)).toBe(true)
    expect(result.claims.every(Object.isFrozen)).toBe(true)
  })

  it('rejects model-supplied apiValid/taskSuccess self-adjudication fields', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      apiValid: true,
    })).toThrow(/unknown key/i)
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      taskSuccess: true,
    })).toThrow(/unknown key/i)
  })

  it('rejects free-text-only output instead of recovering API_CLAIM prose', () => {
    expect(() => parseDevelopmentStructuredResult({
      text: 'API_CLAIM package=@deepseek-ai/dsh-user-approval symbol=ApprovalPolicy assertion=exists',
    })).toThrow(/structured result/i)
  })

  it('rejects unknown top-level and claim keys', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      confidence: 0.9,
    })).toThrow(/unknown key/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{
        package: '@deepseek-ai/dsh-user-approval',
        symbol: 'ApprovalPolicy',
        assertion: 'exists',
        evidence: 'guessed',
      }],
    })).toThrow(/unknown key/i)
  })

  it('rejects the wrong schema and invalid task identity', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      schema: 'legacy-free-text-v1',
    })).toThrow(/schema/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      taskId: '   ',
    })).toThrow(/taskId/i)
  })

  it('requires exactly one well-formed claim', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [],
    })).toThrow(/exactly one claim/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [
        { package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'exists' },
        { package: '@deepseek-ai/dsh-user-approval', symbol: 'Config', assertion: 'exists' },
      ],
    })).toThrow(/exactly one claim/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{ package: '', symbol: 'ApprovalPolicy', assertion: 'exists' }],
    })).toThrow(/claims\[0\]\.package/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{ package: '@deepseek-ai/dsh-user-approval', symbol: 'Approval Policy', assertion: 'exists' }],
    })).toThrow(/claims\[0\]\.symbol/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{ package: '@deepseek-ai/dsh-user-approval', symbol: 'ApprovalPolicy', assertion: 'maybe' }],
    })).toThrow(/claims\[0\]\.assertion/i)
  })
})
