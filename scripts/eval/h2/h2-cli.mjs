#!/usr/bin/env node
/**
 * H2 confirmatory product benchmark CLI.
 *
 * Deterministic commands (`validate`, `freeze`, `finalize`, `author-check`,
 * `corpus-build`, `commitment`) spend zero model tokens. Model-backed
 * commands (`dry-run`, `run`) require an explicit operator flag, a valid
 * FROZEN preregistration receipt, and (for `run`) a passing technical
 * dry-run receipt.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { createDisposableCoordinates, buildDisposableEnvironment, ensureDisposableCoordinates } from '../safety/disposable-environment.mjs'
import { assertDeletableTarget, createOwnedTree, removeOwnedTree, resolveProtectedRoots } from '../safety/owned-tree.mjs'
import { H2_POLICY, H2_STRATA, assertH2PolicyIntegrity } from './h2-config.mjs'
import { assertCommitmentRecord, buildCommitmentRecord } from './h2-commitment.mjs'
import { H2_ACP_PROFILE, assertBcParity, buildArmComposition } from './h2-composition.mjs'
import { buildCorpusManifest, loadH2Corpus } from './h2-corpus.mjs'
import { createDshGraderIo, createDshRuntime, describeTargetFacts, runCompositionParityProbe } from './h2-dsh-env.mjs'
import { assertGraderIndependence, runGrader } from './h2-grader.mjs'
import {
  assertDryRunReceipt,
  assertPreregistrationReceipt,
  buildDryRunReceipt,
  buildPreregistrationReceipt,
} from './h2-receipts.mjs'
import { buildH2Report } from './h2-report.mjs'
import { credentialSources } from './h2-route.mjs'
import { assertRunCompositionParity, runObservation } from './h2-runner.mjs'
import { assertScheduleMatchesPolicy, buildH2Schedule } from './h2-schedule.mjs'
import { exactOneSidedMcNemarP } from './h2-statistics.mjs'
import { directoryDigest, readJson, sha256Bytes, writeJson } from './h2-util.mjs'
import { materializeWorkspace, observationLayout, prepareObservationDir } from './h2-workspace.mjs'

const REPO_ROOT = process.cwd()
const DOCS_DIR = join(REPO_ROOT, 'docs', 'evaluation', 'h2')
const ARTIFACT_ROOT = join(REPO_ROOT, '.artifacts', 'h2')
const COMMITMENT_FILE = join(DOCS_DIR, 'h2-commitment-v1.json')
const AUTHOR_CHECK_SCHEMA = 'dsh-toolchain-h2-author-check-v1'
/**
 * Admission evidence is produced once, on the authoring machine, and published so
 * a scoring job can verify it without re-admitting the private corpus: a GitHub
 * runner has no `.artifacts` tree from the operator.
 */
const AUTHOR_CHECK_FILE = process.env.H2_AUTHOR_CHECK_FILE ?? join(ARTIFACT_ROOT, 'author-check.json')
const PREREGISTRATION_FILE = join(DOCS_DIR, 'h2-preregistration-receipt-v1.json')
const CALIBRATION_DIR = join(DOCS_DIR, 'calibration')
const DEFAULT_DATASET_DIR = process.env.H2_DATASET_DIR ?? join(REPO_ROOT, '.artifacts', 'h2-dataset-v1')
const DEFAULT_DSH_ROOT = process.env.H2_DSH_ROOT ?? 'C:\\Reposit\\deepseek-harness\\deepseek-harness'
const DEFAULT_DSH_TRAIN = process.env.H2_DSH_TRAIN ?? '@deepseek-ai/dsh@0.1.5-rc.2'
/**
 * How the frozen target is acquired. The operator machine runs the local
 * checkout it develops against; a GitHub runner has no such checkout, so it
 * installs the published train of the same version into a runner directory and
 * drives that. The mode is part of the preregistration receipt, so a receipt
 * sealed in one mode can never be silently reused in the other.
 */
const DSH_MODE = process.env.H2_DSH_MODE ?? 'checkout'
/** Where the benchmark is running: `local` (operator machine) or `ci` (runner). */
const H2_VENUE = process.env.H2_VENUE ?? 'local'
/** Scratch root a CI job materializes the private corpus into. */
const H2_CI_TEMP_ROOT = process.env.H2_CI_TEMP_ROOT ?? tmpdir()
/**
 * Committed evaluation surfaces that must stay disjoint from the hidden corpus,
 * so no hidden task can be recycled from disclosed material and no public
 * artifact can reconstruct a hidden task. The corpus loader fails closed when a
 * hidden task id appears anywhere under these roots.
 */
export const H2_DISCLOSED_ROOTS = Object.freeze([
  join(REPO_ROOT, 'docs', 'evaluation', 'm2', 'h1-dev-corpus-v1'),
  join(REPO_ROOT, 'docs', 'evaluation', 'm2', 'staged-dev-v2-selection.json'),
  // The public calibration task and the unit-test fixture seed are committed,
  // so a hidden task id appearing there would mean the private corpus and the
  // public tree overlap.
  join(REPO_ROOT, 'docs', 'evaluation', 'h2', 'calibration'),
  join(REPO_ROOT, 'tests', 'evaluation', 'fixtures', 'h2', 'corpus-seed'),
])
const DISCLOSED_ROOTS = H2_DISCLOSED_ROOTS

function runtime() {
  if (DSH_MODE === 'package') {
    return createDshRuntime({ mode: 'package', dshRoot: DEFAULT_DSH_ROOT, train: DEFAULT_DSH_TRAIN })
  }
  return createDshRuntime({ mode: 'checkout', dshRoot: DEFAULT_DSH_ROOT, train: DEFAULT_DSH_TRAIN })
}

/**
 * Runs one DSH probe (a version resolve) under coordinates that are owned and
 * disposable, so even a command that only reports a version never inherits the
 * operator's home, temp directory, or package-manager state.
 */
function withCheckCoordinates(run) {
  const handle = createOwnedTree({
    workspaceRoot: ARTIFACT_ROOT,
    dir: join(ARTIFACT_ROOT, 'checks', `check-${randomUUID().slice(0, 12)}`),
    kind: 'check',
    runId: 'checks',
  })
  try {
    return run(ensureDisposableCoordinates(createDisposableCoordinates({ root: handle.root })))
  } finally {
    removeOwnedTree({ handle })
  }
}

