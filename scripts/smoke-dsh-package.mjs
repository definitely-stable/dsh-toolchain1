#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const DSH_SMOKE_VERSION = '0.1.1-rc.2'
export const DSH_BOOT_PROBE_PROFILE = 'toolchain-smoke'
export const DSH_LIVE_BOOT_PROBE_PROFILE = 'web'
export const DSH_SMOKE_PROFILES = Object.freeze([
  Object.freeze({
    name: DSH_BOOT_PROBE_PROFILE,
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base']),
  }),
  Object.freeze({
    name: DSH_LIVE_BOOT_PROBE_PROFILE,
    requiredBundles: Object.freeze(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']),
  }),
])

const BOOT_PROBE_PACKAGE = 'dsh-toolchain-smoke-probe'
const BOOT_PROBE_MARKER = 'DSH_TOOLCHAIN_BOOT_PROBE '
const EXPECTED_DESCRIPTOR = Object.freeze({
  product: 'dsh-toolchain',
  version: '0.0.0',
  protocolVersion: '1',
})
const TARGET_FINGERPRINT = /^dsh-target-v2:[0-9a-f]{64}$/
const CONTRACT_INDEX_FINGERPRINT = /^dsh-contract-index-v1:[0-9a-f]{64}$/
const WEB_CONTRACT_ID = 'package:@deepseek-ai/dsh-tools'
const WEB_CONTRACT_QUERY = 'ToolDefinition'
const RUNTIME_TOOL_CONTRACT_ID = 'tool:host:toolchain_target_resolve'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 300_000,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    cwd: options.cwd,
    env: options.env,
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    const detail = [stdout, stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }

  return typeof result.stdout === 'string' ? result.stdout : ''
}

function parseJsonCommand(label, output) {
  try {
    return JSON.parse(output)
  } catch (cause) {
    throw new Error(`DSH smoke: ${label} did not emit Protocol JSON`, { cause })
  }
}

export function assertProfileManifest(manifest, requiredBundles = []) {
  const bundles = manifest?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes('dsh-toolchain')) {
    throw new Error('DSH smoke: profile manifest did not register dsh-toolchain as a bundle')
  }
  for (const requiredBundle of requiredBundles) {
    if (!bundles.includes(requiredBundle)) {
      throw new Error(`DSH smoke: profile manifest is missing required bundle ${requiredBundle}`)
    }
  }
  if (manifest?.dependencies?.['dsh-toolchain'] === undefined) {
    throw new Error('DSH smoke: profile manifest did not record dsh-toolchain as a dependency')
  }
}

export function assertDumpConfig(dump) {
  if (!dump.includes('dsh-toolchain')) {
    throw new Error('DSH smoke: composed config does not name the dsh-toolchain bundle layer')
  }
  if (!/\n\s*- id: dsh-toolchain\n/.test(dump)) {
    throw new Error('DSH smoke: composed config does not contain the dsh-toolchain row')
  }
  if (!dump.includes("name: 'dsh-toolchain/dsh'") && !dump.includes('name: dsh-toolchain/dsh')) {
    throw new Error('DSH smoke: composed config does not mount dsh-toolchain/dsh')
  }
}

