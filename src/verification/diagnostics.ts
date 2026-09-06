import type { Diagnostic } from '../protocol/index.js'
import type { VerificationProcessOutcome } from './process.js'

export type VerificationDiagnosticCode =
  | 'VERIFY_ARTIFACT_READ_FAILED'
  | 'VERIFY_ARTIFACT_LIMIT_EXCEEDED'
  | 'VERIFY_ARTIFACT_STALE'
  | 'VERIFY_PROCESS_START_FAILED'
  | 'VERIFY_PROCESS_EXIT_FAILED'
  | 'VERIFY_PROCESS_TIMEOUT'
  | 'VERIFY_PROCESS_CANCELLED'
  | 'VERIFY_PROCESS_OUTPUT_LIMIT_EXCEEDED'
  | 'VERIFY_WORKER_FAILED'
  | 'VERIFY_INSTALL_FAILED'
  | 'VERIFY_COMPOSE_FAILED'
  | 'VERIFY_BOOT_FAILED'
  | 'VERIFY_VISIBILITY_FAILED'
  | 'VERIFY_CLEANUP_FAILED'

export function verificationDiagnostic(
  code: VerificationDiagnosticCode,
  summary: string,
): Diagnostic {
  return Object.freeze({
    code,
    severity: 'error' as const,
    domain: 'verification',
    summary,
  })
}

export interface ClassifiedProcessFailure {
  readonly diagnostic: Diagnostic
  readonly terminal: 'failed' | 'cancelled'
}

export function classifyVerificationProcessFailure(
  outcome: VerificationProcessOutcome,
  stageFailureCode: 'VERIFY_INSTALL_FAILED' | 'VERIFY_COMPOSE_FAILED' | 'VERIFY_BOOT_FAILED' | 'VERIFY_VISIBILITY_FAILED',
): ClassifiedProcessFailure | undefined {
  if (outcome.kind === 'exited' && outcome.code === 0) return undefined

  if (outcome.kind === 'exited') {
    return Object.freeze({
      diagnostic: verificationDiagnostic(stageFailureCode, 'Verification stage process exited unsuccessfully.'),
      terminal: 'failed' as const,
    })
  }
  if (outcome.kind === 'signalled') {
    return Object.freeze({
      diagnostic: verificationDiagnostic('VERIFY_PROCESS_EXIT_FAILED', 'Verification stage process terminated by signal.'),
      terminal: 'failed' as const,
    })
  }
  if (outcome.kind === 'timeout') {
    return Object.freeze({
      diagnostic: verificationDiagnostic('VERIFY_PROCESS_TIMEOUT', 'Verification stage process exceeded its time limit.'),
      terminal: 'failed' as const,
    })
  }
  if (outcome.kind === 'cancelled') {
    return Object.freeze({
      diagnostic: verificationDiagnostic('VERIFY_PROCESS_CANCELLED', 'Verification stage process was cancelled.'),
      terminal: 'cancelled' as const,
    })
  }
  if (outcome.kind === 'output-limit') {
    return Object.freeze({
      diagnostic: verificationDiagnostic(
        'VERIFY_PROCESS_OUTPUT_LIMIT_EXCEEDED',
        `Verification stage ${outcome.stream} exceeded its bounded output limit.`,
      ),
      terminal: 'failed' as const,
    })
  }
  return Object.freeze({
    diagnostic: verificationDiagnostic('VERIFY_PROCESS_START_FAILED', 'Verification stage process could not be started.'),
    terminal: 'failed' as const,
  })
}

export function classifyVerificationWorkerFailure(): ClassifiedProcessFailure {
  return Object.freeze({
    diagnostic: verificationDiagnostic(
      'VERIFY_WORKER_FAILED',
      'Verification worker encountered an unexpected infrastructure failure.',
    ),
    terminal: 'failed' as const,
  })
}
