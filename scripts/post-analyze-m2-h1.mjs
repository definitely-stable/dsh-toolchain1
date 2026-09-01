#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const EXPECTED_TASK_COUNT = 96
const EXPECTED_RUN_COUNT = 864
const TOOLCHAIN_SEARCH = 'toolchain_contract_search'
const TOOLCHAIN_INSPECT = 'toolchain_contract_inspect'
const TERMINAL_WORKFLOW_NAME = 'M2 H1 Terminal Adjudication'
const TERMINAL_MANIFEST_SCHEMA = 'dsh-toolchain-m2-h1-terminal-evidence-manifest-v1'
const REQUIRED_TERMINAL_FILES = Object.freeze([
  'h1-result-v2.json',
  'h1-analysis-v2.json',
  'h1-summary.md',
  'h1-hidden-dataset-v2.json',
])

function requireArgumentValue(args, index, option) {
  const value = args[index + 1]
  if (typeof value !== 'string' || value.trim().length === 0 || value.startsWith('--')) {
    throw new Error(`${option} requires a non-empty value`)
  }
  return value
}

export function parseArguments(args) {
  let terminalDir
  let outputDir
  let terminalRunId
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--terminal-dir') {
      terminalDir = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--output-dir') {
      outputDir = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    if (argument === '--terminal-run-id') {
      terminalRunId = requireArgumentValue(args, index, argument)
      index += 1
      continue
    }
    throw new Error(`Unknown post-H1 analysis argument: ${String(argument)}`)
  }
  if (terminalDir === undefined || outputDir === undefined || terminalRunId === undefined) {
    throw new Error('post-H1 analysis requires --terminal-dir, --output-dir and --terminal-run-id')
  }
  if (!/^\d+$/.test(terminalRunId)) throw new Error('terminal run id must be numeric')
  return Object.freeze({ terminalDir, outputDir, terminalRunId })
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

