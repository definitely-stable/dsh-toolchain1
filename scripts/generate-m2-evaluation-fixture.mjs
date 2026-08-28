#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DSH_PACKAGE = '@deepseek-ai/dsh'
const DSH_VERSION = '0.1.1-rc.2'
const DSH_PROFILE = 'web'
const UPSTREAM_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
const FIXTURE_SCHEMA = 'dsh-toolchain-m2-fixture-v1'
const FIXTURE_VERSION = 'rc2-web-v1'
const CAPTURE_MARKER = 'M2_FIXTURE_CAPTURE '
const GENERATION_POLICY = 'registry-artifact-production-acquisition-v1'
const SANITIZATION_POLICY = 'drop-evidence-location-v1'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const defaultOutput = join(repositoryRoot, 'tests', 'evaluation', 'fixtures', 'm2', FIXTURE_VERSION)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout ?? 480_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `\n${detail}` : ''}`)
  }
  return result.stdout.trim()
}

function sha256Utf8(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stripLocation(evidence) {
  const { location, ...semantic } = evidence
  void location
  return semantic
}

function sanitizeTargetFacts(snapshot) {
  return {
    dsh: { ...snapshot.dsh },
    runtime: { ...snapshot.runtime },
    profile: {
      name: snapshot.profile.name,
      bundles: snapshot.profile.bundles.map(bundle => ({ ...bundle })),
      dependencies: snapshot.profile.dependencies.map(dependency => ({ ...dependency })),
      profilePatchHash: snapshot.profile.profilePatchHash,
      homePatchHash: snapshot.profile.homePatchHash,
      overlayPatchHashes: [...snapshot.profile.overlayPatchHashes],
    },
    ...(snapshot.supportStatus === undefined ? {} : { supportStatus: snapshot.supportStatus }),
    evidence: snapshot.evidence.map(stripLocation),
  }
}

function sanitizeContractFacts(acquired) {
  return {
    contracts: acquired.contracts.map(contract => ({
      ...contract,
      facts: contract.facts.map(fact => ({ ...fact, evidenceIds: [...fact.evidenceIds] })),
      evidenceIds: [...contract.evidenceIds],
    })),
    evidence: acquired.evidence.map(stripLocation),
  }
}

function packageInventory(contracts) {
  return contracts
    .filter(contract => contract.kind === 'package')
    .map(contract => {
      const version = contract.facts.find(fact => fact.key === 'version')?.value
      if (typeof version !== 'string' || version.length === 0) {
        throw new Error(`M2 fixture package ${contract.id} has no exact version fact`)
      }
      return { name: contract.name, version }
    })
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

async function loadProductionModules() {
  const [targetModule, contractModule, digestModule, kernelModule] = await Promise.all([
    import(pathToFileURL(join(repositoryRoot, 'lib', 'acquisition', 'dsh-filesystem.js')).href),
    import(pathToFileURL(join(repositoryRoot, 'lib', 'acquisition', 'dsh-contract-filesystem.js')).href),
    import(pathToFileURL(join(repositoryRoot, 'lib', 'acquisition', 'node-sha256.js')).href),
    import(pathToFileURL(join(repositoryRoot, 'lib', 'kernel', 'index.js')).href),
  ])
  const contractModel = await import(pathToFileURL(join(repositoryRoot, 'lib', 'model', 'contract.js')).href)
  return {
    createDshFilesystemTargetAcquisition: targetModule.createDshFilesystemTargetAcquisition,
    createDshContractFilesystemAcquisition: contractModule.createDshContractFilesystemAcquisition,
    createNodeSha256Port: digestModule.createNodeSha256Port,
    createApplicationKernel: kernelModule.createApplicationKernel,
    createContractIndex: contractModel.createContractIndex,
  }
}

async function acquireOne(modules, label) {
  const root = await mkdtemp(join(tmpdir(), `dsh-toolchain-m2-${label}-`))
  const runner = join(root, 'runner')
  const dshHome = join(root, 'dsh-home')
  const env = {
    ...process.env,
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    DSH_HOME: dshHome,
  }

  try {
    await mkdir(runner, { recursive: true })
    await writeFile(join(runner, 'package.json'), '{"private":true}\n')
    run('pnpm', ['add', '--save-exact', '--ignore-scripts', `${DSH_PACKAGE}@${DSH_VERSION}`], {
      cwd: runner,
      env,
    })
    run('pnpm', ['exec', 'dsh', '--profile', DSH_PROFILE, '--dump-config'], {
      cwd: runner,
      env,
      timeout: 180_000,
    })

    const dshPackageRoot = join(runner, 'node_modules', '@deepseek-ai', 'dsh')
    const digest = modules.createNodeSha256Port()
    const targetAcquisition = modules.createDshFilesystemTargetAcquisition({ digest, env })
    const contractAcquisition = modules.createDshContractFilesystemAcquisition({ digest })
    const kernel = modules.createApplicationKernel({
      targetAcquisition,
      contractAcquisition,
      digest,
      now: () => '1970-01-01T00:00:00.000Z',
    })
    const request = { profile: DSH_PROFILE, dshHome, dshPackageRoot }
    const { snapshot } = await kernel.resolveTarget(request)
    assert.equal(snapshot.dsh.name, DSH_PACKAGE)
    assert.equal(snapshot.dsh.version, DSH_VERSION)
    assert.equal(snapshot.profile.name, DSH_PROFILE)

    const acquired = await contractAcquisition.acquire(snapshot)
    const rawIndex = await modules.createContractIndex(
      snapshot.fingerprint,
      acquired.evidence,
      acquired.contracts,
      digest,
    )
    const targetFacts = sanitizeTargetFacts(snapshot)
    const contractFacts = sanitizeContractFacts(acquired)
    const sanitizedIndex = await modules.createContractIndex(
      snapshot.fingerprint,
      contractFacts.evidence,
      contractFacts.contracts,
      digest,
    )
    assert.equal(
      sanitizedIndex.fingerprint,
      rawIndex.fingerprint,
      'Removing non-semantic evidence locations changed the Contract Index identity',
    )

    const lockfile = await readFile(join(runner, 'pnpm-lock.yaml'), 'utf8')
    return {
      targetFacts,
      contractFacts,
      targetFingerprint: snapshot.fingerprint,
      contractIndexFingerprint: rawIndex.fingerprint,
      lockfileSha256: sha256Utf8(lockfile),
      packages: packageInventory(contractFacts.contracts),
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function toolchainCommit() {
  const fromEnvironment = process.env.GITHUB_SHA?.trim()
  if (fromEnvironment) return fromEnvironment
  return run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, timeout: 30_000 })
}

async function createFixture() {
  const modules = await loadProductionModules()
  const first = await acquireOne(modules, 'a')
  const second = await acquireOne(modules, 'b')

  assert.equal(second.targetFingerprint, first.targetFingerprint, 'Equivalent Web targets produced different target fingerprints')
  assert.equal(second.contractIndexFingerprint, first.contractIndexFingerprint, 'Equivalent Web targets produced different index fingerprints')
  assert.deepEqual(second.targetFacts, first.targetFacts, 'Sanitized target facts depend on the temporary root')
  assert.deepEqual(second.contractFacts, first.contractFacts, 'Sanitized contract facts depend on the temporary root')
  assert.deepEqual(second.packages, first.packages, 'Resolved contract package inventory depends on the temporary root')

  const generatedAt = process.env.M2_FIXTURE_GENERATED_AT?.trim() || new Date().toISOString()
  const manifest = {
    schema: FIXTURE_SCHEMA,
    fixtureVersion: FIXTURE_VERSION,
    generatedAt,
    canonicalTarget: {
      package: DSH_PACKAGE,
      version: DSH_VERSION,
      profile: DSH_PROFILE,
      upstreamDocumentationCommit: UPSTREAM_COMMIT,
    },
    generator: {
      toolchainCommit: await toolchainCommit(),
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      pnpmVersion: run('pnpm', ['--version'], { cwd: repositoryRoot, timeout: 30_000 }),
      generationPolicy: GENERATION_POLICY,
      sanitizationPolicy: SANITIZATION_POLICY,
    },
    source: {
      lockfileSha256: first.lockfileSha256,
    },
    expected: {
      targetFingerprint: first.targetFingerprint,
      contractIndexFingerprint: first.contractIndexFingerprint,
      contractCount: first.contractFacts.contracts.length,
      evidenceCount: first.contractFacts.evidence.length,
    },
    packages: first.packages,
  }
  return { manifest, targetFacts: first.targetFacts, contractFacts: first.contractFacts }
}

async function writeFixture(outputDirectory, fixture) {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(fixture.manifest, undefined, 2)}\n`),
    writeFile(join(outputDirectory, 'target-facts.json'), `${JSON.stringify(fixture.targetFacts, undefined, 2)}\n`),
    writeFile(join(outputDirectory, 'contract-facts.json'), `${JSON.stringify(fixture.contractFacts, undefined, 2)}\n`),
  ])
}

async function main() {
  const stdout = process.argv.includes('--stdout')
  const outputArgument = process.argv.find(argument => argument.startsWith('--output='))
  const outputDirectory = outputArgument === undefined
    ? defaultOutput
    : resolve(repositoryRoot, outputArgument.slice('--output='.length))
  const fixture = await createFixture()
  if (stdout) {
    process.stdout.write(`${CAPTURE_MARKER}${Buffer.from(JSON.stringify(fixture), 'utf8').toString('base64')}\n`)
    return
  }
  await writeFixture(outputDirectory, fixture)
  process.stdout.write(
    `M2 fixture ${fixture.manifest.fixtureVersion}: ${fixture.manifest.expected.targetFingerprint} / ${fixture.manifest.expected.contractIndexFingerprint} / ${fixture.manifest.expected.contractCount} contracts\n`,
  )
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (invokedAsScript) await main()
