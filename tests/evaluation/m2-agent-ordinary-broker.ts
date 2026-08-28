import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'

import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  createTraceReceipt,
  type CapabilityManifest,
  type ModelVisibleTool,
  type RunnerToolTraceEntry,
  type TraceReceipt,
} from './m2-agent-execution-evidence.js'
import {
  createOrdinaryReadToolDefinition,
  createOrdinarySearchToolDefinition,
} from './m2-agent-ordinary-tools.js'
import type { OrdinaryWorkspace } from './m2-agent-ordinary-workspace.js'
import type { ProcessToolCallRequest } from './m2-agent-process-executor.js'

interface ToolchainDefinitionLike {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

export interface ToolchainDefinitionPair {
  readonly searchTool: ToolchainDefinitionLike
  readonly inspectTool: ToolchainDefinitionLike
}

export interface FrozenOrdinaryBroker {
  readonly readTool: ModelVisibleTool
  readonly searchTool: ModelVisibleTool
  dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown>
  traceReceipt(): Promise<TraceReceipt>
}

function modelSurface(tool: {
  readonly family: 'ordinary' | 'toolchain'
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}): ModelVisibleTool {
  return {
    family: tool.family,
    name: tool.name,
    description: tool.description,
    inputSchema: structuredClone(tool.inputSchema),
  }
}

function toolchainSurface(tool: ToolchainDefinitionLike): ModelVisibleTool {
  return {
    family: 'toolchain',
    name: tool.name,
    description: tool.description,
    inputSchema: structuredClone(tool.parameters),
  }
}

function errorEvidence(error: unknown): string {
  return error instanceof Error
    ? canonicalizeEvaluationJson({ name: error.name, message: error.message })
    : canonicalizeEvaluationJson({ name: 'UnknownError', message: String(error) })
}

export function createFrozenP0CapabilityManifests(
  workspace: OrdinaryWorkspace,
  toolchain: ToolchainDefinitionPair,
): { A: CapabilityManifest; B: CapabilityManifest; C: CapabilityManifest } {
  const read = createOrdinaryReadToolDefinition(workspace)
  const search = createOrdinarySearchToolDefinition(workspace)
  const ordinaryTools = [modelSurface(read), modelSurface(search)]
  const ordinaryEvidence = {
    workspaceSnapshotSha256: workspace.workspaceSnapshotSha256,
    roots: ['/exact-target'],
    readOnly: true as const,
    staticDocsSha256: workspace.documentationSha256,
    networkPolicy: 'provider-only' as const,
    search: {
      backend: 'virtual-literal-search',
      version: '1',
      maxResults: 50,
    },
  }

  return {
    A: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'A',
      ordinaryEvidence: null,
      tools: [],
    },
    B: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'B',
      ordinaryEvidence: structuredClone(ordinaryEvidence),
      tools: structuredClone(ordinaryTools),
    },
    C: {
      schema: 'dsh-toolchain-m2-capability-manifest-v1',
      arm: 'C',
      ordinaryEvidence: structuredClone(ordinaryEvidence),
      tools: [
        ...structuredClone(ordinaryTools),
        toolchainSurface(toolchain.searchTool),
        toolchainSurface(toolchain.inspectTool),
      ],
    },
  }
}

export async function createFrozenOrdinaryBroker(
  runControlSha256: string,
  workspace: OrdinaryWorkspace,
): Promise<FrozenOrdinaryBroker> {
  const sha256 = createNodeSha256Port()
  const read = createOrdinaryReadToolDefinition(workspace)
  const search = createOrdinarySearchToolDefinition(workspace)
  const tools = new Map([
    [read.name, read],
    [search.name, search],
  ])
  const entries: RunnerToolTraceEntry[] = []

  async function dispatchToolCall(request: ProcessToolCallRequest): Promise<unknown> {
    const tool = tools.get(request.name)
    if (tool === undefined) throw new Error(`Unavailable ordinary tool request: ${request.name}`)

    const sequence = entries.length + 1
    const startedAt = new Date().toISOString()
    const requestEvidence = await createInlineContentRef(
      canonicalizeEvaluationJson(request.input),
      'application/json',
      'utf8-bytes-v1',
      sha256,
    )

    try {
      const value = await tool.execute(request.input)
      const response = await createInlineContentRef(
        canonicalizeEvaluationJson(value),
        'application/json',
        'utf8-bytes-v1',
        sha256,
      )
      entries.push({
        sequence,
        family: 'ordinary',
        name: tool.name,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'ok',
        request: requestEvidence,
        response,
      })
      return value
    } catch (error) {
      entries.push({
        sequence,
        family: 'ordinary',
        name: tool.name,
        startedAt,
        completedAt: new Date().toISOString(),
        status: 'error',
        request: requestEvidence,
        response: await createInlineContentRef(
          errorEvidence(error),
          'application/json',
          'utf8-bytes-v1',
          sha256,
        ),
      })
      throw error
    }
  }

  return Object.freeze({
    readTool: modelSurface(read),
    searchTool: modelSurface(search),
    dispatchToolCall,
    traceReceipt: () => createTraceReceipt(runControlSha256, entries, sha256),
  })
}
