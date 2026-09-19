import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_TOOL_NAMES,
  OMITTED_FROM_DEFAULT_AGENT_SURFACE,
  isDefaultAgentTool,
} from '../../src/integrations/dsh/agent-surface-policy.js'
import {
  MODEL_SURFACE_BASELINE_IDENTITY,
  MODEL_SURFACE_BASELINE_SCHEMA,
  measureModelSurface,
  nativeToolDefinitions,
  repositoryRootFrom,
} from './m2-model-surface-baseline.js'

const RECEIPT_URL = new URL('../../docs/evaluation/m2/agent-surface-baseline-v1.json', import.meta.url)
const REPOSITORY_ROOT = repositoryRootFrom(import.meta.url)

/**
 * The surface as measured before the post-H2 hardening work, recorded in
 * `docs/evaluation/m2/agent-surface-baseline-v1.json`. The advertised surface may shrink
 * below it and must never grow back past it.
 */
const BASELINE_TOOL_NAMES = [
  'toolchain_target_resolve',
  'toolchain_contract_search',
  'toolchain_contract_inspect',
  'toolchain_plugin_check',
  'toolchain_plugin_verify',
  'toolchain_plugin_verify_start',
  'toolchain_operation_get',
  'toolchain_operation_cancel',
] as const

interface SurfaceReceipt {
  readonly schema: string
  readonly identity: string
  readonly tools: ReadonlyArray<{ name: string, modelVisibleBytes: number, renderedExampleBytes: number }>
  readonly totalModelVisibleBytes: number
  readonly totalRenderedExampleBytes: number
}

async function readReceipt(): Promise<SurfaceReceipt> {
  return JSON.parse(await readFile(RECEIPT_URL, 'utf8')) as SurfaceReceipt
}

describe('default model-facing Toolchain surface', () => {
  it('measures every implemented native tool, advertised or withheld', () => {
    const measured = measureModelSurface('deterministic', REPOSITORY_ROOT)
    expect(measured.schema).toBe(MODEL_SURFACE_BASELINE_SCHEMA)
    expect(measured.identity).toBe(MODEL_SURFACE_BASELINE_IDENTITY)
    // Measurement covers the whole application surface, not just the advertised one, so
    // the cost of withholding a tool stays visible and cannot be quietly misreported.
    expect(measured.tools.map(tool => tool.name)).toEqual(BASELINE_TOOL_NAMES)
    for (const tool of measured.tools) {
      expect(tool.descriptionBytes).toBeGreaterThan(0)
      expect(tool.parameterSchemaBytes).toBeGreaterThan(0)
      expect(tool.renderedExampleBytes).toBeGreaterThan(0)
      // Model-visible bytes are the advertised cost; the output schema is never sent to
      // the model, so it must stay out of that figure.
      expect(tool.modelVisibleBytes).toBe(tool.descriptionBytes + tool.parameterSchemaBytes + tool.name.length)
      expect(tool.totalDefinitionBytes).toBe(tool.modelVisibleBytes + tool.outputSchemaBytes)
    }
    expect(measured.totalModelVisibleBytes)
      .toBe(measured.tools.reduce((total, tool) => total + tool.modelVisibleBytes, 0))
  })

  it('advertises only the policy surface and keeps the withheld tools real', () => {
    const definitions = nativeToolDefinitions()
    const advertised = definitions.filter(definition => isDefaultAgentTool(definition.name)).map(definition => definition.name)
    expect(advertised).toEqual([...DEFAULT_AGENT_TOOL_NAMES])

    const withheld = definitions.filter(definition => !isDefaultAgentTool(definition.name)).map(definition => definition.name)
    expect(withheld).toEqual([...OMITTED_FROM_DEFAULT_AGENT_SURFACE])
    // Withholding is a presentation decision: the definitions still exist and are still
    // measured, so the capability moved out of the default catalog rather than away.
    expect(definitions).toHaveLength(BASELINE_TOOL_NAMES.length)
  })

  it('claims a compact projection only where one is measured to be smaller', () => {
    // Contract Inspect is the only tool with a model-facing projection at baseline, and
    // the flag is derived from bytes rather than identity, so a canonical renderer cannot
    // silently claim to be compact.
    const measured = measureModelSurface('deterministic', REPOSITORY_ROOT)
    const compact = measured.tools.filter(tool => tool.renderedCompact).map(tool => tool.name)
    expect(compact).toEqual(['toolchain_contract_inspect'])
  })

  it('advertises materially less than the recorded baseline surface', async () => {
    const receipt = await readReceipt()
    const measured = measureModelSurface('deterministic', REPOSITORY_ROOT)
    expect(receipt.schema).toBe(MODEL_SURFACE_BASELINE_SCHEMA)
    expect(receipt.identity).toBe(MODEL_SURFACE_BASELINE_IDENTITY)

    const byName = new Map(receipt.tools.map(tool => [tool.name, tool]))
    const advertisedBytes = DEFAULT_AGENT_TOOL_NAMES.reduce(
      (total, name) => total + (byName.get(name)?.modelVisibleBytes ?? 0),
      0,
    )
    // The point of the hardening work: the advertised catalog costs materially less than
    // the eight-tool baseline it replaced, and no definition grew on the way.
    expect(advertisedBytes).toBeLessThan(receipt.totalModelVisibleBytes)
    for (const tool of measured.tools) {
      const recorded = byName.get(tool.name)
      if (recorded === undefined) continue
      expect(tool.modelVisibleBytes, `${tool.name} model-visible bytes`).toBeLessThanOrEqual(recorded.modelVisibleBytes)
    }
  })
})