export function assertWebContractIntelligence(search, inspect) {
  if (
    search?.status !== 'ok'
    || typeof search.snapshotFingerprint !== 'string'
    || !TARGET_FINGERPRINT.test(search.snapshotFingerprint)
    || typeof search?.data?.contractIndexFingerprint !== 'string'
    || !CONTRACT_INDEX_FINGERPRINT.test(search.data.contractIndexFingerprint)
  ) {
    throw new Error(`DSH smoke: Web contract search did not resolve an exact index ${JSON.stringify(search)}`)
  }

  const match = search.data.matches?.find(candidate => candidate.id === WEB_CONTRACT_ID)
  if (match === undefined || !Array.isArray(match.evidenceIds) || match.evidenceIds.length === 0) {
    throw new Error(`DSH smoke: Web contract search did not find ${WEB_CONTRACT_QUERY} in ${WEB_CONTRACT_ID}`)
  }

  if (
    inspect?.status !== 'ok'
    || inspect.snapshotFingerprint !== search.snapshotFingerprint
    || inspect?.data?.contractIndexFingerprint !== search.data.contractIndexFingerprint
    || inspect?.data?.contract?.id !== WEB_CONTRACT_ID
  ) {
    throw new Error(`DSH smoke: Web contract inspect did not preserve target/index continuity ${JSON.stringify(inspect)}`)
  }

  const toolDefinition = inspect.data.contract.facts?.find(fact =>
    fact.key === 'declaration-export' && fact.value === WEB_CONTRACT_QUERY)
  if (toolDefinition === undefined || !Array.isArray(toolDefinition.evidenceIds) || toolDefinition.evidenceIds.length === 0) {
    throw new Error(`DSH smoke: Web inspect did not expose declaration-export ${WEB_CONTRACT_QUERY}`)
  }

  const evidence = new Map((inspect.data.evidence ?? []).map(item => [item.id, item]))
  const supporting = toolDefinition.evidenceIds.map(id => evidence.get(id))
  if (supporting.some(item => item === undefined)) {
    throw new Error('DSH smoke: Web ToolDefinition fact references evidence omitted by inspect')
  }
  if (!supporting.some(item =>
    item?.kind === 'type-declaration'
    && typeof item.source === 'string'
    && item.source.startsWith('@deepseek-ai/dsh-tools/'))
  ) {
    throw new Error('DSH smoke: Web ToolDefinition fact lacks exact @deepseek-ai/dsh-tools declaration evidence')
  }
}

function verifyWebContractIntelligence(profileDir, home, dshPackageRoot, env) {
  const targetArgs = [
    '--profile', DSH_LIVE_BOOT_PROBE_PROFILE,
    '--dsh-home', home,
    '--dsh-package-root', dshPackageRoot,
  ]
  const search = parseJsonCommand('Web contract search', run('pnpm', [
    'exec', 'dsh-toolchain', 'contract', 'search',
    ...targetArgs,
    '--query', WEB_CONTRACT_QUERY,
    '--kind', 'package',
    '--limit', '5',
  ], {
    cwd: profileDir,
    env,
    capture: true,
    timeout: 180_000,
  }))

  const contractIndexFingerprint = search?.data?.contractIndexFingerprint
  if (typeof contractIndexFingerprint !== 'string') {
    throw new Error(`DSH smoke: Web contract search omitted index fingerprint ${JSON.stringify(search)}`)
  }

  const inspect = parseJsonCommand('Web contract inspect', run('pnpm', [
    'exec', 'dsh-toolchain', 'contract', 'inspect',
    ...targetArgs,
    '--contract-index', contractIndexFingerprint,
    '--contract-id', WEB_CONTRACT_ID,
  ], {
    cwd: profileDir,
    env,
    capture: true,
    timeout: 180_000,
  }))

  assertWebContractIntelligence(search, inspect)
}