/**
 * The live target, resolved now. Model-backed commands must compare this
 * against the frozen receipt instead of comparing the receipt with itself: an
 * upgraded harness checkout between freeze and scoring would otherwise mix
 * trains silently, and no artifact written afterwards could reveal it.
 */
function liveTarget() {
  return withCheckCoordinates(coordinates => describeTargetFacts({
    runtime: runtime(),
    profile: H2_ACP_PROFILE,
    dshTrain: DEFAULT_DSH_TRAIN,
    dshRootVersion: dshRootVersion(),
    coordinates,
  }))
}

/**
 * The private corpus must not live where the agent under test can name it. DSH
 * confines writes, not reads, and the hidden task id is part of the agent's own
 * working path, so a corpus inside the observation checkout lets an agent read
 * the reference solution for its own task.
 *
 * The rule differs by venue, and the difference is explicit rather than a
 * relaxation. On the operator machine the corpus must be outside the checkout,
 * outside every ancestor of it, and outside the home and temp directories. A
 * GitHub runner has a single volume, so "outside every ancestor" is impossible
 * there; the CI rule therefore requires the corpus to come from a random
 * `mkdtemp` directory under the runner temp root, which is unguessable, is never
 * named in the agent's environment, and is removed when the run ends.
 */
function assertCorpusOutsideAgentReach({ datasetDir }) {
  const corpus = resolve(datasetDir)
  const repoRoot = resolve(REPO_ROOT)
  if (H2_VENUE === 'ci') {
    if (corpus === repoRoot || corpus.startsWith(`${repoRoot}${sep}`)) {
      throw new Error(`H2 refuses to spend scoring observations while the private corpus is inside the checkout (${corpus}).`)
    }
    const tempRoot = resolve(H2_CI_TEMP_ROOT)
    if (corpus !== tempRoot && !corpus.startsWith(`${tempRoot}${sep}`)) {
      throw new Error(`H2 CI runs require the private corpus under the runner temp root (${tempRoot}), got ${corpus}.`)
    }
    // The random `mkdtemp` segment is what makes the path unguessable, and it is
    // a segment of the path rather than its last one: the job extracts the
    // archive into `<mkdtemp>/h2-dataset-v1`. Any other segment would have to be
    // random too, so a single matching segment is the proof required here.
    const relativeToTemp = corpus.slice(tempRoot.length + 1)
    const guessable = relativeToTemp.split(sep).filter(segment => segment.length > 0)
    if (!guessable.some(segment => /[-_][A-Za-z0-9]{6,}$/.test(segment))) {
      throw new Error(
        `H2 CI runs require the private corpus in a random mkdtemp directory, got ${corpus}. `
        + 'A predictable corpus path is a path the agent under test can guess.',
      )
    }
    return assertNoInRepoCorpus({ corpus })
  }
  const forbidden = [repoRoot, ...ancestorsOf(repoRoot), homedir(), tmpdir()]
  for (const root of forbidden) {
    const resolved = resolve(root)
    if (corpus === resolved || corpus.startsWith(`${resolved}${sep}`)) {
      throw new Error(
        `H2 refuses to spend scoring observations while the private corpus is reachable from the agent (${corpus} is inside ${resolved}). `
        + `Set H2_DATASET_DIR (or pass --dataset) to a path outside the checkout, the operator home, and the temp directory, `
        + `for example D:\\h2-private\\h2-dataset-v1.`,
      )
    }
  }
  return assertNoInRepoCorpus({ corpus })
}

/** No in-repo copy of the corpus may exist, in either venue. */
function assertNoInRepoCorpus({ corpus }) {
  const inRepoCopy = join(ARTIFACT_ROOT, '..', 'h2-dataset-v1', 'manifest.json')
  if (existsSync(inRepoCopy)) {
    throw new Error(
      `H2 refuses to spend scoring observations while an in-repo copy of the private corpus exists at ${resolve(inRepoCopy)}. `
      + 'Move or delete it, because an agent that can read that directory can read the answer key.',
    )
  }
  return corpus
}

/** Every ancestor of a directory, excluding the directory itself. */
function ancestorsOf(dir) {
  const chain = []
  let current = resolve(dir)
  for (;;) {
    const parent = resolve(current, '..')
    if (parent === current) return chain
    chain.push(parent)
    current = parent
  }
}

/**
 * Flushes retained evidence once a run has reached a terminal state.
 *
 * Deferred retention keeps every receipt in controller memory and deletes each
 * observation's live tree as soon as that observation ends, so no readable
 * sibling artifact exists while an agent is running. The cost is explicit and
 * accepted: a run that dies before this point retains nothing, because any
 * durable intermediate would be exactly the readable leak the design forbids.
 *
 * @param {{runDir: string, ledger: any, observations: readonly {taskId: string, arm: string, receipt: any}[]}} input
 */
async function flushRunEvidence({ runDir, ledger, observations }) {
  await mkdir(runDir, { recursive: true })
  await writeJson(join(runDir, 'ledger.json'), ledger)
  for (const observation of observations) {
    const dir = join(runDir, observation.taskId, observation.arm, 'receipts')
    await mkdir(dir, { recursive: true })
    await writeJson(join(dir, 'observation.json'), observation.receipt)
  }
  return runDir
}

/**
 * Isolation preconditions of a scored observation that are properties of the
 * environment rather than of the code path (the corpus reach is checked by
 * `assertCorpusOutsideAgentReach`, and per-observation tree removal is verified
 * by the observation itself). Kept separate so the scoring command reads as
 * "check the preconditions, then spend".
 */
