import { describe, expect, it } from 'vitest'

import type { ApiTruthUniverseV2 } from './m2-api-truth-v2.js'
import { adjudicateP0ModelOutcomeV2 } from './m2-agent-p0-adjudication-v2.js'

function truthWithScopedCompleteness(options: {
  readonly toolsComplete: boolean
  readonly unrelatedComplete: boolean
}): ApiTruthUniverseV2 {
  const packageTruth = (name: string, complete: boolean) => Object.freeze({
    name,
    version: '1.0.0',
    entrypoints: complete
      ? Object.freeze([`/exact-target/node_modules/${name}/index.d.ts`])
      : Object.freeze([]),
    visitedDeclarations: complete
      ? Object.freeze([`/exact-target/node_modules/${name}/index.d.ts`])
      : Object.freeze([]),
    unresolvedPublicEdges: complete
      ? Object.freeze([])
      : Object.freeze([`${name} public declaration closure unavailable`]),
    complete,
  })

  return Object.freeze({
    schema: 'dsh-api-truth-v2',
    targetFingerprint: `dsh-target-v2:${'1'.repeat(64)}`,
    workspaceSnapshotSha256: '2'.repeat(64),
    packages: Object.freeze([
      packageTruth('@deepseek-ai/dsh-tools', options.toolsComplete),
      packageTruth('@deepseek-ai/unrelated', options.unrelatedComplete),
    ]),
    entries: Object.freeze([]),
    fingerprint: `dsh-api-truth-v2:${'3'.repeat(64)}`,
  })
}

describe('M2.3 P0 adjudication v2 scoped negative proof', () => {
  it('proves the package-scoped ToolAutopilot task without relabeling a target-wide claim', () => {
    const universe = truthWithScopedCompleteness({ toolsComplete: true, unrelatedComplete: false })
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-08',
      'API_CLAIM package=* symbol=ToolAutopilot assertion=absent',
      universe,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
    })
    expect(outcome.taskSuccess).toBe('SUCCESS')
  })

  it('keeps the target-scoped patchReload task UNKNOWN while any target package surface is incomplete', () => {
    const universe = truthWithScopedCompleteness({ toolsComplete: true, unrelatedComplete: false })
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-07',
      'API_CLAIM package=* symbol=profile.patchReload assertion=absent',
      universe,
    )

    expect(outcome.parsedApiClaims[0]).toMatchObject({
      classification: 'UNKNOWN',
      resolution: 'incomplete-universe',
    })
    expect(outcome.taskSuccess).toBe('UNKNOWN')
  })

  it('fails closed when the task package itself is incomplete', () => {
    const universe = truthWithScopedCompleteness({ toolsComplete: false, unrelatedComplete: true })
    const outcome = adjudicateP0ModelOutcomeV2(
      'p0-08',
      'API_CLAIM package=* symbol=ToolAutopilot assertion=absent',
      universe,
    )

    expect(outcome.parsedApiClaims[0]?.classification).toBe('UNKNOWN')
    expect(outcome.taskSuccess).toBe('UNKNOWN')
  })
})