async function readJson(filename, label) {
  const text = await readFile(filename, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} must contain valid JSON: ${filename}`, { cause: error })
  }
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function sha256File(filename) {
  return sha256Bytes(await readFile(filename))
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(6))
}

function parseContentRefJson(value, label) {
  const ref = requireRecord(value, label)
  const inline = requireString(ref.inline, `${label}.inline`)
  try {
    return JSON.parse(inline)
  } catch (error) {
    throw new Error(`${label}.inline must contain valid JSON`, { cause: error })
  }
}

function toolUsageFromAttempt(attempt) {
  const executionEvidence = requireRecord(attempt.executionEvidence, 'model attempt executionEvidence')
  const trace = requireRecord(parseContentRefJson(executionEvidence.trace, 'model attempt trace'), 'model attempt trace payload')
  const entries = requireArray(trace.entries, 'model attempt trace entries')
  const toolchainEntries = entries.filter(entryValue => requireRecord(entryValue, 'trace entry').family === 'toolchain')
  const names = entries.map(entryValue => requireString(requireRecord(entryValue, 'trace entry').name, 'trace entry name'))
  const toolchainErrors = toolchainEntries.filter(entryValue => requireRecord(entryValue, 'trace entry').status === 'error').length
  return Object.freeze({
    totalCalls: entries.length,
    toolchainCalls: toolchainEntries.length,
    toolchainUsed: toolchainEntries.length > 0,
    searchUsed: names.includes(TOOLCHAIN_SEARCH),
    inspectUsed: names.includes(TOOLCHAIN_INSPECT),
    toolchainErrors,
    toolNames: names,
  })
}

function resourceFromAttempt(attempt) {
  const executionEvidence = requireRecord(attempt.executionEvidence, 'model attempt executionEvidence')
  const resource = requireRecord(
    parseContentRefJson(executionEvidence.resourceReceipt, 'model attempt resource receipt'),
    'model attempt resource receipt payload',
  )
  const observed = requireRecord(resource.observed, 'model attempt resource observation')
  const readOptional = key => observed[key] === undefined ? null : requireFiniteNumber(observed[key], `resource.${key}`)
  return Object.freeze({
    wallTimeMs: readOptional('wallTimeMs'),
    turns: readOptional('turns'),
    inputTokens: readOptional('inputTokens'),
    outputTokens: readOptional('outputTokens'),
  })
}

function classifyFailure(row) {
  if (!row.hasModelOutcome) return 'INFRASTRUCTURE_ONLY'
  if (row.unresolvedApi) return 'UNRESOLVED_API'
  if (row.invalidApi === 1) {
    if (row.arm === 'C') {
      if (row.toolUsage.toolchainErrors > 0) return 'INVALID_API_AFTER_TOOLCHAIN_ERROR'
      if (!row.toolUsage.toolchainUsed) return 'INVALID_API_TOOLCHAIN_NOT_USED'
      if (row.toolUsage.searchUsed && !row.toolUsage.inspectUsed) return 'INVALID_API_SEARCH_ONLY'
      return 'INVALID_API_AFTER_TOOLCHAIN'
    }
    return 'INVALID_API'
  }
  if (row.taskSuccess === 'FAILURE') {
    if (row.arm === 'C') {
      if (row.toolUsage.toolchainErrors > 0) return 'TASK_FAILURE_AFTER_TOOLCHAIN_ERROR'
      if (!row.toolUsage.toolchainUsed) return 'TASK_FAILURE_TOOLCHAIN_NOT_USED'
      return 'TASK_FAILURE_AFTER_TOOLCHAIN'
    }
    return 'TASK_FAILURE_NON_API'
  }
  if (row.taskSuccess === 'UNKNOWN') return 'TASK_SUCCESS_UNKNOWN'
  if (row.taskSuccess === 'SUCCESS') return 'SUCCESS'
  return 'UNKNOWN_OUTCOME'
}

function buildRunRow(runValue, taskMetadata) {
  const run = requireRecord(runValue, 'H1 result run')
  const taskId = requireString(run.taskId, 'H1 result run taskId')
  const arm = requireString(run.arm, 'H1 result run arm')
  if (!['A', 'B', 'C'].includes(arm)) throw new Error(`Invalid H1 arm ${arm}`)
  const trial = requireFiniteNumber(run.trial, 'H1 result run trial')
  if (![1, 2, 3].includes(trial)) throw new Error(`Invalid H1 trial ${trial}`)
  const attempts = requireArray(run.attempts, 'H1 result run attempts').map(value => requireRecord(value, 'H1 result attempt'))
  const modelAttempts = attempts.filter(attempt => attempt.outcome === 'model-outcome')
  if (modelAttempts.length > 1) throw new Error(`H1 run ${taskId}/${arm}/${trial} contains multiple model outcomes`)
  const modelAttempt = modelAttempts[0]
  const infrastructureFailures = attempts.filter(attempt => attempt.outcome === 'infrastructure-failure').length

  let invalidApi = null
  let unresolvedApi = false
  let taskSuccess = null
  /** @type {ReturnType<typeof toolUsageFromAttempt>} */
  let toolUsage = Object.freeze({ totalCalls: 0, toolchainCalls: 0, toolchainUsed: false, searchUsed: false, inspectUsed: false, toolchainErrors: 0, toolNames: [] })
  /** @type {ReturnType<typeof resourceFromAttempt>} */
  let resource = Object.freeze({ wallTimeMs: null, turns: null, inputTokens: null, outputTokens: null })
  if (modelAttempt !== undefined) {
    const claims = requireArray(modelAttempt.parsedApiClaims, 'model attempt parsedApiClaims').map(value => requireRecord(value, 'parsed API claim'))
    invalidApi = claims.some(claim => claim.classification === 'INVALID') ? 1 : 0
    unresolvedApi = claims.some(claim => claim.classification === 'UNKNOWN')
    taskSuccess = requireString(modelAttempt.taskSuccess, 'model attempt taskSuccess')
    if (!['SUCCESS', 'FAILURE', 'UNKNOWN'].includes(taskSuccess)) throw new Error(`Invalid taskSuccess ${taskSuccess}`)
    toolUsage = toolUsageFromAttempt(modelAttempt)
    resource = resourceFromAttempt(modelAttempt)
  }

  const decisionResolved = modelAttempt !== undefined && !unresolvedApi && (taskSuccess === 'SUCCESS' || taskSuccess === 'FAILURE')
  const row = {
    taskId,
    domain: taskMetadata.domain,
    ruleKind: taskMetadata.ruleKind,
    arm,
    trial,
    attemptCount: attempts.length,
    infrastructureFailures,
    hasModelOutcome: modelAttempt !== undefined,
    invalidApi,
    unresolvedApi,
    taskSuccess,
    decisionResolved,
    successIndicator: decisionResolved ? (taskSuccess === 'SUCCESS' ? 1 : 0) : null,
    toolUsage,
    resource,
  }
  return Object.freeze({ ...row, failureMode: classifyFailure(row) })
}

function armSummary(rows) {
  const modelRows = rows.filter(row => row.hasModelOutcome)
  const resolved = rows.filter(row => row.decisionResolved)
  const numberValues = (key) => modelRows.map(row => row.resource[key]).filter(value => value !== null)
  return Object.freeze({
    trials: rows.length,
    modelOutcomeTrials: modelRows.length,
    resolvedDecisionTrials: resolved.length,
    unresolvedDecisionTrials: rows.length - resolved.length,
    invalidApiMean: rounded(mean(resolved.map(row => row.invalidApi))),
    successMean: rounded(mean(resolved.map(row => row.successIndicator))),
    infrastructureFailures: rows.reduce((sum, row) => sum + row.infrastructureFailures, 0),
    meanWallTimeMs: rounded(mean(numberValues('wallTimeMs'))),
    meanTurns: rounded(mean(numberValues('turns'))),
    meanInputTokens: rounded(mean(numberValues('inputTokens'))),
    meanOutputTokens: rounded(mean(numberValues('outputTokens'))),
  })
}

function toolchainSummary(rows) {
  const modelRows = rows.filter(row => row.hasModelOutcome)
  const used = modelRows.filter(row => row.toolUsage.toolchainUsed)
  const search = modelRows.filter(row => row.toolUsage.searchUsed)
  const inspect = modelRows.filter(row => row.toolUsage.inspectUsed)
  const errors = modelRows.filter(row => row.toolUsage.toolchainErrors > 0)
  const names = new Map()
  for (const row of modelRows) {
    for (const name of row.toolUsage.toolNames) names.set(name, (names.get(name) ?? 0) + 1)
  }
  return Object.freeze({
    modelOutcomeTrials: modelRows.length,
    usedTrials: used.length,
    usedTrialRate: rounded(ratio(used.length, modelRows.length)),
    searchTrials: search.length,
    searchTrialRate: rounded(ratio(search.length, modelRows.length)),
    inspectTrials: inspect.length,
    inspectTrialRate: rounded(ratio(inspect.length, modelRows.length)),
    inspectRateAmongUsed: rounded(ratio(inspect.length, used.length)),
    errorTrials: errors.length,
    errorTrialRateAmongUsed: rounded(ratio(errors.length, used.length)),
    toolCallCounts: Object.fromEntries([...names.entries()].toSorted((left, right) => left[0].localeCompare(right[0]))),
  })
}

function failureCounts(rows) {
  const counts = new Map()
  for (const row of rows) counts.set(row.failureMode, (counts.get(row.failureMode) ?? 0) + 1)
  return Object.fromEntries([...counts.entries()].toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}

function summarizeTask(task, rows) {
  const byArm = arm => rows.filter(row => row.arm === arm)
  const B = armSummary(byArm('B'))
  const C = armSummary(byArm('C'))
  const primaryEffect = B.resolvedDecisionTrials === 3 && C.resolvedDecisionTrials === 3
    ? rounded(B.invalidApiMean - C.invalidApiMean)
    : null
  const guardrailEffect = B.resolvedDecisionTrials === 3 && C.resolvedDecisionTrials === 3
    ? rounded(C.successMean - B.successMean)
    : null
  return Object.freeze({
    taskId: task.id,
    domain: task.domain,
    ruleKind: task.ruleKind,
    arms: Object.freeze({ A: armSummary(byArm('A')), B, C }),
    primaryEffect,
    guardrailEffect,
    cToolchain: toolchainSummary(byArm('C')),
    failureModes: Object.freeze({
      A: failureCounts(byArm('A')),
      B: failureCounts(byArm('B')),
      C: failureCounts(byArm('C')),
    }),
  })
}

function groupedSummary(tasks, key) {
  const groups = new Map()
  for (const task of tasks) {
    const groupKey = task[key]
    const values = groups.get(groupKey) ?? []
    values.push(task)
    groups.set(groupKey, values)
  }
  return Object.fromEntries([...groups.entries()].toSorted((left, right) => left[0].localeCompare(right[0])).map(([groupKey, values]) => {
    const primary = values.map(value => value.primaryEffect).filter(value => value !== null)
    const guardrail = values.map(value => value.guardrailEffect).filter(value => value !== null)
    const cUsed = values.reduce((sum, value) => sum + value.cToolchain.usedTrials, 0)
    const cModel = values.reduce((sum, value) => sum + value.cToolchain.modelOutcomeTrials, 0)
    return [groupKey, Object.freeze({
      taskCount: values.length,
      resolvedPrimaryTaskCount: primary.length,
      primaryEffectMean: rounded(mean(primary)),
      guardrailEffectMean: rounded(mean(guardrail)),
      cToolchainUsedTrialRate: rounded(ratio(cUsed, cModel)),
    })]
  }))
}

function recommendation(scientificAnalysis, cToolchain) {
  if (scientificAnalysis.status === 'PASS') {
    return Object.freeze({
      nextAction: 'ADVANCE_M2',
      recommendedEngineeringSlice: 'OPTIONAL_NONBLOCKING_DIAGNOSTIC_BACKLOG',
      rationale: 'The preregistered primary endpoint and task-success guardrail both passed; subsequent improvements should not block M2 exit.',
    })
  }
  if (scientificAnalysis.status === 'INCONCLUSIVE') {
    return Object.freeze({
      nextAction: 'RESOLVE_PREREGISTERED_RECOVERY_PATH',
      recommendedEngineeringSlice: 'EVALUATION_RECOVERY',
      rationale: 'The frozen H1 result is inconclusive; resolve only the preregistered validity/recovery path before product tuning.',
    })
  }
  if ((cToolchain.usedTrialRate ?? 1) < 0.5) {
    return Object.freeze({
      nextAction: 'OPEN_SEPARATE_IMPROVEMENT_SLICE',
      recommendedEngineeringSlice: 'TOOL_SELECTION_AND_AFFORDANCE',
      rationale: 'Fewer than half of model-outcome C trials used Toolchain, so availability is not translating into reliable invocation.',
    })
  }
  if ((cToolchain.inspectRateAmongUsed ?? 1) < 0.7) {
    return Object.freeze({
      nextAction: 'OPEN_SEPARATE_IMPROVEMENT_SLICE',
      recommendedEngineeringSlice: 'SEARCH_TO_INSPECT_WORKFLOW_ADOPTION',
      rationale: 'Toolchain is often invoked without completing the search-to-inspect evidence path.',
    })
  }
  if ((cToolchain.errorTrialRateAmongUsed ?? 0) > 0.1) {
    return Object.freeze({
      nextAction: 'OPEN_SEPARATE_IMPROVEMENT_SLICE',
      recommendedEngineeringSlice: 'TOOLCHAIN_RUNTIME_RELIABILITY',
      rationale: 'More than 10% of Toolchain-using C trials contain a Toolchain error.',
    })
  }
  if (scientificAnalysis.primary?.decisionPass === true && scientificAnalysis.guardrail?.decisionPass === false) {
    return Object.freeze({
      nextAction: 'OPEN_SEPARATE_IMPROVEMENT_SLICE',
      recommendedEngineeringSlice: 'AGENT_INTEGRATION_AND_TASK_SUCCESS',
      rationale: 'Invalid-API improvement passed but the task-success non-inferiority guardrail failed.',
    })
  }
  return Object.freeze({
    nextAction: 'OPEN_SEPARATE_IMPROVEMENT_SLICE',
    recommendedEngineeringSlice: 'RETRIEVAL_AND_EVIDENCE_QUALITY',
    rationale: 'Toolchain is being used through inspect without a dominant runtime/adoption failure, so the remaining bottleneck is most plausibly retrieval/evidence usefulness.',
  })
}

export function analyzeTerminalEvidence(input) {
  const result = requireRecord(input.result, 'H1 result')
  const analysisArtifact = requireRecord(input.analysisArtifact, 'H1 analysis artifact')
  const scientificAnalysis = requireRecord(analysisArtifact.analysis, 'H1 scientific analysis')
  const dataset = requireRecord(input.hiddenDataset, 'H1 hidden dataset')
  const tasks = requireArray(dataset.tasks, 'H1 hidden dataset tasks')
  if (tasks.length !== EXPECTED_TASK_COUNT) throw new Error(`Expected ${EXPECTED_TASK_COUNT} hidden tasks, got ${tasks.length}`)

  const taskMetadata = new Map()
  for (const taskValue of tasks) {
    const task = requireRecord(taskValue, 'H1 hidden task')
    const id = requireString(task.id, 'H1 hidden task id')
    const domain = requireString(task.domain, `H1 hidden task ${id} domain`)
    const rule = requireRecord(task.successRule, `H1 hidden task ${id} successRule`)
    const ruleKind = requireString(rule.kind, `H1 hidden task ${id} successRule.kind`)
    if (taskMetadata.has(id)) throw new Error(`Duplicate hidden task ${id}`)
    taskMetadata.set(id, Object.freeze({ id, domain, ruleKind }))
  }

  const runs = requireArray(result.runs, 'H1 result runs')
  if (runs.length !== EXPECTED_RUN_COUNT) throw new Error(`Expected ${EXPECTED_RUN_COUNT} H1 runs, got ${runs.length}`)
  const runRows = []
  const runKeys = new Set()
  for (const run of runs) {
    const runRecord = requireRecord(run, 'H1 result run')
    const taskId = requireString(runRecord.taskId, 'H1 result run taskId')
    const metadata = taskMetadata.get(taskId)
    if (metadata === undefined) throw new Error(`H1 result references unknown hidden task ${taskId}`)
    const row = buildRunRow(runRecord, metadata)
    const key = `${row.taskId}\u0000${row.arm}\u0000${row.trial}`
    if (runKeys.has(key)) throw new Error(`Duplicate H1 result run ${key}`)
    runKeys.add(key)
    runRows.push(row)
  }

  const taskDiagnostics = [...taskMetadata.values()].toSorted((left, right) => left.id.localeCompare(right.id)).map(task => {
    const rows = runRows.filter(row => row.taskId === task.id)
    if (rows.length !== 9) throw new Error(`H1 task ${task.id} must have exactly 9 A/B/C trial runs`)
    return summarizeTask(task, rows)
  })
  const C = runRows.filter(row => row.arm === 'C')
  const cToolchain = toolchainSummary(C)
  const recommendationValue = recommendation(scientificAnalysis, cToolchain)

  return Object.freeze({
    schema: 'dsh-toolchain-m2-h1-post-analysis-v1',
    version: 'h1-post-analysis-v1',
    confirmatoryDecision: Object.freeze({
      status: scientificAnalysis.status,
      primary: structuredClone(scientificAnalysis.primary),
      guardrail: structuredClone(scientificAnalysis.guardrail),
      sourceAnalysisSha256: analysisArtifact.analysisSha256,
      sourceResultSha256: analysisArtifact.resultSha256,
    }),
    exploratoryOnly: true,
    taskCount: taskDiagnostics.length,
    runCount: runRows.length,
    arms: Object.freeze({
      A: armSummary(runRows.filter(row => row.arm === 'A')),
      B: armSummary(runRows.filter(row => row.arm === 'B')),
      C: armSummary(C),
    }),
    cToolchain,
    failureModes: Object.freeze({
      A: failureCounts(runRows.filter(row => row.arm === 'A')),
      B: failureCounts(runRows.filter(row => row.arm === 'B')),
      C: failureCounts(C),
    }),
    byDomain: groupedSummary(taskDiagnostics, 'domain'),
    byRuleKind: groupedSummary(taskDiagnostics, 'ruleKind'),
    recommendation: recommendationValue,
    taskDiagnostics,
  })
}

function metricText(metric) {
  if (metric?.estimate === null || metric?.estimate === undefined) return 'unresolved'
  return `estimate=${metric.estimate.toFixed(6)}, 95% CI=[${metric.lowerBound.toFixed(6)}, ${metric.upperBound.toFixed(6)}], threshold=${metric.threshold.toFixed(6)}, pass=${String(metric.decisionPass)}`
}

function topTaskEffects(tasks, direction) {
  return tasks
    .filter(task => task.primaryEffect !== null)
    .toSorted((left, right) => direction * (right.primaryEffect - left.primaryEffect) || left.taskId.localeCompare(right.taskId))
    .slice(0, 5)
}

function reportMarkdown(postAnalysis, source, postAnalysisSha256, taskDiagnosticsSha256) {
  const scientific = postAnalysis.confirmatoryDecision
  const strongest = topTaskEffects(postAnalysis.taskDiagnostics, 1)
  const weakest = topTaskEffects(postAnalysis.taskDiagnostics, -1)
  const formatTask = task => `- ${task.taskId} (${task.domain}): primary effect=${task.primaryEffect}, guardrail effect=${task.guardrailEffect}`
  return [
    '# M2.3 H1 post-analysis report',
    '',
    `Confirmatory status: **${scientific.status}**`,
    '',
    '> This report is exploratory post-analysis only. It does not change or recompute the frozen H1 confirmatory decision.',
    '',
    '## Frozen decision',
    '',
    `- Primary C-vs-B Invalid API: ${metricText(scientific.primary)}`,
    `- Task-success guardrail C-vs-B: ${metricText(scientific.guardrail)}`,
    `- Terminal adjudication run: ${source.terminalRunId}`,
    `- H1 execution run: ${source.h1ExecutionRunId}`,
    `- Result SHA-256: \`${scientific.sourceResultSha256}\``,
    `- Analysis SHA-256: \`${scientific.sourceAnalysisSha256}\``,
    '',
    '## Arm-level diagnostics',
    '',
    `- B invalid API mean: ${postAnalysis.arms.B.invalidApiMean}; success mean: ${postAnalysis.arms.B.successMean}`,
    `- C invalid API mean: ${postAnalysis.arms.C.invalidApiMean}; success mean: ${postAnalysis.arms.C.successMean}`,
    `- C Toolchain used-trial rate: ${postAnalysis.cToolchain.usedTrialRate}`,
    `- C search-trial rate: ${postAnalysis.cToolchain.searchTrialRate}`,
    `- C inspect-trial rate: ${postAnalysis.cToolchain.inspectTrialRate}`,
    `- C inspect rate among Toolchain-using trials: ${postAnalysis.cToolchain.inspectRateAmongUsed}`,
    `- C Toolchain error rate among Toolchain-using trials: ${postAnalysis.cToolchain.errorTrialRateAmongUsed}`,
    '',
    '## Strongest task-level C improvements',
    '',
    ...(strongest.length === 0 ? ['- unresolved'] : strongest.map(formatTask)),
    '',
    '## Weakest / regressing task-level effects',
    '',
    ...(weakest.length === 0 ? ['- unresolved'] : weakest.map(formatTask)),
    '',
    '## Exploratory recommendation',
    '',
    `- Next action: **${postAnalysis.recommendation.nextAction}**`,
    `- Recommended engineering slice: **${postAnalysis.recommendation.recommendedEngineeringSlice}**`,
    `- Rationale: ${postAnalysis.recommendation.rationale}`,
    '',
    '## Evidence identities',
    '',
    `- Post-analysis SHA-256: \`${postAnalysisSha256}\``,
    `- Task diagnostics SHA-256: \`${taskDiagnosticsSha256}\``,
    '',
  ].join('\n')
}

