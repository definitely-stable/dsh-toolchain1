import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { parseContractInspectRequest, parseContractSearchRequest } from '../../src/protocol/index.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { createInlineContentRef, createTraceReceipt, type RunnerToolTraceEntry, type TraceReceipt } from './m2-agent-execution-evidence.js'
import { createOrdinaryReadToolDefinition, createOrdinarySearchToolDefinition } from './m2-agent-ordinary-tools.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import type { ProcessToolCallRequest } from './m2-agent-process-executor.js'
import { createFrozenToolchainBroker } from './m2-agent-tool-broker.js'

export interface FrozenP0ToolRuntime {
  dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown>
  traceReceipt(): Promise<TraceReceipt>
}

type RuntimeTool = {
  family: 'ordinary' | 'toolchain'
  name: string
  execute(input: unknown): Promise<unknown>
  validateModelInput?: (input: unknown) => void
  executionErrorsAreModelInput?: boolean
}

const MAX_MODEL_TOOL_ERROR_CHARACTERS = 240

function errorJson(error: unknown): string {
  const value = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) }
  return canonicalizeEvaluationJson(value)
}

function boundedModelToolErrorMessage(error: unknown): string {
  const source = error instanceof Error ? error.message : String(error)
  const withoutControls = Array.from(source, character => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f) ? ' ' : character
  }).join('')
  const normalized = withoutControls.replace(/\s+/gu, ' ').trim()
  return (normalized.length === 0 ? 'Invalid tool call' : normalized).slice(0, MAX_MODEL_TOOL_ERROR_CHARACTERS)
}

function modelToolError(error: unknown): { readonly error: { readonly code: 'MODEL_TOOL_CALL_INVALID'; readonly message: string } } {
  return Object.freeze({
    error: Object.freeze({
      code: 'MODEL_TOOL_CALL_INVALID',
      message: boundedModelToolErrorMessage(error),
    }),
  })
}

function identity(value: unknown): Partial<Pick<RunnerToolTraceEntry, 'targetFingerprint' | 'contractIndexFingerprint'>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const response = value as Record<string, unknown>
  const data = response.data
  const targetFingerprint = typeof response.snapshotFingerprint === 'string' ? response.snapshotFingerprint : undefined
  const contractIndexFingerprint = data !== null && typeof data === 'object' && !Array.isArray(data)
    && typeof (data as Record<string, unknown>).contractIndexFingerprint === 'string'
    ? (data as Record<string, unknown>).contractIndexFingerprint as string
    : undefined
  return {
    ...(targetFingerprint === undefined ? {} : { targetFingerprint }),
    ...(contractIndexFingerprint === undefined ? {} : { contractIndexFingerprint }),
  }
}

export async function createFrozenP0ToolRuntime(runControlSha256: string, workspace: OrdinaryWorkspace): Promise<FrozenP0ToolRuntime> {
  const sha256 = createNodeSha256Port()
  const read = createOrdinaryReadToolDefinition(workspace)
  const search = createOrdinarySearchToolDefinition(workspace)
  const toolchain = await createFrozenToolchainBroker(runControlSha256)
  const entries: RunnerToolTraceEntry[] = []
  const tools = new Map<string, RuntimeTool>([
    [read.name, {
      family: 'ordinary',
      name: read.name,
      execute: input => read.execute(input),
      executionErrorsAreModelInput: true,
    }],
    [search.name, {
      family: 'ordinary',
      name: search.name,
      execute: input => search.execute(input),
      executionErrorsAreModelInput: true,
    }],
    [toolchain.searchTool.name, {
      family: 'toolchain',
      name: toolchain.searchTool.name,
      validateModelInput: input => { parseContractSearchRequest(input) },
      execute: input => toolchain.searchTool.execute(input),
    }],
    [toolchain.inspectTool.name, {
      family: 'toolchain',
      name: toolchain.inspectTool.name,
      validateModelInput: input => { parseContractInspectRequest(input) },
      execute: input => toolchain.inspectTool.execute(input),
    }],
  ])

  async function tracedModelError(
    tool: RuntimeTool,
    requestRef: Awaited<ReturnType<typeof createInlineContentRef>>,
    sequence: number,
    startedAt: string,
    error: unknown,
  ): Promise<unknown> {
    const value = modelToolError(error)
    const response = await createInlineContentRef(
      canonicalizeEvaluationJson(value),
      'application/json',
      'utf8-bytes-v1',
      sha256,
    )
    entries.push({
      sequence,
      family: tool.family,
      name: tool.name,
      startedAt,
      completedAt: new Date().toISOString(),
      status: 'error',
      request: requestRef,
      response,
    })
    return value
  }

  async function dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown> {
    const tool = tools.get(request.name)
    if (tool === undefined) throw new Error(`Unavailable P0 tool request: ${request.name}`)
    const sequence = entries.length + 1
    const startedAt = new Date().toISOString()
    const requestRef = await createInlineContentRef(canonicalizeEvaluationJson(request.input), 'application/json', 'utf8-bytes-v1', sha256)

    if (tool.validateModelInput !== undefined) {
      try {
        tool.validateModelInput(request.input)
      } catch (error) {
        return tracedModelError(tool, requestRef, sequence, startedAt, error)
      }
    }

    try {
      const value = await tool.execute(request.input)
      const response = await createInlineContentRef(canonicalizeEvaluationJson(value), 'application/json', 'utf8-bytes-v1', sha256)
      entries.push({ sequence, family: tool.family, name: tool.name, startedAt, completedAt: new Date().toISOString(), status: 'ok', request: requestRef, response, ...(tool.family === 'toolchain' ? identity(value) : {}) })
      return value
    } catch (error) {
      if (tool.executionErrorsAreModelInput === true) {
        return tracedModelError(tool, requestRef, sequence, startedAt, error)
      }
      const response = await createInlineContentRef(errorJson(error), 'application/json', 'utf8-bytes-v1', sha256)
      entries.push({ sequence, family: tool.family, name: tool.name, startedAt, completedAt: new Date().toISOString(), status: 'error', request: requestRef, response })
      throw error
    }
  }

  return Object.freeze({ dispatchToolCall, traceReceipt: () => createTraceReceipt(runControlSha256, entries, sha256) })
}
