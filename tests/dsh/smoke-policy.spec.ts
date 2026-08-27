import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const smokeModule = await import('../../scripts/smoke-dsh-package.mjs') as Record<string, unknown>
const smokeSource = await readFile(
  fileURLToPath(new URL('../../scripts/smoke-dsh-package.mjs', import.meta.url)),
  'utf8',
)

describe('DSH package smoke policy', () => {
  it('covers both minimal and canonical web profiles', () => {
    expect(smokeModule.DSH_SMOKE_PROFILES).toEqual([
      {
        name: 'toolchain-smoke',
        requiredBundles: ['@deepseek-ai/dsh-base'],
      },
      {
        name: 'web',
        requiredBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      },
    ])
  })

  it('requires the shipped profile bundles in addition to dsh-toolchain', () => {
    const assertProfileManifest = smokeModule.assertProfileManifest as (
      manifest: unknown,
      requiredBundles: readonly string[],
    ) => void

    const manifest = {
      dependencies: { 'dsh-toolchain': 'file:package.tgz' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-toolchain'] } },
    }

    expect(() => assertProfileManifest(manifest, [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
    ])).toThrow(/@deepseek-ai\/dsh-web-app/)
  })

  it('requires the namespaced loader row in composed config', () => {
    const assertDumpConfig = smokeModule.assertDumpConfig as (dump: string) => void

    expect(() => assertDumpConfig(`
- id: toolchain
  name: dsh-toolchain/dsh
`)).toThrow(/dsh-toolchain row/)
  })

  it('requires a clean Web ToolDefinition search-to-inspect proof from exact declaration evidence', () => {
    expect(typeof smokeModule.assertWebContractIntelligence).toBe('function')
    expect(smokeSource).toContain("'exec', 'dsh-toolchain', 'contract', 'search'")
    expect(smokeSource).toContain("'--query', WEB_CONTRACT_QUERY")
    expect(smokeSource).toContain("const WEB_CONTRACT_QUERY = 'ToolDefinition'")
    expect(smokeSource).toContain("const WEB_CONTRACT_ID = 'package:@deepseek-ai/dsh-tools'")
    expect(smokeSource).toContain("'exec', 'dsh-toolchain', 'contract', 'inspect'")
    expect(smokeSource).toContain("item.source.startsWith('@deepseek-ai/dsh-tools/')")

    const assertWebContractIntelligence = smokeModule.assertWebContractIntelligence as (
      search: unknown,
      inspect: unknown,
    ) => void
    const snapshotFingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
    const evidenceId = 'types:@deepseek-ai/dsh-tools:dist/index.d.ts'
    const search = {
      status: 'ok',
      snapshotFingerprint,
      data: {
        contractIndexFingerprint,
        matches: [{
          id: 'package:@deepseek-ai/dsh-tools',
          evidenceIds: [evidenceId],
        }],
      },
    }
    const inspect = {
      status: 'ok',
      snapshotFingerprint,
      data: {
        contractIndexFingerprint,
        contract: {
          id: 'package:@deepseek-ai/dsh-tools',
          facts: [{
            key: 'declaration-export',
            value: 'ToolDefinition',
            evidenceIds: [evidenceId],
          }],
        },
        evidence: [{
          id: evidenceId,
          kind: 'type-declaration',
          source: '@deepseek-ai/dsh-tools/dist/index.d.ts',
        }],
      },
    }

    expect(() => assertWebContractIntelligence(search, inspect)).not.toThrow()
    expect(() => assertWebContractIntelligence(search, {
      ...inspect,
      data: {
        ...inspect.data,
        evidence: [],
      },
    })).toThrow(/evidence omitted/i)
  })

  it('requires actual DSH Agent-backed negative and live Host Inspect boot probes', () => {
    expect(smokeModule.DSH_BOOT_PROBE_PROFILE).toBe('toolchain-smoke')
    expect(smokeModule.DSH_LIVE_BOOT_PROBE_PROFILE).toBe('web')
    expect(typeof smokeModule.createBootProbePackage).toBe('function')
    expect(typeof smokeModule.assertBootProbeOutput).toBe('function')

    expect(smokeSource).toContain("rootCtx.inject(['toolchain', 'tools', 'agentLoop', 'agents']")
    expect(smokeSource).toContain('ctx.agentLoop.create(')
    expect(smokeSource).toContain('ctx.agents.get(agent.id) === agent')
    expect(smokeSource).toContain('ctx.tools.schemas(agent)')
    expect(smokeSource).toContain('ctx.toolchain.searchContracts(')
    expect(smokeSource).toContain('agent,')
    expect(smokeSource).toContain("query: 'toolchain_target_resolve'")
    expect(smokeSource).toContain("kinds: ['tool']")
    expect(smokeSource).toContain("contractId: 'tool:host:toolchain_target_resolve'")
    expect(smokeSource).toContain("source === 'cordis-inspect:host/Tool/listTools'")
    expect(smokeSource).toContain("'exec', 'dsh', '--profile', profile")
    expect(smokeSource).toContain('runBootProbe(runner, DSH_BOOT_PROBE_PROFILE, env, false)')
    expect(smokeSource).toContain('runBootProbe(runner, DSH_LIVE_BOOT_PROBE_PROFILE, env, true)')
  })

  it('accepts only a live receipt proving Agent identity, runtime evidence, index drift, and inspect continuity', () => {
    const assertBootProbeOutput = smokeModule.assertBootProbeOutput as (
      output: string,
      options: { profile: string; expectLive: boolean },
    ) => void
    const fingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const offlineIndex = `dsh-contract-index-v1:${'b'.repeat(64)}`
    const liveIndex = `dsh-contract-index-v1:${'c'.repeat(64)}`
    const receipt = {
      profile: 'web',
      descriptor: {
        product: 'dsh-toolchain',
        version: '0.0.0',
        protocolVersion: '1',
      },
      agent: {
        id: 'dsh-toolchain-smoke-agent',
        registered: true,
      },
      inspectProviderAvailable: true,
      service: {
        status: 'ok',
        snapshotFingerprint: fingerprint,
      },
      nativeTool: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        renderedMatchesValue: true,
      },
      offlineSearch: {
        status: 'ok',
        contractIndexFingerprint: offlineIndex,
        foundRuntimeTool: false,
      },
      contractSearch: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        contractIndexFingerprint: liveIndex,
        foundRuntimeTool: true,
        runtimeEvidence: true,
        renderedMatchesValue: true,
      },
      contractInspect: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        contractIndexFingerprint: liveIndex,
        contractId: 'tool:host:toolchain_target_resolve',
        availability: 'available',
        runtimeEvidence: true,
        renderedMatchesValue: true,
      },
    }

    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify(receipt)}\n`,
      { profile: 'web', expectLive: true },
    )).not.toThrow()
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        agent: { ...receipt.agent, registered: false },
      })}\n`,
      { profile: 'web', expectLive: true },
    )).toThrow(/Agent/i)
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        contractSearch: { ...receipt.contractSearch, contractIndexFingerprint: offlineIndex },
      })}\n`,
      { profile: 'web', expectLive: true },
    )).toThrow(/live Contract search/i)
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        contractInspect: { ...receipt.contractInspect, runtimeEvidence: false },
      })}\n`,
      { profile: 'web', expectLive: true },
    )).toThrow(/live Contract inspect/i)
  })

  it('accepts the Agent-backed missing-Inspect path only when native and offline indexes stay identical', () => {
    const assertBootProbeOutput = smokeModule.assertBootProbeOutput as (
      output: string,
      options: { profile: string; expectLive: boolean },
    ) => void
    const fingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const offlineIndex = `dsh-contract-index-v1:${'b'.repeat(64)}`
    const receipt = {
      profile: 'toolchain-smoke',
      descriptor: {
        product: 'dsh-toolchain',
        version: '0.0.0',
        protocolVersion: '1',
      },
      agent: { id: 'dsh-toolchain-smoke-agent', registered: true },
      inspectProviderAvailable: false,
      service: { status: 'ok', snapshotFingerprint: fingerprint },
      nativeTool: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        renderedMatchesValue: true,
      },
      offlineSearch: {
        status: 'ok',
        contractIndexFingerprint: offlineIndex,
        foundRuntimeTool: false,
      },
      contractSearch: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        contractIndexFingerprint: offlineIndex,
        foundRuntimeTool: false,
        runtimeEvidence: false,
        renderedMatchesValue: true,
      },
      contractInspect: null,
    }

    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify(receipt)}\n`,
      { profile: 'toolchain-smoke', expectLive: false },
    )).not.toThrow()
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        contractSearch: { ...receipt.contractSearch, contractIndexFingerprint: `dsh-contract-index-v1:${'c'.repeat(64)}` },
      })}\n`,
      { profile: 'toolchain-smoke', expectLive: false },
    )).toThrow(/offline fallback/i)
  })
})
