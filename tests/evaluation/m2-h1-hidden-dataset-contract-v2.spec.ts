import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { commitHiddenH1DatasetV2 } from './m2-h1-readiness-v2.js'

const sha256 = createNodeSha256Port()

const target = Object.freeze({
  package: '@deepseek-ai/dsh',
  version: '0.1.1-rc.2',
  profile: 'web',
  targetFingerprint: 'dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe',
  contractIndexFingerprint: 'dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2',
})

function dataset() {
  return {
    schema: 'dsh-toolchain-m2-agent-dataset-v2',
    datasetId: 'H1',
    target,
    taskCount: 2,
    tasks: [
      {
        id: 'h1-tools-01',
        domain: 'tools',
        prompt: 'Identify the exact public API for the tools task.',
        successRule: {
          kind: 'api-exists-any',
          package: '@deepseek-ai/dsh-tools',
          symbols: ['defineTool', 'ToolDefinition.create'],
        },
      },
      {
        id: 'h1-session-01',
        domain: 'session',
        prompt: 'Determine whether the requested session API exists.',
        successRule: {
          kind: 'api-absent',
          symbols: ['Session.unknownFeature'],
          proofScope: { kind: 'package', package: '@deepseek-ai/dsh-session' },
        },
      },
    ],
  }
}

describe('M2.3 strict private H1 dataset contract v2', () => {
  it('commits normalized evaluator rules while exposing only id and prompt', async () => {
    const original = dataset()
    const reorderedSymbols = dataset()
    reorderedSymbols.tasks[0]!.successRule.symbols = [
      'ToolDefinition.create',
      'defineTool',
    ]

    const [first, second] = await Promise.all([
      commitHiddenH1DatasetV2(original, sha256),
      commitHiddenH1DatasetV2(reorderedSymbols, sha256),
    ])

    expect(first.sha256).toBe(second.sha256)
    expect(first.modelTasks).toEqual([
      { id: 'h1-tools-01', prompt: 'Identify the exact public API for the tools task.' },
      { id: 'h1-session-01', prompt: 'Determine whether the requested session API exists.' },
    ])
    expect(JSON.stringify(first.modelTasks)).not.toContain('domain')
    expect(JSON.stringify(first.modelTasks)).not.toContain('successRule')
  })

  it('makes semantic rule changes and task order commitment-significant', async () => {
    const original = dataset()
    const changedRule = dataset()
    changedRule.tasks[0]!.successRule.symbols = ['differentApi']
    const reversed = dataset()
    reversed.tasks = reversed.tasks.toReversed()

    const first = await commitHiddenH1DatasetV2(original, sha256)
    expect((await commitHiddenH1DatasetV2(changedRule, sha256)).sha256).not.toBe(first.sha256)
    expect((await commitHiddenH1DatasetV2(reversed, sha256)).sha256).not.toBe(first.sha256)
  })

  it('requires a valid frozen declarative successRule on every task', async () => {
    const missing = {
      ...dataset(),
      tasks: dataset().tasks.map((task, index) => index === 0
        ? { id: task.id, domain: task.domain, prompt: task.prompt }
        : task),
    }
    await expect(commitHiddenH1DatasetV2(missing, sha256)).rejects.toThrow(/successRule|success rule|unknown/u)

    const invalid = dataset()
    invalid.tasks[0]!.successRule = {
      kind: 'llm-judge',
      package: '@deepseek-ai/dsh-tools',
      symbols: ['defineTool'],
    } as never
    await expect(commitHiddenH1DatasetV2(invalid, sha256)).rejects.toThrow(/success.*rule|kind/u)
  })

  it('rejects obsolete evaluator metadata, unknown top-level fields and malformed domains', async () => {
    const obsolete = {
      ...dataset(),
      tasks: dataset().tasks.map((task, index) => index === 0
        ? { ...task, oracleHints: { symbols: ['defineTool'] } }
        : task),
    }
    await expect(commitHiddenH1DatasetV2(obsolete, sha256)).rejects.toThrow(/oracleHints|unknown/u)

    const unknownTopLevel = { ...dataset(), notes: 'not part of the frozen schema' }
    await expect(commitHiddenH1DatasetV2(unknownTopLevel, sha256)).rejects.toThrow(/notes|unknown/u)

    const badDomain = dataset()
    badDomain.tasks[0]!.domain = 'Tools / hidden'
    await expect(commitHiddenH1DatasetV2(badDomain, sha256)).rejects.toThrow(/domain/u)
  })
})
