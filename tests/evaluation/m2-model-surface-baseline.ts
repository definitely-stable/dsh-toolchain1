import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createContractInspectToolDefinition, createContractSearchToolDefinition } from '../../src/integrations/dsh/contract-tool.js'
import { isDefaultAgentTool } from '../../src/integrations/dsh/agent-surface-policy.js'
import {
  createOperationCancelToolDefinition,
  createOperationGetToolDefinition,
  createPluginVerifyStartToolDefinition,
} from '../../src/integrations/dsh/operation-tool.js'
import { createPluginCheckToolDefinition } from '../../src/integrations/dsh/plugin-check-tool.js'
import { createPluginVerifyToolDefinition } from '../../src/integrations/dsh/plugin-verify-tool.js'
import type { DshAmbientTargetBindingPort } from '../../src/integrations/dsh/runtime-target-binding.js'
import { createTargetResolveToolDefinition } from '../../src/integrations/dsh/target-tool.js'
import type { DshToolDefinition } from '../../src/integrations/dsh/target-tool.js'

export const MODEL_SURFACE_BASELINE_SCHEMA = 'dsh-toolchain-model-surface-baseline-v1' as const
export const MODEL_SURFACE_BASELINE_IDENTITY = 'dsh-toolchain-post-h2-agent-surface-v1' as const

/**
 * Canonical Protocol v1 example per tool, used as the deterministic model-facing
 * payload. These are the normative `spec/examples/v1` fixtures rather than
 * hand-written samples, so the byte measurements describe the published contract.
 */
const EXAMPLE_BY_TOOL: Readonly<Record<string, string>> = Object.freeze({
  toolchain_target_resolve: 'target-resolved.json',
  toolchain_contract_search: 'contract-search-resolved.json',
  toolchain_contract_inspect: 'contract-inspect-resolved.json',
  toolchain_plugin_check: 'plugin-check-version-mismatch.json',
  toolchain_plugin_verify: 'verification-passed.json',
  toolchain_plugin_verify_start: 'plugin-verify-operation-running.json',
  toolchain_operation_get: 'plugin-verify-operation-succeeded.json',
  toolchain_operation_cancel: 'plugin-verify-operation-running.json',
})

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Repository root for the `spec/examples/v1` fixtures. Callers pass it explicitly
 * because this module must also run from a relocated build tree, where a path derived
 * from its own `import.meta.url` would resolve outside the checkout.
 */
export function repositoryRootFrom(specifier: string): string {
  return fileURLToPath(new URL('../..', specifier))
}

/** The tool definitions the service registers, with inert resolvers: measurement never executes a tool. */
export function nativeToolDefinitions(): readonly DshToolDefinition[] {
  const unreachable = (): never => { throw new Error('measurement must not execute a tool') }
  // Measuring the advertised argument schema must not depend on a running Host target either, so the
  // binding is inert for the same reason the resolvers are.
  const binding: DshAmbientTargetBindingPort = Object.freeze({
    async targetRequest(): Promise<never> {
      return unreachable()
    },
  })
  return Object.freeze([
    createTargetResolveToolDefinition(unreachable as never, binding),
    createContractSearchToolDefinition(unreachable as never, binding),
    createContractInspectToolDefinition(unreachable as never, binding),
    createPluginCheckToolDefinition(unreachable as never, binding),
    createPluginVerifyToolDefinition(unreachable as never, binding),
    createPluginVerifyStartToolDefinition(unreachable as never, binding),
    createOperationGetToolDefinition(unreachable as never),
    createOperationCancelToolDefinition(unreachable as never),
  ])
}

export interface ToolSurfaceMeasurement {
  readonly name: string
  readonly descriptionBytes: number
  readonly parameterSchemaBytes: number
  /**
   * Bytes the model actually pays to have this tool available. DSH's `schemas()` whitelists
   * exactly `name`, `description` and `parameters`; the output schema is never sent to the
   * model, so counting it here would overstate the advertised surface.
   */
  readonly modelVisibleBytes: number
  readonly outputSchemaBytes: number
  /** Model-visible bytes plus the output schema, for callers that want the whole definition. */
  readonly totalDefinitionBytes: number
  readonly renderedExampleBytes: number
  /** Exact UTF-8 bytes of canonical Protocol v1 JSON for the same example. */
  readonly canonicalExampleBytes: number
  readonly renderedStatus: 'ok' | 'failed'
  readonly renderedCompact: boolean
}

export interface ModelSurfaceBaseline {
  readonly schema: typeof MODEL_SURFACE_BASELINE_SCHEMA
  readonly identity: typeof MODEL_SURFACE_BASELINE_IDENTITY
  readonly generatedAt: string
  readonly tools: readonly ToolSurfaceMeasurement[]
  readonly totalModelVisibleBytes: number
  readonly totalRenderedExampleBytes: number
}

/**
 * Deterministic measurement of the default model-facing Toolchain surface.
 *
 * `renderedCompact` compares the renderer's exact output against canonical `JSON.stringify` of the
 * same response, because a model-facing projection is allowed to shorten a payload and never to
 * lengthen or reformat one. The flag is derived from bytes rather than from tool identity, so a
 * canonical renderer cannot silently claim to be compact and a projected renderer cannot hide a
 * regression. A tool whose canonical example carries no repeated evidence graph legitimately keeps
 * the canonical bytes: the shared serializer emits a projection only when it is strictly smaller.
 */
