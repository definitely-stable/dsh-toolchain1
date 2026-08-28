import {
  validateAgentAttempts,
  type AgentRetryPolicy,
} from './m2-agent-eval-integrity.js'
import type {
  AgentArm,
  IsolationReceipt,
  TraceReceipt,
} from './m2-agent-execution-evidence.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface RunnerAttemptEvidence {
  readonly taskId: string
  readonly arm: AgentArm
  readonly trial: 1 | 2 | 3
  readonly attempt: number
  readonly kind: 'infrastructure-failure' | 'model-outcome'
  readonly reason?: string
  readonly qualityIndependent: boolean
  readonly modelEnvelopeSha256: string
  readonly trace: TraceReceipt
  readonly isolation: IsolationReceipt
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`)
}

function runIdentity(attempt: RunnerAttemptEvidence): string {
  return `${attempt.taskId}\u0000${attempt.arm}\u0000${attempt.trial}`
}

export function validateRunnerAttemptSequence(
  attempts: readonly RunnerAttemptEvidence[],
  policy: AgentRetryPolicy,
): void {
  if (attempts.length === 0) throw new Error('Runner attempt sequence must not be empty')

  const first = attempts[0]!
  const expectedRunIdentity = runIdentity(first)
  const expectedEnvelope = first.modelEnvelopeSha256
  assertSha256(expectedEnvelope, 'Runner modelEnvelopeSha256')

  const sessionIds = new Set<string>()
  const environmentIds = new Set<string>()

  for (const attempt of attempts) {
    if (runIdentity(attempt) !== expectedRunIdentity) {
      throw new Error('Runner retry sequence must stay within one task/arm/trial run')
    }
    if (attempt.modelEnvelopeSha256 !== expectedEnvelope) {
      throw new Error('Runner retry must preserve the exact model envelope')
    }
    if (attempt.trace.runControlSha256 !== attempt.isolation.runControlSha256) {
      throw new Error('Runner trace and isolation receipt must bind the same RunControl')
    }

    if (sessionIds.has(attempt.isolation.sessionIdSha256)) {
      throw new Error('Runner retry must use a fresh model session; session reuse is forbidden')
    }
    sessionIds.add(attempt.isolation.sessionIdSha256)

    if (environmentIds.has(attempt.isolation.mutableEnvironmentIdSha256)) {
      throw new Error('Runner retry must use a fresh/reset mutable environment; environment reuse is forbidden')
    }
    environmentIds.add(attempt.isolation.mutableEnvironmentIdSha256)

    if (attempt.kind === 'infrastructure-failure' && attempt.qualityIndependent !== true) {
      throw new Error('Infrastructure retry classification must be independent of model answer quality')
    }
  }

  validateAgentAttempts(
    attempts.map(attempt => ({
      taskId: attempt.taskId,
      arm: attempt.arm,
      trial: attempt.trial,
      attempt: attempt.attempt,
      kind: attempt.kind,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
    })),
    policy,
  )
}