function assertScoringPreconditions({ runDir }) {
  if (existsSync(runDir)) {
    throw new Error(
      `H2 refuses to start a scoring run whose artifact directory already exists: ${runDir}. `
      + 'A run directory present before the run began would be readable by every observation in it.',
    )
  }
  return true
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function shortSha(sha) {
  return typeof sha === 'string' ? sha.slice(0, 12) : 'unknown'
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

function dshRootVersion() {
  try {
    return readJsonFile(join(DEFAULT_DSH_ROOT, 'package.json')).version ?? null
  } catch {
    return null
  }
}

function calibrationSha() {
  return directoryDigest(join(CALIBRATION_DIR, 'workspace'))
}

function loadCommitmentRecord() {
  if (!existsSync(COMMITMENT_FILE)) {
    throw new Error(`H2 commitment record is missing: ${COMMITMENT_FILE}. Run: pnpm h2:commitment`)
  }
  const record = readJsonFile(COMMITMENT_FILE)
  assertCommitmentRecord(record)
  if (record.taskCount !== H2_POLICY.taskCount) throw new Error('H2 commitment record task count does not match the frozen policy')
  return record
}

function scheduleFromRecord(record) {
  const taskIds = record.tasks.map(task => task[0])
  const schedule = buildH2Schedule({ taskIds })
  assertScheduleMatchesPolicy(schedule)
  return schedule
}

function assertPublicValidation() {
  assertH2PolicyIntegrity()
  const record = loadCommitmentRecord()
  const strataCounts = {}
  for (const [, stratum] of record.tasks) strataCounts[stratum] = (strataCounts[stratum] ?? 0) + 1
  for (const stratum of H2_STRATA) {
    if (strataCounts[stratum] !== H2_POLICY.tasksPerStratum) {
      throw new Error(`H2 commitment record stratum ${stratum} must have exactly ${H2_POLICY.tasksPerStratum} tasks`)
    }
  }
  const schedule = scheduleFromRecord(record)
  if (schedule.entries.length !== H2_POLICY.scoringObservations) throw new Error('H2 schedule length does not match the frozen budget')
  const bFirst = schedule.entries.filter((entry, index) => index % 2 === 0 && entry.arm === 'B').length
  if (bFirst !== H2_POLICY.schedule.balancedArmOrderTasks) throw new Error('H2 schedule arm order is not balanced')
  if (exactOneSidedMcNemarP({ cOnly: 5, bOnly: 0 }) > 0.05) throw new Error('H2 statistics anchor 5/0 must be significant')
  if (exactOneSidedMcNemarP({ cOnly: 4, bOnly: 0 }) <= 0.05) throw new Error('H2 statistics anchor 4/0 must not be significant')
  const calibrationGrader = readFileSync(join(CALIBRATION_DIR, 'grader.mjs'), 'utf8')
  assertGraderIndependence(calibrationGrader)
  const b = buildArmComposition({ arm: 'B' })
  const c = buildArmComposition({ arm: 'C', toolchainTarball: 'placeholder.tgz' })
  assertBcParity({ b, c })
  return { record, schedule }
}

/**
 * Grader-descriptor fragments that identify what a task actually demands: check
 * ids, required/forbidden literals, regex patterns, expected composition rows,
 * and declared service/tool names. Shared boilerplate is deliberately excluded
 * (every grader names its entry file `index.mjs` and runs `nodeCheck` on it), so
 * only task-specific requirements count as an identity.
 */
function graderIdentityFragments(grader) {
  const fragments = new Set()
  for (const check of grader?.static ?? []) {
    if (typeof check?.id === 'string') fragments.add(check.id)
    for (const fragment of [...(check?.mustContain ?? []), ...(check?.mustNotContain ?? [])]) fragments.add(fragment)
    for (const entry of check?.regex ?? []) fragments.add(entry?.pattern)
  }
  for (const row of grader?.compose?.expectRows ?? []) {
    fragments.add(row?.id)
    fragments.add(row?.name)
  }
  for (const name of [...(grader?.runtime?.services ?? []), ...(grader?.runtime?.tools ?? [])]) fragments.add(name)
  return [...fragments].filter(fragment => typeof fragment === 'string' && fragment.length >= 4)
}

/**
 * The public calibration task must not be a copy of a hidden task. The
 * disclosed-task-id scan cannot see this: a calibration copy usually renames
 * the task id and the service while keeping the grader's requirements, which
 * publishes the hidden task's defect and solution. Any shared task-specific
 * grader fragment therefore fails closed.
 */
async function assertCalibrationDisjointFromCorpus({ corpus }) {
  const calibration = await import(pathToFileURL(join(CALIBRATION_DIR, 'grader.mjs')).href)
  const calibrationFragments = new Set(graderIdentityFragments(calibration.grader))
  for (const task of corpus.tasks) {
    const hidden = await import(pathToFileURL(task.graderPath).href)
    const shared = graderIdentityFragments(hidden.grader).filter(fragment => calibrationFragments.has(fragment))
    if (shared.length > 0) {
      throw new Error(`H2 public calibration task overlaps hidden grader ${task.taskId}: ${shared.join(', ')}`)
    }
  }
}

async function assertCorpusMatchesRecord({ record, datasetDir }) {
  const corpus = loadH2Corpus({ corpusDir: datasetDir, expectedDatasetSha256: record.datasetSha256, disclosedRoots: DISCLOSED_ROOTS })
  if (corpus.tasks.length !== H2_POLICY.taskCount) throw new Error(`H2 corpus must contain exactly ${H2_POLICY.taskCount} tasks`)
  const recordIds = record.tasks.map(task => task[0]).sort()
  const corpusIds = corpus.tasks.map(task => task.taskId).sort()
  if (recordIds.join(',') !== corpusIds.join(',')) throw new Error('H2 corpus task ids do not match the public commitment record')
  const strataCounts = {}
  for (const task of corpus.tasks) strataCounts[task.stratum] = (strataCounts[task.stratum] ?? 0) + 1
  for (const stratum of H2_STRATA) {
    if (strataCounts[stratum] !== H2_POLICY.tasksPerStratum) {
      throw new Error(`H2 corpus stratum ${stratum} must have exactly ${H2_POLICY.tasksPerStratum} tasks`)
    }
  }
  for (const task of corpus.tasks) {
    const source = readFileSync(task.graderPath, 'utf8')
    assertGraderIndependence(source)
  }
  await assertCalibrationDisjointFromCorpus({ corpus })
  return corpus
}

/**
 * Dataset admission is a gate, not a log. The artifact must have been produced
 * by a run that checked every committed task id against the same dataset
 * commitment that scoring will use, so a subset run, a stale dataset, or an
 * inadmissible task cannot be presented as admission evidence.
 */
function assertDatasetAdmission({ datasetSha256, taskIds }) {
  if (!existsSync(AUTHOR_CHECK_FILE)) {
    throw new Error(`H2 dataset admission is missing: ${AUTHOR_CHECK_FILE}. Run: pnpm h2:author-check`)
  }
  const artifact = readJsonFile(AUTHOR_CHECK_FILE)
  if (artifact.schema !== AUTHOR_CHECK_SCHEMA) throw new Error('H2 author-check artifact schema mismatch')
  const checked = Array.isArray(artifact.checkedTaskIds) ? [...artifact.checkedTaskIds].sort() : []
  const expected = [...taskIds].sort()
  if (checked.join(',') !== expected.join(',')) {
    throw new Error(`H2 author-check artifact covers ${checked.length} task ids, not the ${expected.length} committed tasks`)
  }
  if (artifact.datasetSha256 !== datasetSha256) {
    throw new Error('H2 author-check artifact was produced for a different dataset commitment; re-run pnpm h2:author-check')
  }
  if (artifact.allAdmissible !== true) throw new Error('H2 author-check artifact records inadmissible tasks')
  return artifact
}

function environmentChecks() {
  const checks = {}
  checks.dshMode = DSH_MODE
  checks.dshRoot = existsSync(DEFAULT_DSH_ROOT) ? 'ok' : `missing: ${DEFAULT_DSH_ROOT}`
  if (checks.dshRoot !== 'ok') throw new Error(`H2 DSH runtime not found: ${DEFAULT_DSH_ROOT} (set H2_DSH_ROOT)`)
  const version = withCheckCoordinates(coordinates => runtime().version(buildCheckEnvironment(coordinates)))
  checks.dshVersion = version
  const expectedVersion = DEFAULT_DSH_TRAIN.split('@').pop()
  if (version !== expectedVersion) {
    throw new Error(`H2 DSH target drift: runtime reports ${version}, frozen train is ${DEFAULT_DSH_TRAIN}`)
  }
  // The credential is named by the frozen route and resolved by DSH inside each
  // observation home; the controller only reports which authorities can supply
  // it. Asserting one specific variable name would tie the benchmark to one
  // deployment's shell instead of to the route it actually pins.
  const credentials = credentialSources()
  checks.route = {
    provider: H2_POLICY.model.provider,
    model: H2_POLICY.model.model,
    reasoningEffort: H2_POLICY.model.reasoningEffort,
    credentialRef: credentials.ref,
    credentialEnvironment: credentials.environment,
    credentialDocument: credentials.document,
    sessionAffinityHeader: H2_POLICY.model.sessionAffinityHeader,
  }
  checks.node = process.version
  return checks
}

/** The disposable environment a version or target probe runs in. */
function buildCheckEnvironment(coordinates) {
  return buildDisposableEnvironment({ coordinates })
}

async function packCandidate() {
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  const out = join(ARTIFACT_ROOT, 'dsh-toolchain-candidate.tgz')
  await rm(out, { force: true })
  execFileSync('pnpm', ['pack', '--out', out], { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  return { path: out, sha256: sha256Bytes(readFileSync(out)) }
}

async function commandValidate(args) {
  const publicOnly = args.values['public-only'] === true
  const { record, schedule } = assertPublicValidation()
  const summary = {
    command: 'h2:validate',
    mode: publicOnly ? 'public-only' : 'full',
    policy: { taskCount: H2_POLICY.taskCount, scoring: H2_POLICY.scoringObservations, technical: H2_POLICY.technicalObservations },
    datasetSha256: record.datasetSha256,
    scheduleHash: schedule.hash,
    strata: H2_STRATA,
  }
  if (!publicOnly) {
    const datasetDir = args.values.dataset ?? DEFAULT_DATASET_DIR
    const corpus = await assertCorpusMatchesRecord({ record, datasetDir })
    const admission = assertDatasetAdmission({
      datasetSha256: corpus.dataset.sha256,
      taskIds: corpus.tasks.map(task => task.taskId),
    })
    summary.dataset = { dir: datasetDir, tasks: corpus.tasks.length, datasetSha256: corpus.dataset.sha256 }
    summary.admission = { generatedAt: admission.generatedAt, stability: admission.stability, taskCount: admission.checkedTaskIds.length }
    summary.environment = environmentChecks()
    summary.candidate = { gitHead: gitHead(), packedArtifactPath: join(ARTIFACT_ROOT, 'dsh-toolchain-candidate.tgz') }
    summary.ready = credentialSources().resolvable
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

async function commandCorpusBuild(args) {
  const datasetDir = args.values.dataset ?? DEFAULT_DATASET_DIR
  const manifest = await buildCorpusManifest(datasetDir)
  const corpus = loadH2Corpus({ corpusDir: datasetDir })
  process.stdout.write(`H2 corpus manifest built: ${manifest.tasks.length} tasks\ndataset sha256: ${corpus.dataset.sha256}\n`)
  return corpus.dataset.sha256
}

async function commandCommitment(args) {
  const datasetDir = args.values.dataset ?? DEFAULT_DATASET_DIR
  const corpus = loadH2Corpus({ corpusDir: datasetDir, disclosedRoots: DISCLOSED_ROOTS })
  if (corpus.tasks.length !== H2_POLICY.taskCount) throw new Error(`H2 corpus must contain exactly ${H2_POLICY.taskCount} tasks`)
  const record = buildCommitmentRecord({
    tasks: corpus.tasks.map(task => ({
      taskId: task.taskId,
      stratum: task.stratum,
      promptSha256: task.contentHashes.promptSha256,
      workspaceSha256: task.contentHashes.workspaceSha256,
      referenceFixSha256: task.contentHashes.referenceFixSha256,
      graderSha256: task.contentHashes.graderSha256,
    })),
    calibrationSha256: await calibrationSha(),
  })
  const out = args.values.out ?? COMMITMENT_FILE
  await mkdir(resolve(out, '..'), { recursive: true })
  await writeJson(out, record)
  process.stdout.write(`H2 commitment record written: ${out}\ndataset sha256: ${record.datasetSha256}\n`)
  return record
}

async function commandFreeze(args) {
  const datasetDir = args.values.dataset ?? DEFAULT_DATASET_DIR
  const { record, schedule } = assertPublicValidation()
  const corpus = await assertCorpusMatchesRecord({ record, datasetDir })
  // The preregistration may only be sealed for a dataset whose admission
  // evidence covers every committed task of this exact commitment.
  assertDatasetAdmission({ datasetSha256: corpus.dataset.sha256, taskIds: corpus.tasks.map(task => task.taskId) })
  const environment = environmentChecks()
  const candidatePack = await packCandidate()
  const gitCommitSha = gitHead()
  const target = withCheckCoordinates(coordinates => describeTargetFacts({
    runtime: runtime(),
    profile: 'acp',
    dshTrain: DEFAULT_DSH_TRAIN,
    dshRootVersion: dshRootVersion(),
    coordinates,
  }))
  const receipt = buildPreregistrationReceipt({
    candidate: {
      gitCommitSha,
      packedArtifactSha256: candidatePack.sha256,
      packageName: 'dsh-toolchain',
      packageVersion: readJsonFile(join(REPO_ROOT, 'package.json')).version,
      protocolVersion: '1',
    },
    target,
    dataset: record,
    schedule: { seed: schedule.seed, hash: schedule.hash },
    source: {
      repository: 'definitely-stable/dsh-toolchain1',
      commit: gitCommitSha,
      nodeVersion: process.version,
      controllerEntry: 'scripts/eval/h2/h2-cli.mjs',
    },
    generatedAt: new Date().toISOString(),
  })
  const out = args.values.out ?? PREREGISTRATION_FILE
  if (existsSync(out) && args.values.force !== true) {
    throw new Error(`H2 preregistration receipt already exists at ${out}; pass --force to replace it before any scoring outcome`)
  }
  await writeJson(out, receipt)
  process.stdout.write(`${JSON.stringify({
    command: 'h2:freeze',
    out,
    receiptSha256: receipt.receiptSha256,
    candidate: receipt.candidate,
    target: receipt.target,
    datasetSha256: receipt.dataset.commitmentSha256,
    scheduleHash: receipt.schedule.hash,
    corpusTasks: corpus.tasks.length,
    environment,
    packedArtifact: candidatePack.path,
  }, null, 2)}\n`)
  return receipt
}

function loadCalibrationTask() {
  const taskId = 'h2-calibration-01'
  return {
    taskId,
    stratum: 'compatibility-debug',
    promptPath: join(CALIBRATION_DIR, 'prompt.md'),
    workspaceDir: join(CALIBRATION_DIR, 'workspace'),
    referenceFixDir: join(CALIBRATION_DIR, 'reference-fix'),
    graderPath: join(CALIBRATION_DIR, 'grader.mjs'),
    contentHashes: { workspaceSha256: undefined },
  }
}

function requirePreregistration() {
  if (!existsSync(PREREGISTRATION_FILE)) throw new Error(`H2 is not frozen: missing ${PREREGISTRATION_FILE}. Run: pnpm h2:freeze`)
  const receipt = readJsonFile(PREREGISTRATION_FILE)
  assertPreregistrationReceipt({ receipt })
  return receipt
}

/**
 * Proves that the deletion guard is the one that would actually run, using the
 * operator's real protected paths as negative cases. A guard that has been
 * weakened, bypassed, or replaced cannot report this result, because the checks
 * below call the same functions a deletion calls.
 */
function guardSelfTest() {
  const negative = []
  const probeTargets = [
    ['operator-dsh-home', resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'web')],
    ['temp-directory', resolve(tmpdir(), 'h2-guard-probe', 'nested')],
  ]
  for (const [label, target] of probeTargets) {
    let refused = false
    try {
      assertDeletableTarget({ target, workspaceRoot: ARTIFACT_ROOT })
    } catch {
      refused = true
    }
    negative.push({ label, target, refused })
    if (!refused) throw new Error(`H2 deletion guard did not refuse the protected path ${target}; refusing to spend a run`)
  }
  const handle = createOwnedTree({
    workspaceRoot: ARTIFACT_ROOT,
    dir: join(ARTIFACT_ROOT, 'preflight', `guard-${randomUUID().slice(0, 12)}`),
    kind: 'guard-probe',
    runId: 'preflight',
  })
  writeFileSync(join(handle.root, 'probe.txt'), 'guard probe\n', 'utf8')
  removeOwnedTree({ handle })
  if (existsSync(handle.root)) throw new Error('H2 deletion guard did not remove its own probe tree')
  return Object.freeze({
    probeRoot: handle.root,
    createAndRemove: 'ok',
    refusedProtectedPaths: negative,
    protectedRoots: resolveProtectedRoots().length,
  })
}

const PREFLIGHT_FILE = join(ARTIFACT_ROOT, 'preflight', 'protection-report.json')
const PREFLIGHT_SCHEMA = 'dsh-toolchain-h2-protection-report-v1'

function requirePreflight({ datasetSha256 }) {
  if (!existsSync(PREFLIGHT_FILE)) {
    throw new Error(`H2 requires a passing preflight before spending: missing ${PREFLIGHT_FILE}. Run: pnpm h2:preflight`)
  }
  const report = readJsonFile(PREFLIGHT_FILE)
  if (report.schema !== PREFLIGHT_SCHEMA) throw new Error('H2 preflight report schema mismatch')
  if (report.dataset?.datasetSha256 !== datasetSha256) {
    throw new Error('H2 preflight report was produced for a different dataset commitment; re-run pnpm h2:preflight')
  }
  if (report.venue !== H2_VENUE || report.dshMode !== DSH_MODE) {
    throw new Error(`H2 preflight report is for venue ${String(report.venue)}/${String(report.dshMode)}, not ${H2_VENUE}/${DSH_MODE}`)
  }
  if (report.credentialResolvable !== true) throw new Error('H2 preflight report did not resolve the frozen route credential')
  if (report.guard?.createAndRemove !== 'ok') throw new Error('H2 preflight report does not attest the deletion guard')
  return report
}

/**
 * Zero-token readiness gate: the frozen policy and commitment, the corpus
 * materialized against that commitment, admission for every committed task, the
 * disposable-environment exercise, and the deletion guard's own self-test. The
 * report is what the paid commands re-check, so a weakened guard or a stale
 * corpus cannot reach a scoring observation.
 */
async function commandPreflight(args) {
  const datasetDir = assertCorpusOutsideAgentReach({ datasetDir: args.values.dataset ?? DEFAULT_DATASET_DIR })
  const { record } = assertPublicValidation()
  const corpus = await assertCorpusMatchesRecord({ record, datasetDir })
  const admission = assertDatasetAdmission({ datasetSha256: corpus.dataset.sha256, taskIds: corpus.tasks.map(task => task.taskId) })
  const environment = environmentChecks()
  const guard = guardSelfTest()
  const credentials = credentialSources()
  const report = {
    schema: PREFLIGHT_SCHEMA,
    generatedAt: new Date().toISOString(),
    venue: H2_VENUE,
    dshMode: DSH_MODE,
    dshRoot: DEFAULT_DSH_ROOT,
    dshTrain: DEFAULT_DSH_TRAIN,
    node: process.version,
    dataset: { dir: datasetDir, tasks: corpus.tasks.length, datasetSha256: corpus.dataset.sha256 },
    admission: { generatedAt: admission.generatedAt, stability: admission.stability, taskCount: admission.checkedTaskIds.length },
    environment,
    credentialResolvable: credentials.resolvable,
    guard,
  }
  await mkdir(resolve(PREFLIGHT_FILE, '..'), { recursive: true })
  await writeJson(PREFLIGHT_FILE, report)
  process.stdout.write(`${JSON.stringify({
    command: 'h2:preflight',
    report: PREFLIGHT_FILE,
    venue: report.venue,
    dshMode: report.dshMode,
    datasetSha256: report.dataset.datasetSha256,
    guard: report.guard.refusedProtectedPaths,
    credentialResolvable: report.credentialResolvable,
  }, null, 2)}\n`)
  if (!credentials.resolvable) {
    throw new Error(
      `H2 cannot resolve the frozen route credential ${credentials.ref} from the environment or the operator credential document; `
      + 'the paid run would fail at its first model call.',
    )
  }
  return report
}

async function commandDryRun(args) {
  const preregistration = requirePreregistration()
  const candidatePack = await packCandidate()
  const gitCommitSha = gitHead()
  const target = liveTarget()
  assertPreregistrationReceipt({
    receipt: preregistration,
    expected: {
      candidate: { gitCommitSha, packedArtifactSha256: candidatePack.sha256 },
      datasetSha256: preregistration.dataset.commitmentSha256,
      scheduleHash: preregistration.schedule.hash,
      targetFingerprint: target.targetFingerprint,
    },
  })
  if (!credentialSources().resolvable) {
    throw new Error(
      `H2 dry run cannot resolve the frozen route credential ${H2_POLICY.model.credentialRef}: it is neither exported in this environment `
      + 'nor stored in the operator credential document. Store it through DSH, or export it, before spending an observation.',
    )
  }
  assertRunCompositionParity({ toolchainTarball: candidatePack.path })
  const runId = `technical-dry-run-${shortSha(candidatePack.sha256)}`
  requirePreflight({ datasetSha256: preregistration.dataset.commitmentSha256 })
  const receiptPath = join(ARTIFACT_ROOT, runId, 'technical-dry-run.json')
  if (existsSync(receiptPath) && args.values['confirm-technical-rerun'] !== true) {
    throw new Error(`a technical dry-run receipt already exists at ${receiptPath}; pass --confirm-technical-rerun to spend again deliberately`)
  }
  // Empirical half of the causal boundary, before any model token is spent:
  // both arms are composed for real and their `--dump-config` trees must differ
  // by exactly the Toolchain row.
  const compositionParity = runCompositionParityProbe({
    runtime: runtime(),
    workspaceRoot: ARTIFACT_ROOT,
    baseDir: join(ARTIFACT_ROOT, runId, 'composition-parity'),
    runId,
    profile: H2_ACP_PROFILE,
    toolchainTarball: candidatePack.path,
  })
  process.stdout.write(`H2 dry run: empirical B/C composition parity verified (Arm B ${compositionParity.armBRows} rows, Arm C ${compositionParity.armCRows} rows, added ${compositionParity.addedRow.id})\n`)
  const task = loadCalibrationTask()
  const taskForRun = { ...task, contentHashes: { workspaceSha256: await directoryDigest(task.workspaceDir) } }
  const observations = []
  const retained = []
  for (const arm of H2_POLICY.arms) {
    const { receipt } = await runObservation({
      arm,
      task: taskForRun,
      runtime: runtime(),
      toolchainTarball: candidatePack.path,
      runId,
      artifactRoot: ARTIFACT_ROOT,
      retention: 'deferred',
    })
    retained.push({ taskId: taskForRun.taskId, arm, receipt })
    observations.push({
      arm,
      scoring: false,
      status: receipt.terminalReason === 'COMPLETED' || receipt.terminalReason === 'RESOURCE_EXHAUSTED' ? 'ok' : 'failed',
      terminalReason: receipt.terminalReason,
      wallTimeMs: receipt.timing.wallTimeMs,
      totalToolCalls: receipt.tools.totalToolCalls,
      toolchainToolCalls: receipt.tools.toolchainToolCalls,
      graderStatus: receipt.grader.status,
      model: receipt.identity.requestModel,
      identityDrift: receipt.identityDrift,
      // Carried explicitly rather than derived: a missing telemetry plane is an
      // infrastructure failure of the harness, never a model-identity finding.
      telemetryResolved: receipt.telemetry?.resolved === true,
    })
  }
  const receipt = buildDryRunReceipt({
    commitmentSha256: preregistration.dataset.commitmentSha256,
    candidate: { gitCommitSha, packedArtifactSha256: candidatePack.sha256 },
    target: { targetFingerprint: target.targetFingerprint, dshTrain: target.dshTrain },
    compositionParity,
    observations,
    generatedAt: new Date().toISOString(),
  })
  await writeJson(receiptPath, receipt)
  await flushRunEvidence({
    runDir: join(ARTIFACT_ROOT, runId),
    ledger: { runId, technical: true, scoring: false, entries: retained.map(entry => ({ taskId: entry.taskId, arm: entry.arm })) },
    observations: retained,
  })
  assertDryRunReceipt({
    receipt,
    expected: { datasetSha256: preregistration.dataset.commitmentSha256, gitCommitSha, targetFingerprint: target.targetFingerprint },
  })
  process.stdout.write(`${JSON.stringify({ command: 'h2:dry-run', receiptPath, receiptSha256: receipt.receiptSha256, observations }, null, 2)}\n`)
  return receipt
}

async function commandRun(args) {
  const preregistration = requirePreregistration()
  if (args.values['confirm-scoring'] !== true) {
    throw new Error('h2:run spends real model tokens; pass --confirm-scoring to authorize the 36 preregistered observations')
  }
  const datasetDir = assertCorpusOutsideAgentReach({ datasetDir: args.values.dataset ?? DEFAULT_DATASET_DIR })
  const record = loadCommitmentRecord()
  const corpus = await assertCorpusMatchesRecord({ record, datasetDir })
  const schedule = scheduleFromRecord(record)
  const candidatePack = await packCandidate()
  const gitCommitSha = gitHead()
  const target = liveTarget()
  assertPreregistrationReceipt({
    receipt: preregistration,
    expected: {
      candidate: { gitCommitSha, packedArtifactSha256: candidatePack.sha256 },
      datasetSha256: record.datasetSha256,
      scheduleHash: schedule.hash,
      targetFingerprint: target.targetFingerprint,
    },
  })
  const dryRunPath = join(ARTIFACT_ROOT, `technical-dry-run-${shortSha(candidatePack.sha256)}`, 'technical-dry-run.json')
  if (!existsSync(dryRunPath)) throw new Error(`H2 scoring requires a passing technical dry-run receipt at ${dryRunPath}`)
  assertDryRunReceipt({
    receipt: readJsonFile(dryRunPath),
    expected: { datasetSha256: record.datasetSha256, gitCommitSha, targetFingerprint: target.targetFingerprint },
  })
  assertRunCompositionParity({ toolchainTarball: candidatePack.path })
  requirePreflight({ datasetSha256: record.datasetSha256 })

  // A fresh run id per invocation: a deterministic id let a re-run overwrite
  // the receipts of an aborted run while the previous ledger was still on disk,
  // so `finalize` could assemble one report out of two different runs.
  const runId = `scoring-${shortSha(candidatePack.sha256)}-${gitCommitSha.slice(0, 8)}-${Date.now().toString(36)}`
  const runDir = join(ARTIFACT_ROOT, runId)
  assertScoringPreconditions({ runDir })
  const byId = new Map(corpus.tasks.map(task => [task.taskId, task]))
  const ledger = { runId, startedAt: new Date().toISOString(), entries: [], stopped: false, stopReason: null }
  const retained = []
  const deletions = []
  /**
   * The job that owns this run has a hard ceiling, and deferred retention keeps
   * nothing durable before a terminal state, so the run stops scheduling new
   * observations before the ceiling instead of being killed by it. The stop is a
   * recorded `STOPPED_INVALID` terminal, never a silent truncation.
   */
  const runBudgetMs = args.values['run-budget-minutes'] === undefined
    ? 270 * 60_000
    : Number(args.values['run-budget-minutes']) * 60_000
  if (!Number.isSafeInteger(runBudgetMs) || runBudgetMs <= 0) throw new Error('--run-budget-minutes must be a positive integer')
  const runDeadline = Date.now() + runBudgetMs
  for (const entry of schedule.entries) {
    if (Date.now() >= runDeadline) {
      ledger.stopped = true
      ledger.stopReason = 'RUN_BUDGET_EXHAUSTED'
      process.stdout.write(`H2 scoring stopped before observation ${entry.ordinal}/${schedule.entries.length}: run budget of ${runBudgetMs / 60_000} minutes is spent\n`)
      break
    }
    const task = byId.get(entry.taskId)
    const { receipt, journal } = await runObservation({
      arm: entry.arm,
      task,
      runtime: runtime(),
      toolchainTarball: candidatePack.path,
      runId,
      artifactRoot: ARTIFACT_ROOT,
      retention: 'deferred',
    })
    for (const record of journal ?? []) deletions.push(record)
    retained.push({ taskId: entry.taskId, arm: entry.arm, receipt })
    ledger.entries.push({
      ordinal: entry.ordinal,
      taskId: entry.taskId,
      arm: entry.arm,
      terminalReason: receipt.terminalReason,
      success: receipt.success,
      identityDrift: receipt.identityDrift,
      budgetExhausted: receipt.budgetExhausted,
    })
    process.stdout.write(`${entry.ordinal}/${schedule.entries.length} ${entry.taskId} arm ${entry.arm}: ${receipt.terminalReason}${receipt.success ? ' SUCCESS' : ''}\n`)
    // Infrastructure first: a failure to read the telemetry plane must never be
    // reported as a model-identity stop.
    if (receipt.terminalReason === 'INFRASTRUCTURE_FAILURE' || receipt.terminalReason === 'CANCELLED') {
      ledger.stopped = true
      ledger.stopReason = `INFRASTRUCTURE_FAILURE:${entry.taskId}:${entry.arm}`
      break
    }
    if (receipt.identityDrift === true) {
      ledger.stopped = true
      ledger.stopReason = 'MODEL_IDENTITY_DRIFT'
      break
    }
  }
  // The run has reached a terminal state, so the retained evidence may now
  // become durable.
  await flushRunEvidence({ runDir, ledger, observations: retained })
  // The deletion journal is part of the run's evidence: it records every tree the
  // benchmark removed, so an operator can read after the fact what a run touched.
  await writeJson(join(runDir, 'deletion-journal.json'), { schema: 'dsh-toolchain-h2-deletion-journal-v1', runId, entries: deletions })
  const report = buildH2Report({ runId, receipts: retained.map(observation => observation.receipt), generatedAt: new Date().toISOString() })
  await writeJson(join(runDir, 'report.json'), report)
  process.stdout.write(`${JSON.stringify({
    command: 'h2:run',
    runId,
    executed: ledger.entries.length,
    planned: schedule.entries.length,
    stopped: ledger.stopped,
    stopReason: ledger.stopReason,
    status: report.status,
    decision: report.decision,
  }, null, 2)}\n`)
  if (ledger.stopped) process.exitCode = 3
  return report
}

async function commandFinalize(args) {
  let runDir = args.values.run
  if (runDir === undefined) {
    const candidates = (await readdir(ARTIFACT_ROOT, { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory() && entry.name.startsWith('scoring-'))
      .map(entry => entry.name)
      .sort()
    const latest = candidates.at(-1)
    if (latest === undefined) throw new Error('no scoring run found under .artifacts/h2')
    runDir = join(ARTIFACT_ROOT, latest)
  }
  const ledger = await readJson(join(runDir, 'ledger.json'))
  const receiptFiles = []
  for (const entry of ledger.entries) {
    receiptFiles.push(await readJson(join(runDir, entry.taskId, entry.arm, 'receipts', 'observation.json')))
  }
  const report = buildH2Report({ runId: ledger.runId, receipts: receiptFiles, generatedAt: new Date().toISOString() })
  await writeJson(join(runDir, 'report.json'), report)
  // Publishing is a generator-owned step: `--out` writes the same report to the
  // committed location instead of a human copying it, so the published artifact
  // and the run artifact cannot drift apart. A report that never reached a
  // terminal measurement is refused rather than published.
  if (args.values.out !== undefined) {
    if (report.status !== 'COMPLETE') {
      throw new Error(`refusing to publish a non-terminal H2 report (status ${String(report.status)}); the run did not resolve every observation`)
    }
    const out = resolve(args.values.out)
    await mkdir(resolve(out, '..'), { recursive: true })
    await writeJson(out, report)
  }
  process.stdout.write(`${JSON.stringify({
    command: 'h2:finalize',
    runId: ledger.runId,
    status: report.status,
    measurement: report.measurement,
    decision: report.decision,
    primary: report.primary,
    published: args.values.out ?? null,
  }, null, 2)}\n`)
  return report
}

async function commandAuthorCheck(args) {
  const datasetDir = args.values.dataset ?? DEFAULT_DATASET_DIR
  const only = args.values.tasks === undefined ? null : new Set(String(args.values.tasks).split(','))
  const stability = args.values.stability === undefined ? 1 : Number(args.values.stability)
  if (!Number.isSafeInteger(stability) || stability < 1) throw new Error('--stability must be a positive integer')
  const corpus = loadH2Corpus({ corpusDir: datasetDir, disclosedRoots: DISCLOSED_ROOTS })
  const dshRuntime = runtime()
  const results = []
  for (const task of corpus.tasks) {
    if (only !== null && !only.has(task.taskId)) continue
    const source = readFileSync(task.graderPath, 'utf8')
    assertGraderIndependence(source)
    const graderModule = await import(pathToFileURL(task.graderPath).href)
    const observed = []
    let initialDigest = null
    for (let round = 1; round <= stability; round += 1) {
      const runId = `author-check-r${round}`
      const layout = observationLayout({ artifactRoot: ARTIFACT_ROOT, runId, taskId: task.taskId, arm: 'B' })
      const { observation, run, coordinates } = prepareObservationDir({ artifactRoot: ARTIFACT_ROOT, runId, layout })
      initialDigest = await materializeWorkspace({
        owned: observation,
        targetRelativePath: 'workspace',
        sourceDir: task.workspaceDir,
        expectedSha256: task.contentHashes.workspaceSha256,
      })
      const io = createDshGraderIo({ runtime: dshRuntime, layout, coordinates })
      const initial = await runGrader({ workspaceDir: layout.workspaceDir, grader: graderModule.grader, io })
      await materializeWorkspace({
        owned: observation,
        targetRelativePath: 'workspace',
        sourceDir: task.referenceFixDir,
        expectedSha256: task.contentHashes.referenceFixSha256,
      })
      const reference = await runGrader({ workspaceDir: layout.workspaceDir, grader: graderModule.grader, io })
      observed.push({ initial: initial.status, reference: reference.status })
      removeOwnedTree({ handle: run })
    }
    const stable = observed.every(round => round.initial === observed[0].initial && round.reference === observed[0].reference)
    const admissible = stable && observed[0].initial === 'fail' && observed[0].reference === 'pass'
    results.push({
      taskId: task.taskId,
      stratum: task.stratum,
      admissible,
      stable,
      rounds: observed,
      initial: observed[0].initial,
      reference: observed[0].reference,
      initialDigest,
    })
    process.stdout.write(`${admissible ? 'ADMISSIBLE' : 'INADMISSIBLE'} ${task.taskId} initial=${observed[0].initial} reference=${observed[0].reference} stable=${stable} rounds=${observed.length}\n`)
  }
  const corpusIds = corpus.tasks.map(task => task.taskId).sort()
  const checkedTaskIds = results.map(result => result.taskId).sort()
  // Admission is evidence for the whole committed dataset, so a `--tasks`
  // subset (or a run that skipped a task) can never certify it.
  const coversCorpus = checkedTaskIds.join(',') === corpusIds.join(',')
  const allAdmissible = coversCorpus && results.every(result => result.admissible)
  // A scoped re-run (--tasks/--out) must never overwrite the whole-dataset
  // admission evidence, so the caller can redirect it.
  const out = args.values.out ?? AUTHOR_CHECK_FILE
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await mkdir(resolve(out, '..'), { recursive: true })
  await writeJson(out, {
    schema: AUTHOR_CHECK_SCHEMA,
    generatedAt: new Date().toISOString(),
    stability,
    datasetSha256: corpus.dataset.sha256,
    checkedTaskIds,
    coversCorpus,
    allAdmissible,
    results,
  })
  if (!allAdmissible) process.exitCode = 2
  return results
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const args = parseArgs({
    args: rest,
    options: {
      dataset: { type: 'string' },
      out: { type: 'string' },
      run: { type: 'string' },
      tasks: { type: 'string' },
      stability: { type: 'string' },
      'public-only': { type: 'boolean' },
      'confirm-scoring': { type: 'boolean' },
      'confirm-technical-rerun': { type: 'boolean' },
      'run-budget-minutes': { type: 'string' },
      force: { type: 'boolean' },
    },
    allowPositionals: false,
  })
  switch (command) {
    case 'validate': return commandValidate(args)
    case 'corpus-build': return commandCorpusBuild(args)
    case 'commitment': return commandCommitment(args)
    case 'preflight': return commandPreflight(args)
    case 'freeze': return commandFreeze(args)
    case 'dry-run': return commandDryRun(args)
    case 'run': return commandRun(args)
    case 'finalize': return commandFinalize(args)
    case 'author-check': return commandAuthorCheck(args)
    default:
      process.stderr.write(`usage: node scripts/eval/h2/h2-cli.mjs <validate|corpus-build|commitment|preflight|freeze|dry-run|run|finalize|author-check> [flags]\n`)
      process.exitCode = 2
      return undefined
  }
}

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    process.stderr.write(`H2 CLI error: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { main }