async function validateTerminalFiles(terminalDir, terminalRunId) {
  const manifest = requireRecord(await readJson(path.join(terminalDir, 'h1-terminal-manifest-v1.json'), 'H1 terminal manifest'), 'H1 terminal manifest')
  if (manifest.schema !== TERMINAL_MANIFEST_SCHEMA) throw new Error('H1 terminal manifest schema drifted')
  if (manifest.workflow !== TERMINAL_WORKFLOW_NAME) throw new Error('H1 terminal manifest workflow identity drifted')
  if (String(manifest.workflowRunId) !== String(terminalRunId)) throw new Error('terminal run id does not match terminal manifest workflowRunId')
  const files = requireArray(manifest.files, 'H1 terminal manifest files')
  const manifestHashes = new Map(files.map(value => {
    const entry = requireRecord(value, 'H1 terminal manifest file')
    return [requireString(entry.path, 'H1 terminal manifest file path'), requireString(entry.sha256, 'H1 terminal manifest file sha256')]
  }))
  for (const filename of REQUIRED_TERMINAL_FILES) {
    const expected = manifestHashes.get(filename)
    if (expected === undefined) throw new Error(`H1 terminal manifest is missing ${filename}`)
    const actual = await sha256File(path.join(terminalDir, filename))
    if (actual !== expected) throw new Error(`H1 terminal artifact hash mismatch for ${filename}`)
  }

  const checksumText = await readFile(path.join(terminalDir, 'h1-terminal-sha256sums.txt'), 'utf8')
  for (const filename of REQUIRED_TERMINAL_FILES) {
    const expected = manifestHashes.get(filename)
    if (!checksumText.split(/\r?\n/u).includes(`${expected}  ${filename}`)) {
      throw new Error(`H1 terminal checksum list does not bind ${filename}`)
    }
  }

  const [result, analysisArtifact, hiddenDataset] = await Promise.all([
    readJson(path.join(terminalDir, 'h1-result-v2.json'), 'H1 result'),
    readJson(path.join(terminalDir, 'h1-analysis-v2.json'), 'H1 analysis artifact'),
    readJson(path.join(terminalDir, 'h1-hidden-dataset-v2.json'), 'H1 hidden dataset'),
  ])
  const resultHash = await sha256File(path.join(terminalDir, 'h1-result-v2.json'))
  const datasetHash = await sha256File(path.join(terminalDir, 'h1-hidden-dataset-v2.json'))
  const analysis = requireRecord(analysisArtifact, 'H1 analysis artifact')
  if (analysis.resultSha256 !== resultHash) throw new Error('H1 analysis artifact resultSha256 does not match terminal result bytes')
  if (manifest.datasetRawSha256 !== datasetHash) throw new Error('H1 terminal manifest datasetRawSha256 does not match disclosed dataset bytes')
  const resultRecord = requireRecord(result, 'H1 result')
  const scientific = requireRecord(analysis.analysis, 'H1 scientific analysis')
  if (resultRecord.status !== scientific.status) throw new Error('H1 result and analysis status disagree')
  if (resultRecord.definitionSha256 !== analysis.definitionSha256) throw new Error('H1 result and analysis definitionSha256 disagree')
  if (scientific.taskCount !== EXPECTED_TASK_COUNT) throw new Error('H1 scientific analysis task count drifted')
  return Object.freeze({ manifest, result, analysisArtifact, hiddenDataset })
}

