import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { createNodeSha256Port } from '../../src/acquisition/node-sha256.js'
import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import { createFrozenH1ExecutionDefinitionV2 } from './m2-h1-execution-definition-v2.js'
import { finalizeH1CommitmentV2 } from './m2-h1-finalization-v2.js'
import {
  createH1PreregistrationReceiptV2,
  validateH1PreregistrationReceiptV2,
} from './m2-h1-preregistration-receipt-v2.js'
import {
  syntheticH1HiddenDataset,
  syntheticH1ProviderReceipt,
} from './m2-h1-synthetic-fixture-v2.js'

const temporaryRoots: string[] = []
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT_URL = new URL('../../scripts/prepare-m2-h1-preregistration.mjs', import.meta.url)

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-toolchain-h1-preregister-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function loadCommandModule(): Promise<Record<string, unknown>> {
  return import(`${SCRIPT_URL.href}?test=${Math.random()}`) as Promise<Record<string, unknown>>
}

function directRuntime() {
  return Object.freeze({
    createNodeSha256Port,
    canonicalizeEvaluationJson,
    finalizeH1CommitmentV2,
    createFrozenH1ExecutionDefinitionV2,
    createH1PreregistrationReceiptV2,
    validateH1PreregistrationReceiptV2,
  })
}

async function writeInputs(root: string, taskCount = 96) {
  const dataset = path.join(root, 'h1-private.json')
  const providerReceipt = path.join(root, 'provider-probe.json')
  await writeFile(dataset, `${JSON.stringify(syntheticH1HiddenDataset(taskCount))}\n`, 'utf8')
  await writeFile(providerReceipt, `${JSON.stringify(syntheticH1ProviderReceipt())}\n`, 'utf8')
  return { dataset, providerReceipt }
}

describe('M2.3 H1 preregistration operator command', () => {
  it('parses exactly one dataset, provider receipt and output and rejects execution flags', async () => {
    const command = await loadCommandModule()
    const parseArguments = command.parseArguments as (args: readonly string[]) => unknown

    expect(parseArguments([
      '--dataset', '/private/h1.json',
      '--provider-receipt', '/private/provider.json',
      '--output', '/repo/docs/evaluation/m2/h1-preregistration.json',
    ])).toEqual({
      dataset: '/private/h1.json',
      providerReceipt: '/private/provider.json',
      output: '/repo/docs/evaluation/m2/h1-preregistration.json',
    })
    expect(() => parseArguments([])).toThrow(/dataset|provider|output/iu)
    expect(() => parseArguments(['--run'])).toThrow(/run|execution|unknown/iu)
    expect(() => parseArguments([
      '--dataset', '/a', '--dataset', '/b',
      '--provider-receipt', '/p', '--output', '/o',
    ])).toThrow(/dataset/iu)
  })

  it('rejects a hidden dataset path inside the repository before reading it', async () => {
    const command = await loadCommandModule()
    const validatePrivateDatasetPath = command.validatePrivateDatasetPath as (
      datasetPath: string,
      options: { root: string },
    ) => Promise<string>

    const inRepository = path.join(REPOSITORY_ROOT, '.tmp', 'must-never-be-accepted-h1.json')
    await expect(validatePrivateDatasetPath(inRepository, { root: REPOSITORY_ROOT }))
      .rejects.toThrow(/outside|repository|private/iu)
  })

  it('creates only a validated public preregistration receipt from real operator inputs', async () => {
    const command = await loadCommandModule()
    const prepare = command.prepareH1Preregistration as (options: {
      root: string
      dataset: string
      providerReceipt: string
      output: string
      runtime: ReturnType<typeof directRuntime>
    }) => Promise<{ receiptSha256: string; definitionSha256: string; scheduleCount: number }>
    const privateRoot = await temporaryRoot()
    const outputRoot = await temporaryRoot()
    const inputs = await writeInputs(privateRoot)
    const output = path.join(outputRoot, 'h1-preregistration.json')

    const summary = await prepare({
      root: REPOSITORY_ROOT,
      ...inputs,
      output,
      runtime: directRuntime(),
    })

    expect(summary.receiptSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(summary.definitionSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(summary.scheduleCount).toBe(864)

    const serialized = await readFile(output, 'utf8')
    const receipt = JSON.parse(serialized) as Record<string, unknown>
    expect(receipt).toMatchObject({
      status: 'PREREGISTERED',
      hiddenDataset: { taskCount: 96 },
      execution: { scheduleCount: 864, concurrency: 1 },
    })
    expect(serialized).not.toContain(syntheticH1HiddenDataset().tasks[0]!.prompt)
    expect(serialized).not.toContain('successRule')
    expect(serialized).not.toMatch(/Bearer\s+|(?:^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{8,}(?=$|[^A-Za-z0-9_-])/iu)
  })

  it('fails closed on a non-96 hidden dataset and does not create an output file', async () => {
    const command = await loadCommandModule()
    const prepare = command.prepareH1Preregistration as (options: {
      root: string
      dataset: string
      providerReceipt: string
      output: string
      runtime: ReturnType<typeof directRuntime>
    }) => Promise<unknown>
    const privateRoot = await temporaryRoot()
    const outputRoot = await temporaryRoot()
    const inputs = await writeInputs(privateRoot, 95)
    const output = path.join(outputRoot, 'h1-preregistration.json')

    await expect(prepare({
      root: REPOSITORY_ROOT,
      ...inputs,
      output,
      runtime: directRuntime(),
    })).rejects.toThrow(/96|task|dataset|construction/iu)
    await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite an existing public receipt', async () => {
    const command = await loadCommandModule()
    const validateOutputTarget = command.validateOutputTarget as (
      output: string,
      options: { root: string },
    ) => Promise<string>
    const root = await temporaryRoot()
    const output = path.join(root, 'receipt.json')
    await writeFile(output, '{}\n', 'utf8')

    await expect(validateOutputTarget(output, { root: REPOSITORY_ROOT })).rejects.toThrow(/exists|overwrite/iu)
  })

  it('compiles and loads the existing H1 evaluation runtime without network or model execution', async () => {
    const command = await loadCommandModule()
    const compileEvaluationRuntime = command.compileEvaluationRuntime as (root: string) => Promise<string>
    const importRuntime = command.importRuntime as (runtimeRoot: string) => Promise<Record<string, unknown>>

    const runtimeRoot = await compileEvaluationRuntime(REPOSITORY_ROOT)
    try {
      const runtime = await importRuntime(runtimeRoot)
      expect(runtime.finalizeH1CommitmentV2).toBeTypeOf('function')
      expect(runtime.createFrozenH1ExecutionDefinitionV2).toBeTypeOf('function')
      expect(runtime.createH1PreregistrationReceiptV2).toBeTypeOf('function')
      expect(runtime.validateH1PreregistrationReceiptV2).toBeTypeOf('function')
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true })
    }
  }, 60_000)

  it('does not embed hidden-task material or provider credentials in the operator script', async () => {
    const source = await readFile(fileURLToPath(SCRIPT_URL), 'utf8')
    expect(source).not.toContain('DEEPSEEK_API_KEY')
    expect(source).not.toContain('sk-')
    expect(source).not.toContain('h1-synthetic-001')
  })
})