export function measureModelSurface(generatedAt: string, repositoryRoot: string): ModelSurfaceBaseline {
  const tools = nativeToolDefinitions().map(definition => {
    const descriptionBytes = utf8Bytes(definition.description)
    const parameterSchemaBytes = utf8Bytes(JSON.stringify(definition.parameters))
    const outputSchemaBytes = utf8Bytes(JSON.stringify(definition.output.schema))
    const modelVisibleBytes = utf8Bytes(definition.name) + descriptionBytes + parameterSchemaBytes

    const exampleFile = join(repositoryRoot, 'spec', 'examples', 'v1', EXAMPLE_BY_TOOL[definition.name]!)
    const example = JSON.parse(readFileSync(exampleFile, 'utf8')) as unknown
    const canonical = JSON.stringify(example)
    const rendered = definition.output.render({}, example).map(block => block.text).join('')

    return Object.freeze({
      name: definition.name,
      descriptionBytes,
      parameterSchemaBytes,
      modelVisibleBytes,
      outputSchemaBytes,
      totalDefinitionBytes: modelVisibleBytes + outputSchemaBytes,
      renderedExampleBytes: utf8Bytes(rendered),
      canonicalExampleBytes: utf8Bytes(canonical),
      renderedStatus: (example as { status?: string }).status === 'ok' ? 'ok' : 'failed',
      renderedCompact: rendered !== canonical && utf8Bytes(rendered) < utf8Bytes(canonical),
    })
  })

  const sum = (selector: (item: ToolSurfaceMeasurement) => number) =>
    tools.reduce((total, item) => total + selector(item), 0)

  return Object.freeze({
    schema: MODEL_SURFACE_BASELINE_SCHEMA,
    identity: MODEL_SURFACE_BASELINE_IDENTITY,
    generatedAt,
    tools: Object.freeze(tools),
    totalModelVisibleBytes: sum(item => item.modelVisibleBytes),
    totalRenderedExampleBytes: sum(item => item.renderedExampleBytes),
  })
}

export const ADVERTISED_SURFACE_SCHEMA = 'dsh-toolchain-advertised-surface-v1' as const
export const ADVERTISED_SURFACE_IDENTITY = 'dsh-toolchain-post-h2-implicit-target-binding-v1' as const

export interface AdvertisedSurfaceToolMeasurement {
  readonly name: string
  readonly modelVisibleBytes: number
  readonly parameterSchemaBytes: number
}

export interface AdvertisedSurfaceMeasurement {
  readonly schema: typeof ADVERTISED_SURFACE_SCHEMA
  readonly identity: typeof ADVERTISED_SURFACE_IDENTITY
  readonly generatedAt: string
  /** Every implemented tool, advertised or withheld, so withholding stays visible in the receipt. */
  readonly tools: readonly AdvertisedSurfaceToolMeasurement[]
  readonly advertisedTools: readonly string[]
  readonly withheldTools: readonly string[]
  readonly advertisedModelVisibleBytes: number
  readonly withheldModelVisibleBytes: number
  /** The advertised bytes recorded by the historical pre-change baseline receipt. */
  readonly baselineAdvertisedModelVisibleBytes: number
  readonly advertisedSavedBytes: number
}

export interface HistoricalSurfaceReceipt {
  readonly tools: readonly { readonly name: string, readonly modelVisibleBytes: number }[]
}

/**
 * Measure the advertised model-facing surface against the historical baseline receipt.
 *
 * The baseline receipt is never rewritten: it stays the pre-change snapshot the reduction is stated
 * against, so a later surface change is compared with recorded bytes rather than argued about.
 */
export function measureAdvertisedSurface(
  generatedAt: string,
  repositoryRoot: string,
  baseline: HistoricalSurfaceReceipt,
): AdvertisedSurfaceMeasurement {
  const measured = measureModelSurface(generatedAt, repositoryRoot)
  const advertised = measured.tools.filter(tool => isDefaultAgentTool(tool.name))
  const withheld = measured.tools.filter(tool => !isDefaultAgentTool(tool.name))
  const baselineBytes = baseline.tools
    .filter(tool => isDefaultAgentTool(tool.name))
    .reduce((total, tool) => total + tool.modelVisibleBytes, 0)
  const advertisedBytes = advertised.reduce((total, tool) => total + tool.modelVisibleBytes, 0)

  return Object.freeze({
    schema: ADVERTISED_SURFACE_SCHEMA,
    identity: ADVERTISED_SURFACE_IDENTITY,
    generatedAt,
    tools: Object.freeze(measured.tools.map(tool => Object.freeze({
      name: tool.name,
      modelVisibleBytes: tool.modelVisibleBytes,
      parameterSchemaBytes: tool.parameterSchemaBytes,
    }))),
    advertisedTools: Object.freeze(advertised.map(tool => tool.name)),
    withheldTools: Object.freeze(withheld.map(tool => tool.name)),
    advertisedModelVisibleBytes: advertisedBytes,
    withheldModelVisibleBytes: withheld.reduce((total, tool) => total + tool.modelVisibleBytes, 0),
    baselineAdvertisedModelVisibleBytes: baselineBytes,
    advertisedSavedBytes: baselineBytes - advertisedBytes,
  })
}