export async function runPostAnalysis(options) {
  const terminalDir = path.resolve(options.terminalDir)
  const outputDir = path.resolve(options.outputDir)
  const validated = await validateTerminalFiles(terminalDir, options.terminalRunId)
  const postAnalysis = analyzeTerminalEvidence({
    result: validated.result,
    analysisArtifact: validated.analysisArtifact,
    hiddenDataset: validated.hiddenDataset,
  })
  await mkdir(outputDir, { recursive: true })

  const taskDiagnosticsText = `${postAnalysis.taskDiagnostics.map(task => JSON.stringify(task)).join('\n')}\n`
  const postAnalysisArtifact = Object.freeze({
    ...postAnalysis,
    source: Object.freeze({
      terminalRunId: String(options.terminalRunId),
      h1ExecutionRunId: String(validated.manifest.h1ExecutionRunId),
      terminalSourceCommit: validated.manifest.terminalSourceCommit,
    }),
  })
  const postAnalysisText = `${JSON.stringify(postAnalysisArtifact, null, 2)}\n`
  const postAnalysisSha256 = sha256Bytes(postAnalysisText)
  const taskDiagnosticsSha256 = sha256Bytes(taskDiagnosticsText)
  const decisionReceipt = Object.freeze({
    schema: 'dsh-toolchain-m2-h1-decision-receipt-v1',
    version: 'h1-decision-receipt-v1',
    status: postAnalysis.confirmatoryDecision.status,
    primaryPassed: postAnalysis.confirmatoryDecision.primary?.decisionPass ?? null,
    guardrailPassed: postAnalysis.confirmatoryDecision.guardrail?.decisionPass ?? null,
    definitionSha256: validated.analysisArtifact.definitionSha256,
    resultSha256: validated.analysisArtifact.resultSha256,
    analysisSha256: validated.analysisArtifact.analysisSha256,
    terminalRunId: String(options.terminalRunId),
    h1ExecutionRunId: String(validated.manifest.h1ExecutionRunId),
    postAnalysisSha256,
    taskDiagnosticsSha256,
    exploratoryRecommendation: postAnalysis.recommendation,
    confirmatoryDecisionUnchanged: true,
  })
  const decisionText = `${JSON.stringify(decisionReceipt, null, 2)}\n`
  const reportText = reportMarkdown(
    postAnalysis,
    postAnalysisArtifact.source,
    postAnalysisSha256,
    taskDiagnosticsSha256,
  )

  const outputs = Object.freeze({
    'h1-post-analysis-v1.json': postAnalysisText,
    'h1-task-diagnostics-v1.jsonl': taskDiagnosticsText,
    'h1-final-report.md': reportText,
    'h1-decision-receipt-v1.json': decisionText,
  })
  for (const [filename, content] of Object.entries(outputs)) {
    await writeFile(path.join(outputDir, filename), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  }
  const checksums = Object.entries(outputs)
    .map(([filename, content]) => `${sha256Bytes(content)}  ${filename}`)
    .join('\n') + '\n'
  await writeFile(path.join(outputDir, 'h1-post-analysis-sha256sums.txt'), checksums, { encoding: 'utf8', flag: 'wx', mode: 0o600 })

  return Object.freeze({
    status: postAnalysis.confirmatoryDecision.status,
    nextAction: postAnalysis.recommendation.nextAction,
    recommendedEngineeringSlice: postAnalysis.recommendation.recommendedEngineeringSlice,
    postAnalysisSha256,
    taskDiagnosticsSha256,
    outputDir,
  })
}

export async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args)
  const result = await runPostAnalysis(parsed)
  console.log([
    'M2.3 H1 post-analysis',
    `status=${result.status}`,
    `nextAction=${result.nextAction}`,
    `recommendedEngineeringSlice=${result.recommendedEngineeringSlice}`,
    `postAnalysisSha256=${result.postAnalysisSha256}`,
    `taskDiagnosticsSha256=${result.taskDiagnosticsSha256}`,
  ].join(' '))
  return result
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)
if (invokedDirectly) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`H1 post-analysis failed: ${message}`)
    process.exitCode = 1
  })
}
