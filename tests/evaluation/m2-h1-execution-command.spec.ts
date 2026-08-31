import { describe, expect, it } from 'vitest'

import {
  assertPublishedH1ExecutionBinding,
  parseArguments,
} from '../../scripts/run-m2-h1-opencode-go.mjs'

describe('M2 H1 execution operator command', () => {
  it('defaults to preflight-only and requires source-bound publication plus an explicit bounded execution budget before model calls', () => {
    expect(parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--source-bound-preregistration', '/public/h1-source-bound.json',
    ])).toEqual({
      dataset: '/private/h1.json',
      runStore: '/private/h1-run',
      sourceBoundPreregistration: '/public/h1-source-bound.json',
      execute: false,
      maxCommittedAttempts: undefined,
    })

    expect(parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--source-bound-preregistration', '/public/h1-source-bound.json',
      '--execute',
      '--max-committed-attempts', '24',
    ])).toEqual({
      dataset: '/private/h1.json',
      runStore: '/private/h1-run',
      sourceBoundPreregistration: '/public/h1-source-bound.json',
      execute: true,
      maxCommittedAttempts: 24,
    })

    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
    ])).toThrow(/source-bound-preregistration/u)
    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--source-bound-preregistration', '/public/h1-source-bound.json',
      '--execute',
    ])).toThrow(/max-committed-attempts/u)
    expect(() => parseArguments([
      '--dataset', '/private/h1.json',
      '--run-store', '/private/h1-run',
      '--source-bound-preregistration', '/public/h1-source-bound.json',
      '--execute',
      '--max-committed-attempts', '49',
    ])).toThrow(/1\.\.48/u)
  })

  it('accepts only the exact published preregistration/frozen execution binding', () => {
    const frozen = {
      definitionSha256: 'c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717',
      ledgerBinding: {
        definitionSha256: 'c07c9d91eee82101872cd106e8170ecebcbba4368039255118673382a956d717',
        datasetCommitmentSha256: 'f81f97cfe3b7ccf615f6246ed6b355f730009c6fb66dc8cd170a90c9c9753095',
        providerIdentityReceiptSha256: 'ba594a928f7fde32b4ca2724dc57d1fef0a267f061ecdcfc5f87e909be5cb5b8',
        expectedResponseModel: 'deepseek-v4-flash',
      },
      schedule: Array.from({ length: 864 }, (_, index) => ({ taskId: `task-${index}` })),
      resourcePolicy: { concurrency: 1 },
      modelTasks: Array.from({ length: 96 }, (_, index) => ({ id: `task-${index}` })),
    }
    const published = {
      status: 'PREREGISTERED',
      receiptSha256: 'dc12ccf907f507b5f6da08c790a1a84563160e984879724e5c18283e0404219b',
      hiddenDataset: {
        sha256: frozen.ledgerBinding.datasetCommitmentSha256,
        taskCount: 96,
      },
      provider: {
        provider: 'opencode-go',
        requestModel: 'deepseek-v4-flash',
        responseModel: 'deepseek-v4-flash',
        identityMode: 'managed-gateway',
        identityReceiptSha256: frozen.ledgerBinding.providerIdentityReceiptSha256,
      },
      execution: {
        definitionSha256: frozen.definitionSha256,
        scheduleCount: 864,
        concurrency: 1,
        ledgerBinding: frozen.ledgerBinding,
      },
    }

    expect(() => assertPublishedH1ExecutionBinding(published, frozen)).not.toThrow()
    expect(() => assertPublishedH1ExecutionBinding({
      ...published,
      execution: { ...published.execution, scheduleCount: 863 },
    }, frozen)).toThrow(/schedule/u)
    expect(() => assertPublishedH1ExecutionBinding({
      ...published,
      provider: { ...published.provider, responseModel: 'other-model' },
    }, frozen)).toThrow(/provider/u)
  })
})
