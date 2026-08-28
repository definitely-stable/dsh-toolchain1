import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import {
  inspectContractResponse,
  searchContractsResponse,
} from '../../src/kernel/index.js'
import {
  createContractInspectToolDefinition,
  createContractSearchToolDefinition,
} from '../../src/integrations/dsh/contract-tool.js'
import type { DshToolDefinition } from '../../src/integrations/dsh/target-tool.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import {
  createInlineContentRef,
  createTraceReceipt,
  type RunnerToolTraceEntry,
  type TraceReceipt,
} from './m2-agent-execution-evidence.js'
import { createFrozenM2KernelHarness } from './m2-search-inspect-fixture.js'

export interface FrozenToolchainBroker {
  readonly searchTool: DshToolDefinition
  readonly inspectTool: DshToolDefinition
  traceReceipt(): Promise<TraceReceipt>
}

function recordIdentity(value: unknown): {
  readonly targetFingerprint?: string
  readonly contractIndexFingerprint?: string
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const response = value as Record<string, unknown>
  const targetFingerprint = typeof response.snapshotFingerprint === 'string'
    ? response.snapshotFingerprint
    : undefined
  const data = response.data
  const contractIndexFingerprint = data !== null && typeof data === 'object' && !Array.isArray(data)
    && typeof (data as Record<string, unknown>).contractIndexFingerprint === 'string'
    ? (data as Record<string, unknown>).contractIndexFingerprint as string
    : undefined

  return {
    ...(targetFingerprint === undefined ? {} : { targetFingerprint }),
    ...(contractIndexFingerprint === undefined ? {} : { contractIndexFingerprint }),
  }
}

function errorEvidence(error: unknown): string {
  if (error instanceof Error) {
    return canonicalizeEvaluationJson({ name: error.name, message: error.message })
  }
  return canonicalizeEvaluationJson({ name: 'UnknownError', message: String(error) })
}

export async function createFrozenToolchainBroker(
  runControlSha256: string,
): Promise<FrozenToolchainBroker> {
  const harness = await createFrozenM2KernelHarness()
  const sha256 = createNodeSha256Port()
  const entries: RunnerToolTraceEntry[] = []

  function requestId(toolName: string): string {
    return `m2-agent-eval-${runControlSha256.slice(0, 12)}-${entries.length + 1}-${toolName}`
  }

  const productionSearch = createContractSearchToolDefinition(request => searchContractsResponse(
    harness.kernel,
    request,
    requestId('search'),
  ))
  const productionInspect = createContractInspectToolDefinition(request => inspectContractResponse(
    harness.kernel,
    request,
    requestId('inspect'),
  ))

  function tracedTool(definition: DshToolDefinition): DshToolDefinition {
    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: definition.output,
      async execute(args: unknown, execution?: unknown): Promise<unknown> {
        const sequence = entries.length + 1
        const startedAt = new Date().toISOString()
        const request = await createInlineContentRef(
          canonicalizeEvaluationJson(args),
          'application/json',
          'utf8-bytes-v1',
          sha256,
        )

        try {
          const value = await definition.execute(args, execution)
          const response = await createInlineContentRef(
            canonicalizeEvaluationJson(value),
            'application/json',
            'utf8-bytes-v1',
            sha256,
          )
          entries.push({
            sequence,
            family: 'toolchain',
            name: definition.name,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'ok',
            request,
            response,
            ...recordIdentity(value),
          })
          return value
        } catch (error) {
          entries.push({
            sequence,
            family: 'toolchain',
            name: definition.name,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'error',
            request,
            response: await createInlineContentRef(
              errorEvidence(error),
              'application/json',
              'utf8-bytes-v1',
              sha256,
            ),
          })
          throw error
        }
      },
    }
  }

  return Object.freeze({
    searchTool: tracedTool(productionSearch),
    inspectTool: tracedTool(productionInspect),
    traceReceipt: () => createTraceReceipt(runControlSha256, entries, sha256),
  })
}
