import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const temporaryRoots: string[] = []
const SCRIPT = fileURLToPath(new URL('../../scripts/run-m2-p0.mjs', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-p0-command-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function loadCommandModule(): Promise<Record<string, unknown>> {
  return import(`${new URL('../../scripts/run-m2-p0.mjs', import.meta.url).href}?test=${Math.random()}`) as Promise<Record<string, unknown>>
}

function completeEnvironment(overrides: Readonly<Record<string, string | undefined>> = {}): Record<string, string | undefined> {
  return {
    DEEPSEEK_API_KEY: 'sk-command-boundary-secret',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_REQUEST_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_REVIEWED_SNAPSHOT: 'DeepSeek-V4-Pro-0813',
    DEEPSEEK_EXPECTED_RESPONSE_MODEL: 'deepseek-v4-pro',
    DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT: 'fp_p0_v4_0813_reviewed',
    DEEPSEEK_THINKING: 'enabled',
    DEEPSEEK_REASONING_EFFORT: 'high',
    ...overrides,
  }
}

describe('M2.3 explicit P0 calibration command boundary', () => {
  it('parses exactly one P0 output path and rejects missing, duplicate, H1 or unknown arguments', async () => {
    const command = await loadCommandModule()
    const parseArguments = command.parseArguments as (args: readonly string[]) => unknown

    expect(parseArguments(['--output', '/tmp/p0.json'])).toEqual({ output: '/tmp/p0.json', overwriteInconclusive: false })
    expect(parseArguments(['--output', '/tmp/p0.json', '--overwrite-inconclusive'])).toEqual({ output: '/tmp/p0.json', overwriteInconclusive: true })
    expect(() => parseArguments([])).toThrow(/--output/u)
    expect(() => parseArguments(['--output', '/a', '--output', '/b'])).toThrow(/output/u)
    expect(() => parseArguments(['--phase', 'H1', '--output', '/tmp/p0.json'])).toThrow(/P0|H1/u)
    expect(() => parseArguments(['--unknown', '--output', '/tmp/p0.json'])).toThrow(/unknown/u)
  })

  it('validates complete non-secret provider identity before any model process can start', async () => {
    const command = await loadCommandModule()
    const readProviderConfiguration = command.readProviderConfiguration as (environment: NodeJS.ProcessEnv) => unknown

    expect(() => readProviderConfiguration(completeEnvironment({ DEEPSEEK_API_KEY: undefined }) as NodeJS.ProcessEnv)).toThrow(/DEEPSEEK_API_KEY/u)
    expect(() => readProviderConfiguration(completeEnvironment({ DEEPSEEK_REVIEWED_SNAPSHOT: undefined }) as NodeJS.ProcessEnv)).toThrow(/REVIEWED_SNAPSHOT/u)
    expect(() => readProviderConfiguration(completeEnvironment({ DEEPSEEK_EXPECTED_SYSTEM_FINGERPRINT: undefined }) as NodeJS.ProcessEnv)).toThrow(/SYSTEM_FINGERPRINT/u)
    expect(() => readProviderConfiguration(completeEnvironment({ DEEPSEEK_THINKING: 'maybe' }) as NodeJS.ProcessEnv)).toThrow(/THINKING/u)

    const configuration = readProviderConfiguration(completeEnvironment() as NodeJS.ProcessEnv) as Record<string, unknown>
    expect(configuration).toMatchObject({
      requestModel: 'deepseek-v4-pro',
      reviewedSnapshot: 'DeepSeek-V4-Pro-0813',
      expectedResponseModel: 'deepseek-v4-pro',
      expectedSystemFingerprint: 'fp_p0_v4_0813_reviewed',
      thinking: 'enabled',
      reasoningEffort: 'high',
      baseUrl: 'https://api.deepseek.com',
      adapterVersion: 'deepseek-chat-v1',
    })
    expect(JSON.stringify(configuration)).not.toContain('sk-command-boundary-secret')
  })

  it('refuses unsafe output locations and protects existing terminal evidence', async () => {
    const command = await loadCommandModule()
    const validateOutputTarget = command.validateOutputTarget as (
      output: string,
      options: { root: string; overwriteInconclusive: boolean },
    ) => Promise<string>
    const root = await temporaryRoot()
    const srcOutput = path.join(root, 'src', 'p0.json')
    const libOutput = path.join(root, 'lib', 'p0.json')
    const resultOutput = path.join(root, 'evidence', 'p0.json')

    await expect(validateOutputTarget(srcOutput, { root, overwriteInconclusive: false })).rejects.toThrow(/src|distribution/u)
    await expect(validateOutputTarget(libOutput, { root, overwriteInconclusive: false })).rejects.toThrow(/lib|distribution/u)

    await mkdir(path.dirname(resultOutput), { recursive: true })
    await writeFile(resultOutput, JSON.stringify({ status: 'CALIBRATED' }), 'utf8')
    await expect(validateOutputTarget(resultOutput, { root, overwriteInconclusive: false })).rejects.toThrow(/exists/u)
    await expect(validateOutputTarget(resultOutput, { root, overwriteInconclusive: true })).rejects.toThrow(/CALIBRATED|INCONCLUSIVE/u)

    await writeFile(resultOutput, JSON.stringify({ status: 'INCONCLUSIVE' }), 'utf8')
    await expect(validateOutputTarget(resultOutput, { root, overwriteInconclusive: true })).resolves.toBe(path.resolve(resultOutput))
  })

  it('writes canonical JSON atomically without leaving the temporary sibling behind', async () => {
    const command = await loadCommandModule()
    const writeCanonicalResult = command.writeCanonicalResult as (output: string, value: unknown) => Promise<{ sha256: string }>
    const root = await temporaryRoot()
    const output = path.join(root, 'p0-result.json')

    const receipt = await writeCanonicalResult(output, { z: 2, a: 1 })
    expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(await readFile(output, 'utf8')).toBe('{"a":1,"z":2}\n')
  })

  it('compiles and loads the real evaluation-only P0 runtime without adding a runtime dependency', async () => {
    const command = await loadCommandModule()
    const compileEvaluationRuntime = command.compileEvaluationRuntime as (root: string) => Promise<string>
    const importRuntime = command.importRuntime as (runtimeRoot: string) => Promise<Record<string, unknown>>

    const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
    try {
      const runtime = await importRuntime(runtimeRoot)
      expect(runtime.createFrozenP0Inputs).toBeTypeOf('function')
      expect(runtime.executeFrozenP0).toBeTypeOf('function')
      expect(runtime.validateAgentV2ResultAgainstDefinition).toBeTypeOf('function')
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true })
    }
  }, 60_000)

  it('exists as an explicit manual node entry point and never embeds a provider credential', async () => {
    const source = await readFile(SCRIPT, 'utf8')
    expect(source).toContain('node')
    expect(source).toContain('DEEPSEEK_API_KEY')
    expect(source).not.toContain('sk-command-boundary-secret')
  })
})