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

  it('requires an actual DSH boot probe for target and contract ToolRuntime paths', () => {
    expect(smokeModule.DSH_BOOT_PROBE_PROFILE).toBe('toolchain-smoke')
    expect(typeof smokeModule.createBootProbePackage).toBe('function')
    expect(typeof smokeModule.assertBootProbeOutput).toBe('function')

    expect(smokeSource).toContain("rootCtx.inject(['toolchain', 'tools']")
    expect(smokeSource).toContain('ctx.toolchain.describe()')
    expect(smokeSource).toContain('ctx.toolchain.resolveTarget(')
    expect(smokeSource).toContain('ctx.tools.schemas()')
    expect(smokeSource).toContain('ctx.tools.execute({')
    expect(smokeSource).toContain("name: 'toolchain_target_resolve'")
    expect(smokeSource).toContain("name: 'toolchain_contract_search'")
    expect(smokeSource).toContain("name: 'toolchain_contract_inspect'")
    expect(smokeSource).toContain("contractId: 'package:@deepseek-ai/dsh'")
    expect(smokeSource).toContain("ctx.get('appExit')")
    expect(smokeSource).toContain("'exec', 'dsh', '--profile', DSH_BOOT_PROBE_PROFILE")
  })

  it('accepts only a boot receipt proving target parity and contract search-to-inspect continuity', () => {
    const assertBootProbeOutput = smokeModule.assertBootProbeOutput as (output: string) => void
    const fingerprint = `dsh-target-v2:${'a'.repeat(64)}`
    const contractIndexFingerprint = `dsh-contract-index-v1:${'b'.repeat(64)}`
    const receipt = {
      descriptor: {
        product: 'dsh-toolchain',
        version: '0.0.0',
        protocolVersion: '1',
      },
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
      contractSearch: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        contractIndexFingerprint,
        foundDshPackage: true,
        renderedMatchesValue: true,
      },
      contractInspect: {
        visible: true,
        isError: false,
        status: 'ok',
        snapshotFingerprint: fingerprint,
        contractIndexFingerprint,
        contractId: 'package:@deepseek-ai/dsh',
        renderedMatchesValue: true,
      },
    }

    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify(receipt)}\n`,
    )).not.toThrow()
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        nativeTool: { ...receipt.nativeTool, visible: false },
      })}\n`,
    )).toThrow(/native target tool/i)
    expect(() => assertBootProbeOutput(
      `DSH_TOOLCHAIN_BOOT_PROBE ${JSON.stringify({
        ...receipt,
        contractInspect: {
          ...receipt.contractInspect,
          contractIndexFingerprint: `dsh-contract-index-v1:${'c'.repeat(64)}`,
        },
      })}\n`,
    )).toThrow(/contract inspect/i)
  })
})
