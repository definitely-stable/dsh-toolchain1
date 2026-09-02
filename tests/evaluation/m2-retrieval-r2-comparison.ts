import type { R2RetrievalTask } from './m2-retrieval-r2.js'

export type R2ComparisonOutcome = 'win' | 'loss' | 'tie'

export interface R2RankedResult {
  readonly taskId: string
  readonly rankedContractIds: readonly string[]
}

export interface R2ResultDiagnostic {
  readonly rankedContractIds: readonly string[]
  readonly expectedRank: number | null
  readonly forbiddenHitAt5: boolean
  readonly noResultCorrect: boolean | null
}

export interface R2TaskComparison {
  readonly taskId: string
  readonly scenario: R2RetrievalTask['scenario']
  readonly baseline: R2ResultDiagnostic
  readonly candidate: R2ResultDiagnostic
  readonly outcome: R2ComparisonOutcome
}

function resultMap(
  label: 'baseline' | 'candidate',
  tasks: readonly R2RetrievalTask[],
  results: readonly R2RankedResult[],
): ReadonlyMap<string, R2RankedResult> {
  const taskIds = new Set(tasks.map(task => task.id))
  const mapped = new Map<string, R2RankedResult>()

  for (const result of results) {
    if (!taskIds.has(result.taskId)) {
      throw new Error(`Unknown ${label} R2 result ${result.taskId}.`)
    }
    if (mapped.has(result.taskId)) {
      throw new Error(`Duplicate ${label} R2 result ${result.taskId}.`)
    }
    mapped.set(result.taskId, result)
  }

  for (const task of tasks) {
    if (!mapped.has(task.id)) {
      throw new Error(`Missing ${label} R2 result ${task.id}.`)
    }
  }
  return mapped
}

function expectedRank(task: R2RetrievalTask, rankedContractIds: readonly string[]): number | null {
  if (task.expectNoResult === true) return null
  const expected = new Set(task.expectedContractIds)
  for (let index = 0; index < rankedContractIds.length; index += 1) {
    if (expected.has(rankedContractIds[index]!)) return index + 1
  }
  return null
}

function diagnostic(task: R2RetrievalTask, result: R2RankedResult): R2ResultDiagnostic {
  const forbidden = new Set(task.forbiddenContractIds ?? [])
  return Object.freeze({
    rankedContractIds: Object.freeze([...result.rankedContractIds]),
    expectedRank: expectedRank(task, result.rankedContractIds),
    forbiddenHitAt5: result.rankedContractIds.slice(0, 5).some(id => forbidden.has(id)),
    noResultCorrect: task.expectNoResult === true ? result.rankedContractIds.length === 0 : null,
  })
}

function compareDiagnostics(
  task: R2RetrievalTask,
  baseline: R2ResultDiagnostic,
  candidate: R2ResultDiagnostic,
): R2ComparisonOutcome {
  if (task.expectNoResult === true) {
    if (candidate.noResultCorrect === baseline.noResultCorrect) return 'tie'
    return candidate.noResultCorrect === true ? 'win' : 'loss'
  }

  const baselineRank = baseline.expectedRank ?? Number.POSITIVE_INFINITY
  const candidateRank = candidate.expectedRank ?? Number.POSITIVE_INFINITY
  if (candidateRank < baselineRank) return 'win'
  if (candidateRank > baselineRank) return 'loss'

  if (candidate.forbiddenHitAt5 !== baseline.forbiddenHitAt5) {
    return candidate.forbiddenHitAt5 ? 'loss' : 'win'
  }
  return 'tie'
}

export function compareR2RetrievalResults(
  tasks: readonly R2RetrievalTask[],
  baselineResults: readonly R2RankedResult[],
  candidateResults: readonly R2RankedResult[],
): readonly R2TaskComparison[] {
  const taskIds = new Set<string>()
  for (const task of tasks) {
    if (taskIds.has(task.id)) throw new Error(`Duplicate R2 comparison task id ${task.id}.`)
    taskIds.add(task.id)
  }

  const baseline = resultMap('baseline', tasks, baselineResults)
  const candidate = resultMap('candidate', tasks, candidateResults)

  return Object.freeze(
    [...tasks]
      .toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .map(task => {
        const baselineResult = baseline.get(task.id)!
        const candidateResult = candidate.get(task.id)!
        const baselineDiagnostic = diagnostic(task, baselineResult)
        const candidateDiagnostic = diagnostic(task, candidateResult)
        return Object.freeze({
          taskId: task.id,
          scenario: task.scenario,
          baseline: baselineDiagnostic,
          candidate: candidateDiagnostic,
          outcome: compareDiagnostics(task, baselineDiagnostic, candidateDiagnostic),
        })
      }),
  )
}
