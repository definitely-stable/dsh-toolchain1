import { describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import type { AgentRetryPolicy } from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  createTraceReceipt,
  validateRunnerAttemptSequence,
  type IsolationReceipt,
  type RunnerAttemptEvidence,
} from './m2-agent-execution-evidence.js'

const POLICY: AgentRetryPolicy = {
  maxInfrastructureRetries: 2,
  modelOutcomeRetries: 0,
  retryableReasons: ['provider-transport', 'tool-transport', 'runner-infrastructure'],
}

function isolation(runControlSha256: string, session: string, environment: string): IsolationReceipt {
  return {
    schema: 'dsh-toolchain-m2-isolation-v1',
    runControlSha256,
    sessionIdSha256: session.repeat(64),
    freshModelSession: true,
    memoryCarryover: false,
    workspaceMode: 'read-only-reset',
    workspaceSnapshotSha256: 'c'.repeat(64),
    toolStateReset: true,
    ordinaryEvidenceSha256: 'd'.repeat(64),
    mutableEnvironmentIdSha256: environment.repeat(64),
    parallelMutableStateShared: false,
    retrySessionPolicy: 'fresh-session-per-attempt',
  }
}

async function partialFailureAttempt(): Promise<RunnerAttemptEvidence> {
  const sha256 = createNodeSha256Port()
  const control = 'a'.repeat(64)
  const request = await createInlineContentRef('{"path":"package.json"}', 'application/json', 'utf8-bytes-v1', sha256)
  const response = await createInlineContentRef('{"name":"dsh-toolchain"}', 'application/json', 'utf8-bytes-v1', sha256)
  const trace = await createTraceReceipt(control, [{
    sequence: 1,
    family: 'ordinary',
    name: 'read_file',
    startedAt: '2026-08-28T08:00:00.000Z',
    completedAt: '2026-08-28T08:00:01.000Z',
    status: 'ok',
    request,
    response,
  }], sha256)

  return {
    taskId: 'p0-01',
    arm: 'B',
    trial: 1,
    attempt: 1,
    kind: 'infrastructure-failure',
    reason: 'provider-transport',
    qualityIndependent: true,
    modelEnvelopeSha256: 'f'.repeat(64),
    trace,
    isolation: isolation(control, '1', '2'),
  }
}

async function terminalAttempt(): Promise<RunnerAttemptEvidence> {
  const sha256 = createNodeSha256Port()
  const control = 'b'.repeat(64)
  return {
    taskId: 'p0-01',
    arm: 'B',
    trial: 1,
    attempt: 2,
    kind: 'model-outcome',
    qualityIndependent: true,
    modelEnvelopeSha256: 'f'.repeat(64),
    trace: await createTraceReceipt(control, [], sha256),
    isolation: isolation(control, '3', '4'),
  }
}

describe('M2.3 runner retry evidence', () => {
  it('retains partial tool activity and requires a fresh isolated session for the retry', async () => {
    const first = await partialFailureAttempt()
    const second = await terminalAttempt()

    expect(first.trace.entries).toHaveLength(1)
    expect(first.trace.entries[0]?.name).toBe('read_file')
    expect(first.isolation.sessionIdSha256).not.toBe(second.isolation.sessionIdSha256)
    expect(first.isolation.mutableEnvironmentIdSha256).not.toBe(second.isolation.mutableEnvironmentIdSha256)
    expect(first.modelEnvelopeSha256).toBe(second.modelEnvelopeSha256)
    expect(() => validateRunnerAttemptSequence([first, second], POLICY)).not.toThrow()
    expect(first.trace.entries).toHaveLength(1)
  })

  it('rejects infrastructure retry classification that is not independent of answer quality', async () => {
    const first = await partialFailureAttempt()
    const second = await terminalAttempt()

    expect(() => validateRunnerAttemptSequence([
      { ...first, qualityIndependent: false },
      second,
    ], POLICY)).toThrow(/quality|independent|retry/i)
  })

  it('rejects a retry that reuses model session, mutable environment or changes the model envelope', async () => {
    const first = await partialFailureAttempt()
    const second = await terminalAttempt()

    expect(() => validateRunnerAttemptSequence([
      first,
      { ...second, isolation: { ...second.isolation, sessionIdSha256: first.isolation.sessionIdSha256 } },
    ], POLICY)).toThrow(/fresh|session|reuse/i)

    expect(() => validateRunnerAttemptSequence([
      first,
      { ...second, isolation: { ...second.isolation, mutableEnvironmentIdSha256: first.isolation.mutableEnvironmentIdSha256 } },
    ], POLICY)).toThrow(/environment|reuse|isolation/i)

    expect(() => validateRunnerAttemptSequence([
      first,
      { ...second, modelEnvelopeSha256: 'e'.repeat(64) },
    ], POLICY)).toThrow(/envelope/i)
  })

  it('reuses the existing terminal-model-outcome and 1+N retry budget semantics', async () => {
    const first = await partialFailureAttempt()
    const second = await terminalAttempt()

    expect(() => validateRunnerAttemptSequence([
      first,
      second,
      { ...second, attempt: 3 },
    ], POLICY)).toThrow(/model outcome|retried|terminal/i)

    const infra2 = {
      ...first,
      attempt: 2,
      trace: second.trace,
      isolation: second.isolation,
    } satisfies RunnerAttemptEvidence
    const infra3 = {
      ...first,
      attempt: 3,
      trace: await createTraceReceipt('9'.repeat(64), [], createNodeSha256Port()),
      isolation: isolation('9'.repeat(64), '5', '6'),
    } satisfies RunnerAttemptEvidence
    const infra4 = {
      ...first,
      attempt: 4,
      trace: await createTraceReceipt('8'.repeat(64), [], createNodeSha256Port()),
      isolation: isolation('8'.repeat(64), '7', '8'),
    } satisfies RunnerAttemptEvidence

    expect(() => validateRunnerAttemptSequence([first, infra2, infra3], POLICY)).not.toThrow()
    expect(() => validateRunnerAttemptSequence([first, infra2, infra3, infra4], POLICY)).toThrow(/retry budget/i)
  })
})
