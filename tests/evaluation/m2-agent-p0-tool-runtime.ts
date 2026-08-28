import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
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
}

function errorJson(error: unknown): string {
  const value = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'UnknownError', message: String(error) }
  return canonicalizeEvaluationJson(value)
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
    [read.name, { family: 'ordinary', name: read.name, execute: input => read.execute(input) }],
    [search.name, { family: 'ordinary', name: search.name, execute: input => search.execute(input) }],
    [toolchain.searchTool.name, { family: 'toolchain', name: toolchain.searchTool.name, execute: input => toolchain.searchTool.execute(input) }],
    [toolchain.inspectTool.name, { family: 'toolchain', name: toolchain.inspectTool.name, execute: input => toolchain.inspectTool.execute(input) }],
  ])

  async function dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown> {
    const tool = tools.get(request.name)
    if (tool === undefined) throw new Error(`Unavailable P0 tool request: ${request.name}`)
    const sequence = entries.length + 1
    const startedAt = new Date().toISOString()
    const requestRef = await createInlineContentRef(canonicalizeEvaluationJson(request.input), 'application/json', 'utf8-bytes-v1', sha256)
    try {
      const value = await tool.execute(request.input)
      const response = await createInlineContentRef(canonicalizeEvaluationJson(value), 'application/json', 'utf8-bytes-v1', sha256)
      entries.push({ sequence, family: tool.family, name: tool.name, startedAt, completedAt: new Date().toISOString(), status: 'ok', request: requestRef, response, ...(tool.family === 'toolchain' ? identity(value) : {}) })
      return value
    } catch (error) {
      const response = await createInlineContentRef(errorJson(error), 'application/json', 'utf8-bytes-v1', sha256)
      entries.push({ sequence, family: tool.family, name: tool.name, startedAt, completedAt: new Date().toISOString(), status: 'error', request: requestRef, response })
      throw error
    }
  }

  return Object.freeze({ dispatchToolCall, traceReceipt: () => createTraceReceipt(runControlSha256, entries, sha256) })
}
