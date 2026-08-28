import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

import {
  validateExecutorModelOutcome,
  type ModelEnvelope,
} from './m2-agent-execution-evidence.js'

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

export interface ProcessInfrastructureFailure {
  kind: 'infrastructure-failure'
  reason: 'protocol'
  detail: string
  partialOutput?: string
}

export type ProcessModelAttemptResult = ProcessModelOutcome | ProcessInfrastructureFailure

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function executeProcessModelAttempt(
  input: ProcessModelAttemptInput,
): Promise<ProcessModelAttemptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...input.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let stdout = ''
    let stderr = ''
    let terminal: ProcessModelOutcome | undefined
    let failure: ProcessInfrastructureFailure | undefined
    let processing = Promise.resolve()

    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr += chunk
    })

    function failProtocol(error: unknown): void {
      if (failure !== undefined) return
      failure = {
        kind: 'infrastructure-failure',
        reason: 'protocol',
        detail: errorDetail(error),
        ...(stdout.length === 0 ? {} : { partialOutput: stdout }),
      }
      child.stdin.end()
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }

    async function handleLine(line: string): Promise<void> {
      if (terminal !== undefined) {
        throw new Error('Process model executor emitted a message after terminal final')
      }

      const message = requireRecord(JSON.parse(line), 'Process model executor message')
      if (message.type === 'tool_call') {
        const id = requireString(message.id, 'Process model executor tool call id')
        const name = requireString(message.name, 'Process model executor tool call name')
        if (!input.envelope.tools.some(tool => tool.name === name)) {
          throw new Error(`Process model executor requested unavailable tool: ${name}`)
        }
        const result = await input.dispatchToolCall({ id, name, input: message.input })
        child.stdin.write(`${JSON.stringify({ type: 'tool_result', id, result })}\n`)
        return
      }

      if (message.type !== 'final') {
        throw new Error(`Unsupported process model executor message: ${String(message.type)}`)
      }

      const outcome = {
        outcome: 'model-outcome',
        finalAnswer: message.finalAnswer,
        providerMetadata: message.providerMetadata,
      }
      validateExecutorModelOutcome(outcome)
      terminal = {
        kind: 'model-outcome',
        finalAnswer: outcome.finalAnswer as string,
        providerMetadata: outcome.providerMetadata as ProcessModelOutcome['providerMetadata'],
      }
      child.stdin.end()
    }

    lines.on('line', line => {
      if (line.length === 0 || failure !== undefined) return
      processing = processing.then(() => handleLine(line)).catch(failProtocol)
    })

    child.once('error', reject)
    child.once('close', code => {
      void processing.then(() => {
        if (failure !== undefined) {
          resolve(failure)
          return
        }
        if (code !== 0) {
          reject(new Error(`Process model executor exited with code ${String(code)}: ${stderr.trim()}`))
          return
        }
        if (terminal === undefined) {
          reject(new Error('Process model executor exited without a terminal final message'))
          return
        }
        resolve(terminal)
      }).catch(reject)
    })

    child.stdin.write(`${JSON.stringify({ type: 'start', envelope: input.envelope })}\n`)
  })
}
