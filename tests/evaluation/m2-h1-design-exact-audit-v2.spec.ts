import { readFile } from 'node:fs/promises'

import { beforeAll, describe, expect, it } from 'vitest'

import { auditH1ProspectiveDesignExactV2 } from './m2-h1-design-exact-audit-v2.js'
import {
  validateH1ProspectiveDesignV2,
  type H1ProspectiveDesignV2,
} from './m2-h1-design-sensitivity-v2.js'

const designUrl = new URL('../../docs/evaluation/m2/h1-prospective-design-v2.json', import.meta.url)
const auditUrl = new URL('./m2-h1-design-exact-audit-v2.ts', import.meta.url)

let frozenDesign: H1ProspectiveDesignV2

beforeAll(async () => {
  frozenDesign = validateH1ProspectiveDesignV2(JSON.parse(await readFile(designUrl, 'utf8')))
})

describe('M2.3 exact-discrete planning audit v2', () => {
  it('requires exact convolution to select the same task count as the frozen normal planning approximation', () => {
    const audit = auditH1ProspectiveDesignExactV2(frozenDesign)

    expect(audit.selectionAgrees).toBe(true)
    expect(audit.exactSelectedTaskCount).toBe(audit.approximateSelectedTaskCount)
  })

  it('computes bounded exact probabilities for every frozen candidate, scenario and endpoint', () => {
    const audit = auditH1ProspectiveDesignExactV2(frozenDesign)

    expect(audit.candidates.map(candidate => candidate.taskCount)).toEqual(frozenDesign.candidateTaskCounts)
    for (const candidate of audit.candidates) {
      for (const scenario of candidate.scenarios) {
        expect(scenario.primary.passProbability).toBeGreaterThanOrEqual(0)
        expect(scenario.primary.passProbability).toBeLessThanOrEqual(1)
        expect(scenario.guardrail.passProbability).toBeGreaterThanOrEqual(0)
        expect(scenario.guardrail.passProbability).toBeLessThanOrEqual(1)
      }
    }
    expect(Number.isFinite(audit.maxAbsolutePassProbabilityDelta)).toBe(true)
    expect(audit.maxAbsolutePassProbabilityDelta).toBeGreaterThanOrEqual(0)
  })

  it('keeps the exact audit deterministic and isolated from P0/provider/H1-result data', async () => {
    const first = auditH1ProspectiveDesignExactV2(frozenDesign)
    const second = auditH1ProspectiveDesignExactV2(structuredClone(frozenDesign))
    expect(second).toEqual(first)

    const source = await readFile(auditUrl, 'utf8')
    const forbidden = [
      'p0-live',
      'p0-readjudication',
      'agent-pilot-p0',
      'm2-agent-p0-',
      'providerProbe',
      'Math.random',
      "from 'node:fs",
      "from 'node:http",
      "from 'node:https",
      'fetch(',
    ]
    for (const marker of forbidden) expect(source).not.toContain(marker)
  })
})
