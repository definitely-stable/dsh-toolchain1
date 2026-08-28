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

export interface ProcessProviderMetadata {
  completionId: string
  finishReason: string
  inputTokens?: number
  outputTokens?: number
}

export interface ProcessModelOutcome {
  kind: 'model-outcome'
  finalAnswer: string
  providerMetadata: ProcessProviderMetadata
}

export interface ProcessInfrastructureFailure {
  kind: 'infrastructure-failure'
  reason:
    | 'protocol'
    | 'provider-transport'
    | 'tool-transport'
    | 'timeout'
    | 'exit'
    | 'spawn'
    | 'output-limit'
  detail: string
  partialOutput?: string
  stderr?: string
  providerMetadata?: ProcessProviderMetadata
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

function assertClosedFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains forbidden field: ${key}`)
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendBoundedUtf8(current: string, chunk: string, maxBytes: number): string {
  let remaining = maxBytes - Buffer.byteLength(current, 'utf8')
  if (remaining <= 0) return current

  let prefix = ''
  for (const symbol of chunk) {
    const symbolBytes = Buffer.byteLength(symbol, 'utf8')
    if (symbolBytes > remaining) break
    prefix += symbol
    remaining -= symbolBytes
  }
  return current + prefix
}

function parseProviderMetadata(value: unknown): ProcessProviderMetadata {
  const candidate = {
    outcome: 'model-outcome',
    finalAnswer: '',
    providerMetadata: value,
  }
  validateExecutorModelOutcome(candidate)
  return structuredClone(candidate.providerMetadata as ProcessProviderMetadata)
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
    child.stderr.setEncoding('utf8')

    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let terminal: ProcessModelOutcome | undefined
    let failure: ProcessInfrastructureFailure | undefined
    let providerMetadata: ProcessProviderMetadata | undefined
    let processing = Promise.resolve()

    function failInfrastructure(reason: ProcessInfrastructureFailure['reason'], detail: string): void {
      if (failure !== undefined) return
      failure = {
        kind: 'infrastructure-failure',
        reason,
        detail,
        ...(stdout.length === 0 ? {} : { partialOutput: stdout }),
        ...(stderr.length === 0 ? {} : { stderr }),
        ...(providerMetadata === undefined ? {} : { providerMetadata: structuredClone(providerMetadata) }),
      }
      child.stdin.end()
      if (child.exitCode === null && child.signalCode === null) child.kill()
    }

    child.stdout.on('data', chunk => {
      const text = String(chunk)
      stdoutBytes += Buffer.byteLength(text, 'utf8')
      stdout = appendBoundedUtf8(stdout, text, input.maxStdoutBytes)
      if (stdoutBytes > input.maxStdoutBytes) {
        failInfrastructure(
          'output-limit',
          `Process model executor stdout exceeded ${input.maxStdoutBytes} bytes`,
        )
      }
    })
    child.stderr.on('data', chunk => {
      const text = String(chunk)
      stderrBytes += Buffer.byteLength(text, 'utf8')
      stderr = appendBoundedUtf8(stderr, text, input.maxStderrBytes)
      if (stderrBytes > input.maxStderrBytes) {
        failInfrastructure(
          'output-limit',
          `Process model executor stderr exceeded ${input.maxStderrBytes} bytes`,
        )
      }
    })

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })

    function failProtocol(error: unknown): void {
      failInfrastructure('protocol', errorDetail(error))
    }

    const timeout = setTimeout(() => {
      failInfrastructure('timeout', `Process model executor exceeded timeout of ${input.timeoutMs}ms`)
    }, input.timeoutMs)

    async function handleLine(line: string): Promise<void> {
      if (terminal !== undefined) {
        throw new Error('Process model executor emitted a message after terminal final')
      }

      const message = requireRecord(JSON.parse(line), 'Process model executor message')

      if (message.type === 'provider_metadata') {
        assertClosedFields(
          message,
          new Set(['type', 'providerMetadata']),
          'Process model executor provider_metadata',
        )
        if (providerMetadata !== undefined) {
          throw new Error('Process model executor emitted duplicate provider_metadata')
        }
        providerMetadata = parseProviderMetadata(message.providerMetadata)
        return
      }

      if (message.type === 'tool_call') {
        assertClosedFields(message, new Set(['type', 'id', 'name', 'input']), 'Process model executor tool_call')
        const id = requireString(message.id, 'Process model executor tool call id')
        const name = requireString(message.name, 'Process model executor tool call name')
        if (!input.envelope.tools.some(tool => tool.name === name)) {
          throw new Error(`Process model executor requested unavailable tool: ${name}`)
        }
        let result: unknown
        try {
          result = await input.dispatchToolCall({ id, name, input: message.input })
        } catch (error) {
          failInfrastructure('tool-transport', errorDetail(error))
          return
        }
        child.stdin.write(`${JSON.stringify({ type: 'tool_result', id, result })}\n`)
        return
      }

      if (message.type === 'infrastructure_error') {
        assertClosedFields(
          message,
          new Set(['type', 'reason', 'detail']),
          'Process model executor infrastructure_error',
        )
        if (message.reason !== 'provider-transport') {
          throw new Error(`Unsupported child infrastructure reason: ${String(message.reason)}`)
        }
        failInfrastructure(
          'provider-transport',
          requireString(message.detail, 'Process model executor infrastructure error detail'),
        )
        return
      }

      if (message.type !== 'final') {
        throw new Error(`Unsupported process model executor message: ${String(message.type)}`)
      }
      assertClosedFields(
        message,
        new Set(['type', 'finalAnswer', 'providerMetadata']),
        'Process model executor final',
      )

      if (providerMetadata !== undefined && message.providerMetadata !== undefined) {
        throw new Error('Process model executor final duplicates previously emitted provider_metadata')
      }
      const finalProviderMetadata = message.providerMetadata === undefined
        ? providerMetadata
        : parseProviderMetadata(message.providerMetadata)
      const outcome = {
        outcome: 'model-outcome',
        finalAnswer: message.finalAnswer,
        providerMetadata: finalProviderMetadata,
      }
      validateExecutorModelOutcome(outcome)
      terminal = {
        kind: 'model-outcome',
        finalAnswer: outcome.finalAnswer as string,
        providerMetadata: structuredClone(outcome.providerMetadata as ProcessProviderMetadata),
      }
      child.stdin.end()
    }

    lines.on('line', line => {
      if (line.length === 0 || failure !== undefined) return
      processing = processing.then(() => handleLine(line)).catch(failProtocol)
    })

    child.once('error', error => {
      failInfrastructure('spawn', errorDetail(error))
    })
    child.once('close', code => {
      clearTimeout(timeout)
      void processing.then(() => {
        if (failure !== undefined) {
          resolve(failure)
          return
        }
        if (code !== 0) {
          failInfrastructure('exit', `Process model executor exited with code ${String(code)}`)
          resolve(failure!)
          return
        }
        if (terminal === undefined) {
          failInfrastructure('protocol', 'Process model executor exited without a terminal final message')
          resolve(failure!)
          return
        }
        resolve(terminal)
      }).catch(reject)
    })

    child.stdin.write(`${JSON.stringify({ type: 'start', envelope: input.envelope })}\n`)
  })
}
