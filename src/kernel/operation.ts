import type {
  Diagnostic,
  Operation,
  PluginVerifyRequest,
  PluginVerifyResponse,
} from '../protocol/index.js'

const DEFAULT_MAX_ACTIVE = 4
const DEFAULT_MAX_RETAINED_COMPLETED = 32
const MAX_OPERATION_ID_LENGTH = 128

export type VerificationOperationErrorCode =
  | 'OPERATION_NOT_FOUND'
  | 'OPERATION_CAPACITY_EXCEEDED'
  | 'OPERATION_EXECUTION_FAILED'

export class VerificationOperationError extends Error {
  readonly code: VerificationOperationErrorCode

  constructor(code: VerificationOperationErrorCode, message: string) {
    super(`${code}: ${message}`)
    this.name = 'VerificationOperationError'
    this.code = code
  }
}

export interface VerificationOperationManagerOptions {
  readonly execute: (
    request: PluginVerifyRequest,
    requestId: string,
    signal: AbortSignal,
  ) => Promise<PluginVerifyResponse>
  readonly operationId: () => string
  readonly maxActive?: number
  readonly maxRetainedCompleted?: number
}

export interface VerificationOperationManager {
  start(request: PluginVerifyRequest, requestId: string): Operation
  get(id: string): Operation
  cancel(id: string): Operation
}

interface MutableOperationEntry {
  readonly id: string
  readonly request: PluginVerifyRequest
  readonly requestId: string
  readonly controller: AbortController
  state: Operation['state']
  cancellationRequested: boolean
  result?: PluginVerifyResponse
  diagnostics: Diagnostic[]
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function validOperationId(value: string): boolean {
  return value.trim().length > 0 && value.length <= MAX_OPERATION_ID_LENGTH
}

function isTerminal(state: Operation['state']): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled'
}

function freezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item)
    return Object.freeze(value) as T
  }
  for (const item of Object.values(value as Record<string, unknown>)) freezeJson(item)
  return Object.freeze(value)
}

function cloneFrozen<T>(value: T): T {
  return freezeJson(structuredClone(value))
}

function snapshot(entry: MutableOperationEntry): Operation {
  return cloneFrozen({
    id: entry.id,
    kind: 'plugin.verify' as const,
    state: entry.state,
    cancellationRequested: entry.cancellationRequested,
    ...(entry.result === undefined ? {} : { result: entry.result }),
    diagnostics: entry.diagnostics,
  })
}

function operationExecutionDiagnostic(): Diagnostic {
  return Object.freeze({
    code: 'OPERATION_EXECUTION_FAILED',
    severity: 'error',
    domain: 'operation',
    summary: 'Verification operation failed before producing a canonical response.',
  })
}

export function createVerificationOperationManager(
  options: VerificationOperationManagerOptions,
): VerificationOperationManager {
  const maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE
  const maxRetainedCompleted = options.maxRetainedCompleted ?? DEFAULT_MAX_RETAINED_COMPLETED
  assertPositiveInteger(maxActive, 'maxActive')
  assertPositiveInteger(maxRetainedCompleted, 'maxRetainedCompleted')

  const entries = new Map<string, MutableOperationEntry>()
  const completedOrder: string[] = []

  function activeCount(): number {
    let count = 0
    for (const entry of entries.values()) {
      if (!isTerminal(entry.state)) count += 1
    }
    return count
  }

  function entryFor(id: string): MutableOperationEntry {
    const entry = entries.get(id)
    if (entry === undefined) {
      throw new VerificationOperationError(
        'OPERATION_NOT_FOUND',
        'Operation is unknown or no longer retained by this Toolchain host.',
      )
    }
    return entry
  }

  function pruneCompleted(): void {
    while (completedOrder.length > maxRetainedCompleted) {
      const oldest = completedOrder.shift()
      if (oldest !== undefined) entries.delete(oldest)
    }
  }

  function commitTerminal(
    entry: MutableOperationEntry,
    state: 'succeeded' | 'failed' | 'cancelled',
    result?: PluginVerifyResponse,
    diagnostics: readonly Diagnostic[] = [],
  ): void {
    if (isTerminal(entry.state)) return
    entry.state = state
    if (result === undefined) delete entry.result
    else entry.result = cloneFrozen(result)
    entry.diagnostics = diagnostics.map(item => cloneFrozen(item))
    completedOrder.push(entry.id)
    pruneCompleted()
  }

  async function run(entry: MutableOperationEntry): Promise<void> {
    if (isTerminal(entry.state)) return
    if (entry.controller.signal.aborted) {
      commitTerminal(entry, 'cancelled')
      return
    }

    entry.state = 'running'
    try {
      const result = await options.execute(
        entry.request,
        entry.requestId,
        entry.controller.signal,
      )
      if (result.status === 'ok') {
        commitTerminal(
          entry,
          result.data.status === 'cancelled' ? 'cancelled' : 'succeeded',
          result,
        )
        return
      }
      commitTerminal(entry, 'failed', result)
    } catch {
      commitTerminal(entry, 'failed', undefined, [operationExecutionDiagnostic()])
    }
  }

  function start(request: PluginVerifyRequest, requestId: string): Operation {
    if (activeCount() >= maxActive) {
      throw new VerificationOperationError(
        'OPERATION_CAPACITY_EXCEEDED',
        `Active verification operation capacity (${maxActive}) is exhausted.`,
      )
    }

    const id = options.operationId()
    if (!validOperationId(id) || entries.has(id)) {
      throw new VerificationOperationError(
        'OPERATION_EXECUTION_FAILED',
        'Unable to allocate a unique bounded operation id.',
      )
    }

    const entry: MutableOperationEntry = {
      id,
      request: cloneFrozen(request),
      requestId,
      controller: new AbortController(),
      state: 'queued',
      cancellationRequested: false,
      diagnostics: [],
    }
    entries.set(id, entry)
    const queued = snapshot(entry)
    queueMicrotask(() => {
      void run(entry)
    })
    return queued
  }

  function get(id: string): Operation {
    return snapshot(entryFor(id))
  }

  function cancel(id: string): Operation {
    const entry = entryFor(id)
    if (isTerminal(entry.state)) return snapshot(entry)

    entry.cancellationRequested = true
    if (!entry.controller.signal.aborted) entry.controller.abort()
    if (entry.state === 'queued') commitTerminal(entry, 'cancelled')
    return snapshot(entry)
  }

  return Object.freeze({ start, get, cancel })
}
