import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createContractInspectToolDefinition, createContractSearchToolDefinition } from '../../src/integrations/dsh/contract-tool.js'
import {
  createOperationCancelToolDefinition,
  createOperationGetToolDefinition,
  createPluginVerifyStartToolDefinition,
} from '../../src/integrations/dsh/operation-tool.js'
import { createPluginCheckToolDefinition } from '../../src/integrations/dsh/plugin-check-tool.js'
import { createPluginVerifyToolDefinition } from '../../src/integrations/dsh/plugin-verify-tool.js'
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
  return Object.freeze([
    createTargetResolveToolDefinition(unreachable as never),
    createContractSearchToolDefinition(unreachable as never),
    createContractInspectToolDefinition(unreachable as never),
    createPluginCheckToolDefinition(unreachable as never),
    createPluginVerifyToolDefinition(unreachable as never),
    createPluginVerifyStartToolDefinition(unreachable as never),
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
 * `renderedCompact` compares the renderer's exact output against canonical
 * `JSON.stringify` of the same response, because `contract.inspect` is the only tool
 * allowed to choose a smaller projection — and only when that projection is strictly
 * smaller. A tool that reports `renderedCompact: true` without being smaller would be a
 * regression, so the flag is derived from the bytes rather than from the tool identity.
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
