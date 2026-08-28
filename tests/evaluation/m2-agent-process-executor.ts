import { spawn } from 'node:child_process'

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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export async function executeProcessModelAttempt(
  input: ProcessModelAttemptInput,
): Promise<ProcessModelOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...input.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0) {
        reject(new Error(`Process model executor exited with code ${String(code)}: ${stderr.trim()}`))
        return
      }

      const lines = stdout.split(/\r?\n/u).filter(line => line.length > 0)
      if (lines.length !== 1) {
        reject(new Error(`Process model executor must emit exactly one terminal message; received ${lines.length}`))
        return
      }

      try {
        const message = requireRecord(JSON.parse(lines[0]!), 'Process model executor message')
        if (message.type !== 'final') throw new Error('Process model executor must terminate with final')
        const outcome = {
          outcome: 'model-outcome',
          finalAnswer: message.finalAnswer,
          providerMetadata: message.providerMetadata,
        }
        validateExecutorModelOutcome(outcome)
        resolve({
          kind: 'model-outcome',
          finalAnswer: outcome.finalAnswer as string,
          providerMetadata: outcome.providerMetadata as ProcessModelOutcome['providerMetadata'],
        })
      } catch (error) {
        reject(error)
      }
    })

    child.stdin.end(`${JSON.stringify({ type: 'start', envelope: input.envelope })}\n`)
  })
}
