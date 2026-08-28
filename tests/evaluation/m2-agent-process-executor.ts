import type { ModelEnvelope } from './m2-agent-execution-evidence.js'

export interface ProcessToolCallRequest {
  id: string
  name: string
  input: unknown
}

export interface ProcessModelAttemptInput {
  command: string
  args: readonly string[]
  cwd: string
  environment: Readonly<Record<string, string>>
  envelope: ModelEnvelope
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
  dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown>
}

export interface ProcessModelOutcome {
  kind: 'model-outcome'
  finalAnswer: string
  providerMetadata: {
    completionId: string
    finishReason: string
    inputTokens?: number
    outputTokens?: number
  }
}

export async function executeProcessModelAttempt(
  _input: ProcessModelAttemptInput,
): Promise<ProcessModelOutcome> {
  throw new Error('process model executor not implemented')
}