export async function createBootProbePackage(root, options = {}) {
  const packageName = options.packageName ?? BOOT_PROBE_PACKAGE
  const includeInspectProviders = options.includeInspectProviders === true
  const probe = join(root, packageName)
  await mkdir(probe, { recursive: true })
  await writeFile(join(probe, 'package.json'), JSON.stringify({
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: './probe.mjs',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2) + '\n')

  const rows = [
    ...(includeInspectProviders
      ? ["    - id: dsh-toolchain-smoke-cordis\n      name: '@deepseek-ai/dsh-tool-cordis'"]
      : []),
    `    - id: ${packageName}\n      name: ${packageName}`,
  ]
  await writeFile(join(probe, 'cordis.patch.yml'), `- insert:\n${rows.join('\n')}\n`)

  await writeFile(join(probe, 'probe.mjs'), `const RUNTIME_TOOL_CONTRACT_ID = ${JSON.stringify(RUNTIME_TOOL_CONTRACT_ID)}
const COMPACT_INSPECT_REPRESENTATION = 'dsh-contract-inspect-compact-v1'

function renderedMatchesValue(result) {
  if (result?.isError) return false
  const rendered = result?.content?.find(block => block.type === 'text')
  if (rendered?.type !== 'text') return false
  try {
    return JSON.stringify(JSON.parse(rendered.text)) === JSON.stringify(result.value)
  } catch {
    return false
  }
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength
}

function jsonEquivalent(left, right) {
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, child]) => [key, normalize(child)]),
    )
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function expandCompactInspect(rendered) {
  if (rendered?.representation !== COMPACT_INSPECT_REPRESENTATION) return rendered

  const table = rendered?.data?.evidenceByRef
  const contract = rendered?.data?.contract
  if (table === null || typeof table !== 'object' || contract === null || typeof contract !== 'object') {
    throw new Error('Compact Inspect representation is missing evidence table or contract')
  }

  function evidenceIds(refs) {
    if (!Array.isArray(refs)) throw new Error('Compact Inspect evidence refs must be an array')
    return refs.map((ref) => {
      const evidence = table[ref]
      if (evidence === undefined || typeof evidence?.id !== 'string') {
        throw new Error('Compact Inspect evidence ref is not resolvable: ' + String(ref))
      }
      return evidence.id
    })
  }

  return {
    protocolVersion: '1',
    requestId: rendered.requestId,
    snapshotFingerprint: rendered.snapshotFingerprint,
    status: 'ok',
    data: {
      contractIndexFingerprint: rendered.data.contractIndexFingerprint,
      contract: {
        id: contract.id,
        kind: contract.kind,
        name: contract.name,
        qualifiedName: contract.qualifiedName,
        availability: contract.availability,
        ...(contract.summary === undefined ? {} : { summary: contract.summary }),
        facts: contract.facts.map(fact => ({
          key: fact.key,
          value: fact.value,
          evidenceIds: evidenceIds(fact.evidenceRefs),
        })),
        evidenceIds: evidenceIds(contract.evidenceRefs),
      },
      evidence: Object.values(table),
    },
    diagnostics: rendered.diagnostics ?? [],
  }
}

function inspectRenderEvidence(result) {
  if (result?.isError) {
    return { roundTripsValue: false, nonRegressing: false, representation: null }
  }
  const rendered = result?.content?.find(block => block.type === 'text')
  if (rendered?.type !== 'text') {
    return { roundTripsValue: false, nonRegressing: false, representation: null }
  }
  try {
    const parsed = JSON.parse(rendered.text)
    const expanded = expandCompactInspect(parsed)
    const canonicalJson = JSON.stringify(result.value)
    return {
      roundTripsValue: jsonEquivalent(expanded, result.value),
      nonRegressing: utf8Bytes(rendered.text) <= utf8Bytes(canonicalJson),
      representation: parsed?.representation === COMPACT_INSPECT_REPRESENTATION
        ? COMPACT_INSPECT_REPRESENTATION
        : 'protocol-v1',
    }
  } catch {
    return { roundTripsValue: false, nonRegressing: false, representation: null }
  }
}

function hasRuntimeToolEvidence(response) {
  return response?.data?.evidence?.some(item =>
    item.kind === 'runtime' && item.source === 'cordis-inspect:host/Tool/listTools') === true
}

export function apply(rootCtx) {
  rootCtx.inject(['toolchain', 'tools', 'agentLoop', 'agents'], (ctx) => {
    const appExit = ctx.get('appExit')
    if (typeof appExit !== 'function') throw new Error('DSH boot probe requires launcher-owned ctx.appExit')

    Promise.resolve().then(async () => {
      const dshHome = process.env.DSH_HOME
      const dshPackageRoot = process.env.DSH_TOOLCHAIN_SMOKE_DSH_ROOT
      const profile = process.env.DSH_TOOLCHAIN_SMOKE_PROFILE
      if (!dshHome || !dshPackageRoot || !profile) {
        throw new Error('DSH boot probe requires target acquisition environment and profile identity')
      }

      const request = { profile, dshHome, dshPackageRoot }
      const descriptor = ctx.toolchain.describe()
      const service = await ctx.toolchain.resolveTarget(request, 'dsh-smoke-service')
      const agent = ctx.agentLoop.create('dsh-toolchain-smoke-agent-' + profile)
      const schemas = ctx.tools.schemas(agent)
      const targetVisible = schemas.some(schema => schema.name === 'toolchain_target_resolve')
      const contractSearchVisible = schemas.some(schema => schema.name === 'toolchain_contract_search')
      const contractInspectVisible = schemas.some(schema => schema.name === 'toolchain_contract_inspect')

      const nativeResult = await ctx.tools.execute({
        callId: 'dsh-toolchain-smoke-native',
        name: 'toolchain_target_resolve',
        arguments: request,
        agent,
        signal: new AbortController().signal,
      })

      const searchRequest = {
        target: request,
        query: 'toolchain_target_resolve',
        kinds: ['tool'],
        limit: 5,
      }
      const offlineSearch = await ctx.toolchain.searchContracts(searchRequest, 'dsh-smoke-offline-contract-search')
      if (offlineSearch.status !== 'ok') {
        throw new Error('DSH offline contract search failed: ' + JSON.stringify(offlineSearch))
      }

      const contractSearchResult = await ctx.tools.execute({
        callId: 'dsh-toolchain-smoke-contract-search',
        name: 'toolchain_contract_search',
        arguments: searchRequest,
        agent,
        signal: new AbortController().signal,
      })
      const contractIndexFingerprint = contractSearchResult.isError
        ? undefined
        : contractSearchResult.value?.data?.contractIndexFingerprint
      if (typeof contractIndexFingerprint !== 'string') {
        throw new Error('DSH contract search did not return a contract index fingerprint: ' + JSON.stringify(contractSearchResult))
      }

      const foundRuntimeTool = contractSearchResult.isError
        ? false
        : contractSearchResult.value?.data?.matches?.some(match => match.id === RUNTIME_TOOL_CONTRACT_ID) === true
      const contractInspectResult = foundRuntimeTool
        ? await ctx.tools.execute({
            callId: 'dsh-toolchain-smoke-contract-inspect',
            name: 'toolchain_contract_inspect',
            arguments: {
              target: request,
              contractIndexFingerprint,
              contractId: 'tool:host:toolchain_target_resolve',
            },
            agent,
            signal: new AbortController().signal,
          })
        : undefined
      const contractInspectRender = contractInspectResult === undefined
        ? null
        : inspectRenderEvidence(contractInspectResult)

      const receipt = {
        profile,
        descriptor,
        agent: {
          id: String(agent.id),
          registered: ctx.agents.get(agent.id) === agent,
        },
        inspectProviderAvailable: ctx.get('cordisInspect') !== undefined,
        service: {
          status: service.status,
          snapshotFingerprint: service.snapshotFingerprint,
        },
        nativeTool: {
          visible: targetVisible,
          isError: nativeResult.isError,
          status: nativeResult.isError ? undefined : nativeResult.value?.status,
          snapshotFingerprint: nativeResult.isError ? undefined : nativeResult.value?.snapshotFingerprint,
          renderedMatchesValue: renderedMatchesValue(nativeResult),
        },
        offlineSearch: {
          status: offlineSearch.status,
          contractIndexFingerprint: offlineSearch.data.contractIndexFingerprint,
          foundRuntimeTool: offlineSearch.data.matches.some(match => match.id === RUNTIME_TOOL_CONTRACT_ID),
        },
        contractSearch: {
          visible: contractSearchVisible,
          isError: contractSearchResult.isError,
          status: contractSearchResult.isError ? undefined : contractSearchResult.value?.status,
          snapshotFingerprint: contractSearchResult.isError ? undefined : contractSearchResult.value?.snapshotFingerprint,
          contractIndexFingerprint,
          foundRuntimeTool,
          runtimeEvidence: contractSearchResult.isError ? false : hasRuntimeToolEvidence(contractSearchResult.value),
          renderedMatchesValue: renderedMatchesValue(contractSearchResult),
        },
        contractInspect: contractInspectResult === undefined
          ? null
          : {
              visible: contractInspectVisible,
              isError: contractInspectResult.isError,
              status: contractInspectResult.isError ? undefined : contractInspectResult.value?.status,
              snapshotFingerprint: contractInspectResult.isError ? undefined : contractInspectResult.value?.snapshotFingerprint,
              contractIndexFingerprint: contractInspectResult.isError
                ? undefined
                : contractInspectResult.value?.data?.contractIndexFingerprint,
              contractId: contractInspectResult.isError ? undefined : contractInspectResult.value?.data?.contract?.id,
              availability: contractInspectResult.isError ? undefined : contractInspectResult.value?.data?.contract?.availability,
              runtimeEvidence: contractInspectResult.isError ? false : hasRuntimeToolEvidence(contractInspectResult.value),
              renderedRoundTripsValue: contractInspectRender?.roundTripsValue ?? false,
              renderedNonRegressing: contractInspectRender?.nonRegressing ?? false,
              renderedRepresentation: contractInspectRender?.representation ?? null,
            },
      }
      process.stdout.write(${JSON.stringify(BOOT_PROBE_MARKER)} + JSON.stringify(receipt) + '\\n')
      appExit(0)
    }).catch((error) => {
      process.stderr.write('DSH_TOOLCHAIN_BOOT_PROBE_ERROR ' + String(error?.stack ?? error) + '\\n')
      appExit(1)
    })
  })
}
`)
  return probe
}

export function assertBootProbeOutput(output, options = {}) {
  const line = output
    .split(/\r?\n/)
    .find(candidate => candidate.startsWith(BOOT_PROBE_MARKER))
  if (line === undefined) {
    throw new Error('DSH smoke: real boot did not emit a Toolchain target/contract receipt')
  }

  let receipt
  try {
    receipt = JSON.parse(line.slice(BOOT_PROBE_MARKER.length))
  } catch (cause) {
    throw new Error('DSH smoke: boot probe emitted an invalid target/contract receipt', { cause })
  }

  const profile = options.profile
  const expectLive = options.expectLive === true
  if (typeof profile !== 'string' || receipt?.profile !== profile) {
    throw new Error(`DSH smoke: boot probe target profile mismatch ${JSON.stringify(receipt?.profile)}`)
  }
  if (JSON.stringify(receipt?.descriptor) !== JSON.stringify(EXPECTED_DESCRIPTOR)) {
    throw new Error(`DSH smoke: boot probe observed unexpected descriptor ${JSON.stringify(receipt?.descriptor)}`)
  }
  if (typeof receipt?.agent?.id !== 'string' || receipt.agent.registered !== true) {
    throw new Error(`DSH smoke: real DSH Agent was not registered ${JSON.stringify(receipt?.agent)}`)
  }
  if (
    receipt?.service?.status !== 'ok'
    || typeof receipt.service.snapshotFingerprint !== 'string'
    || !TARGET_FINGERPRINT.test(receipt.service.snapshotFingerprint)
  ) {
    throw new Error(`DSH smoke: Toolchain Service did not resolve an exact target ${JSON.stringify(receipt?.service)}`)
  }
  if (
    receipt?.nativeTool?.visible !== true
    || receipt.nativeTool.isError !== false
    || receipt.nativeTool.status !== 'ok'
    || typeof receipt.nativeTool.snapshotFingerprint !== 'string'
    || !TARGET_FINGERPRINT.test(receipt.nativeTool.snapshotFingerprint)
    || receipt.nativeTool.renderedMatchesValue !== true
  ) {
    throw new Error(`DSH smoke: native target tool was not visible/executable ${JSON.stringify(receipt?.nativeTool)}`)
  }
  if (receipt.nativeTool.snapshotFingerprint !== receipt.service.snapshotFingerprint) {
    throw new Error('DSH smoke: Service and native target tool resolved different target fingerprints')
  }

  if (
    receipt?.offlineSearch?.status !== 'ok'
    || typeof receipt.offlineSearch.contractIndexFingerprint !== 'string'
    || !CONTRACT_INDEX_FINGERPRINT.test(receipt.offlineSearch.contractIndexFingerprint)
    || receipt.offlineSearch.foundRuntimeTool !== false
  ) {
    throw new Error(`DSH smoke: offline Contract baseline unexpectedly contains live Tool evidence ${JSON.stringify(receipt?.offlineSearch)}`)
  }

  if (
    receipt?.contractSearch?.visible !== true
    || receipt.contractSearch.isError !== false
    || receipt.contractSearch.status !== 'ok'
    || typeof receipt.contractSearch.snapshotFingerprint !== 'string'
    || !TARGET_FINGERPRINT.test(receipt.contractSearch.snapshotFingerprint)
    || receipt.contractSearch.snapshotFingerprint !== receipt.service.snapshotFingerprint
    || typeof receipt.contractSearch.contractIndexFingerprint !== 'string'
    || !CONTRACT_INDEX_FINGERPRINT.test(receipt.contractSearch.contractIndexFingerprint)
    || receipt.contractSearch.renderedMatchesValue !== true
  ) {
    throw new Error(`DSH smoke: native Contract search was not visible/executable ${JSON.stringify(receipt?.contractSearch)}`)
  }

  if (!expectLive) {
    if (
      receipt.inspectProviderAvailable !== false
      || receipt.contractSearch.foundRuntimeTool !== false
      || receipt.contractSearch.runtimeEvidence !== false
      || receipt.contractSearch.contractIndexFingerprint !== receipt.offlineSearch.contractIndexFingerprint
      || receipt.contractInspect !== null
    ) {
      throw new Error(`DSH smoke: Agent-backed offline fallback diverged without Inspect ${JSON.stringify(receipt)}`)
    }
    return
  }

  if (
    receipt.inspectProviderAvailable !== true
    || receipt.contractSearch.foundRuntimeTool !== true
    || receipt.contractSearch.runtimeEvidence !== true
    || receipt.contractSearch.contractIndexFingerprint === receipt.offlineSearch.contractIndexFingerprint
  ) {
    throw new Error(`DSH smoke: live Contract search did not add Agent-scoped runtime evidence ${JSON.stringify(receipt?.contractSearch)}`)
  }

  if (
    receipt?.contractInspect?.visible !== true
    || receipt.contractInspect.isError !== false
    || receipt.contractInspect.status !== 'ok'
    || typeof receipt.contractInspect.snapshotFingerprint !== 'string'
    || !TARGET_FINGERPRINT.test(receipt.contractInspect.snapshotFingerprint)
    || receipt.contractInspect.snapshotFingerprint !== receipt.service.snapshotFingerprint
    || typeof receipt.contractInspect.contractIndexFingerprint !== 'string'
    || !CONTRACT_INDEX_FINGERPRINT.test(receipt.contractInspect.contractIndexFingerprint)
    || receipt.contractInspect.contractIndexFingerprint !== receipt.contractSearch.contractIndexFingerprint
    || receipt.contractInspect.contractId !== RUNTIME_TOOL_CONTRACT_ID
    || receipt.contractInspect.availability !== 'available'
    || receipt.contractInspect.runtimeEvidence !== true
    || receipt.contractInspect.renderedRoundTripsValue !== true
    || receipt.contractInspect.renderedNonRegressing !== true
    || !['protocol-v1', 'dsh-contract-inspect-compact-v1'].includes(receipt.contractInspect.renderedRepresentation)
  ) {
    throw new Error(`DSH smoke: live Contract inspect did not preserve Agent/index/runtime-evidence/render continuity ${JSON.stringify(receipt?.contractInspect)}`)
  }
}

async function installProbe(runner, profile, probe, env) {
  run('pnpm', [
    'exec', 'dsh', 'plugin', '--profile', profile,
    'add', '--ignore-scripts', probe,
  ], {
    cwd: runner,
    env,
    timeout: 300_000,
  })
}

function runBootProbe(runner, profile, env, expectLive) {
  const appArgs = profile === DSH_LIVE_BOOT_PROBE_PROFILE ? ['--no-open', '--port', '0'] : []
  const output = run('pnpm', [
    'exec', 'dsh', '--profile', profile,
    ...appArgs,
  ], {
    cwd: runner,
    env: { ...env, DSH_TOOLCHAIN_SMOKE_PROFILE: profile },
    capture: true,
    timeout: 120_000,
  })
  assertBootProbeOutput(output, { profile, expectLive })
}

export async function smokeDshPackage(tarballPath, options = {}) {
  const tarball = resolve(tarballPath)
  const version = options.dshVersion ?? DSH_SMOKE_VERSION
  const profiles = options.profiles ?? DSH_SMOKE_PROFILES
  const root = await mkdtemp(join(tmpdir(), 'dsh-toolchain-smoke-'))
  const runner = join(root, 'runner')
  const home = join(root, 'dsh-home')
  const dshPackageRoot = join(runner, 'node_modules', '@deepseek-ai', 'dsh')
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    DSH_HOME: home,
    DSH_TOOLCHAIN_SMOKE_DSH_ROOT: dshPackageRoot,
  }

  try {
    await mkdir(runner, { recursive: true })
    await writeFile(join(runner, 'package.json'), JSON.stringify({ private: true }, undefined, 2) + '\n')

    run('pnpm', ['add', '--save-exact', '--ignore-scripts', `@deepseek-ai/dsh@${version}`], {
      cwd: runner,
      env,
      timeout: 480_000,
    })

    for (const profile of profiles) {
      run('pnpm', [
        'exec', 'dsh', 'plugin', '--profile', profile.name,
        'add', '--ignore-scripts', tarball,
      ], {
        cwd: runner,
        env,
        timeout: 300_000,
      })

      const profileDir = join(home, 'profiles', profile.name)
      const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
      assertProfileManifest(manifest, profile.requiredBundles)

      const dump = run('pnpm', [
        'exec', 'dsh', '--profile', profile.name, '--dump-config',
      ], {
        cwd: runner,
        env,
        capture: true,
        timeout: 120_000,
      })
      assertDumpConfig(dump)
    }

    if (profiles.some(profile => profile.name === DSH_LIVE_BOOT_PROBE_PROFILE)) {
      verifyWebContractIntelligence(
        join(home, 'profiles', DSH_LIVE_BOOT_PROBE_PROFILE),
        home,
        dshPackageRoot,
        env,
      )
    }

    if (profiles.some(profile => profile.name === DSH_BOOT_PROBE_PROFILE)) {
      const negativeProbe = await createBootProbePackage(root, {
        packageName: `${BOOT_PROBE_PACKAGE}-offline`,
      })
      await installProbe(runner, DSH_BOOT_PROBE_PROFILE, negativeProbe, env)
      runBootProbe(runner, DSH_BOOT_PROBE_PROFILE, env, false)
    }

    if (profiles.some(profile => profile.name === DSH_LIVE_BOOT_PROBE_PROFILE)) {
      const liveProbe = await createBootProbePackage(root, {
        packageName: `${BOOT_PROBE_PACKAGE}-live`,
        includeInspectProviders: true,
      })
      await installProbe(runner, DSH_LIVE_BOOT_PROBE_PROFILE, liveProbe, env)
      runBootProbe(runner, DSH_LIVE_BOOT_PROBE_PROFILE, env, true)
    }

    process.stdout.write(
      `DSH package smoke: ${version} profiles ${profiles.map(profile => profile.name).join(', ')} composition + clean Web ToolDefinition contract search/inspect + Agent-backed missing-Inspect fallback + exact-target live Host Tool Inspect search/inspect verified\n`,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const tarballPath = process.argv[2]
  if (!tarballPath) {
    process.stderr.write('usage: node scripts/smoke-dsh-package.mjs <package.tgz>\n')
    process.exitCode = 2
    return
  }
  await smokeDshPackage(tarballPath)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (invokedAsScript) await main()
