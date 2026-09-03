import { describe, expect, it } from 'vitest'

import {
  parseDevelopmentStructuredResult,
  STRUCTURED_RESULT_SCHEMA,
} from '../../scripts/eval/structured-result.mjs'

function validResult() {
  return {
    schema: 'dsh-toolchain-staged-eval-result-v1',
    taskId: 'tool-basic-001',
    apiValid: true,
    taskSuccess: true,
    claims: [
      { kind: 'tool', name: 'tools.register' },
      { kind: 'service', name: 'toolchain' },
    ],
  }
}

describe('staged evaluation structured-result transport', () => {
  it('accepts one closed explicit measurement result and freezes the normalized value', () => {
    expect(STRUCTURED_RESULT_SCHEMA).toBe('dsh-toolchain-staged-eval-result-v1')

    const result = parseDevelopmentStructuredResult(validResult())

    expect(result).toEqual(validResult())
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.claims)).toBe(true)
    expect(result.claims.every(Object.isFrozen)).toBe(true)
  })

  it('rejects free-text-only output instead of recovering API_CLAIM prose', () => {
    expect(() => parseDevelopmentStructuredResult({
      text: 'API_CLAIM tools.register exists and the task succeeded',
    })).toThrow(/structured result/i)
  })

  it('rejects unknown top-level and claim keys', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      confidence: 0.9,
    })).toThrow(/unknown key/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{ kind: 'tool', name: 'tools.register', evidence: 'guessed' }],
    })).toThrow(/unknown key/i)
  })

  it('rejects the wrong schema, invalid task identity, and non-boolean decisions', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      schema: 'legacy-free-text-v1',
    })).toThrow(/schema/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      taskId: '   ',
    })).toThrow(/taskId/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      apiValid: 'yes',
    })).toThrow(/apiValid/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      taskSuccess: 1,
    })).toThrow(/taskSuccess/i)
  })

  it('rejects malformed claims and duplicate claim identities', () => {
    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: 'tools.register',
    })).toThrow(/claims/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [{ kind: '', name: 'tools.register' }],
    })).toThrow(/claims\[0\]\.kind/i)

    expect(() => parseDevelopmentStructuredResult({
      ...validResult(),
      claims: [
        { kind: 'tool', name: 'tools.register' },
        { kind: 'tool', name: 'tools.register' },
      ],
    })).toThrow(/duplicate claim/i)
  })
})
