import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AGENT_TOOL_NAMES,
  OMITTED_FROM_DEFAULT_AGENT_SURFACE,
} from '../../src/integrations/dsh/agent-surface-policy.js'
import {
  ADVERTISED_SURFACE_IDENTITY,
  ADVERTISED_SURFACE_SCHEMA,
  measureAdvertisedSurface,
  nativeToolDefinitions,
  repositoryRootFrom,
  type HistoricalSurfaceReceipt,
} from './m2-model-surface-baseline.js'

const BASELINE_RECEIPT_URL = new URL('../../docs/evaluation/m2/agent-surface-baseline-v1.json', import.meta.url)
const RECEIPT_URL = new URL('../../docs/evaluation/m2/agent-surface-implicit-target-v1.json', import.meta.url)
const REPOSITORY_ROOT = repositoryRootFrom(import.meta.url)

async function baselineReceipt(): Promise<HistoricalSurfaceReceipt> {
  return JSON.parse(await readFile(BASELINE_RECEIPT_URL, 'utf8')) as HistoricalSurfaceReceipt
}

async function measured() {
  return measureAdvertisedSurface('deterministic', REPOSITORY_ROOT, await baselineReceipt())
}

describe('advertised Agent surface after implicit target binding', () => {
  it('replaces the nested canonical target with one optional flat profile', () => {
    const definitions = new Map(nativeToolDefinitions().map(definition => [definition.name, definition]))

    for (const name of DEFAULT_AGENT_TOOL_NAMES) {
      const parameters = definitions.get(name)?.parameters as {
        readonly properties?: Record<string, unknown>
        readonly required?: readonly string[]
      }
      expect(parameters.properties?.profile, `${name} profile parameter`).toBeDefined()
      // A nested target would let a model choose acquisition hints and bypass the binding decision,
      // so it must not be a model-facing key at all.
      expect(parameters.properties?.target, `${name} nested target`).toBeUndefined()
      expect(parameters.required ?? [], `${name} required keys`).not.toContain('target')
    }
  })

  it('keeps the withheld operations measured even though they are not advertised', async () => {
    const surface = await measured()
    expect(surface.advertisedTools).toEqual([...DEFAULT_AGENT_TOOL_NAMES])
    expect(surface.withheldTools).toEqual([...OMITTED_FROM_DEFAULT_AGENT_SURFACE])
    expect(surface.tools).toHaveLength(
      DEFAULT_AGENT_TOOL_NAMES.length + OMITTED_FROM_DEFAULT_AGENT_SURFACE.length,
    )
  })

  it('strictly shrinks every advertised definition against the recorded baseline', async () => {
    const baseline = await baselineReceipt()
    const surface = await measured()
    const recorded = new Map(baseline.tools.map(tool => [tool.name, tool.modelVisibleBytes]))

    for (const tool of surface.tools) {
      const before = recorded.get(tool.name)
      if (before === undefined) continue
      if (surface.advertisedTools.includes(tool.name)) {
        // Every advertised tool carried the repeated nested target schema before this change, so
        // each one has to shrink rather than merely stay within the baseline ceiling.
        expect(tool.modelVisibleBytes, `${tool.name} advertised bytes`).toBeLessThan(before)
        continue
      }
      expect(tool.modelVisibleBytes, `${tool.name} withheld bytes`).toBeLessThanOrEqual(before)
    }
    expect(surface.advertisedSavedBytes).toBeGreaterThan(0)
  })

  it('freezes the measured advertised surface against implementation drift', async () => {
    const receipt = JSON.parse(await readFile(RECEIPT_URL, 'utf8')) as {
      readonly schema: string
      readonly identity: string
    }
    const surface = await measured()

    expect(receipt.schema).toBe(ADVERTISED_SURFACE_SCHEMA)
    expect(receipt.identity).toBe(ADVERTISED_SURFACE_IDENTITY)
    expect(receipt).toEqual(surface)
  })
})
