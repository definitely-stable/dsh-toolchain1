export const M2_RETRIEVAL_CATEGORIES = Object.freeze([
  'exact-symbol',
  'package-api',
  'natural-language',
  'indirect',
  'ambiguous',
  'no-result',
] as const)

export type M2RetrievalCategory = typeof M2_RETRIEVAL_CATEGORIES[number]

export interface M2RetrievalTask {
  readonly id: string
  readonly category: M2RetrievalCategory
  readonly domain: string
  readonly intentGroup: string
  readonly sourceKind: string
  readonly query: string
  readonly expectedContractIds: readonly string[]
  readonly forbiddenContractIds?: readonly string[]
  readonly replacementContractIds?: readonly string[]
  readonly expectNoResult?: boolean
  readonly referenceRoute: readonly string[]
  readonly riskTags?: readonly string[]
  readonly provenance: string
}

export interface M2RankedTaskResult {
  readonly task: M2RetrievalTask
  readonly rankedContractIds: readonly string[]
}

export interface M2CategoryMetrics {
  readonly taskCount: number
  readonly successAt1: number | null
  readonly successAt3: number | null
  readonly successAt5: number | null
  readonly meanReciprocalRank: number | null
  readonly noResultCorrectness: number | null
  readonly forbiddenHitRateAt5: number | null
}

export interface M2RetrievalMetrics {
  readonly taskCount: number
  readonly answerableTaskCount: number
  readonly noResultTaskCount: number
  readonly successAt1: number
  readonly successAt3: number
  readonly successAt5: number
  readonly meanReciprocalRank: number
  readonly noResultCorrectness: number
  readonly forbiddenHitRateAt5: number
  readonly byCategory: Readonly<Record<M2RetrievalCategory, M2CategoryMetrics>>
}

function nonEmpty(value: string, label: string, taskId: string): void {
  if (value.trim().length === 0) {
    throw new Error(`M2.3 task ${taskId} must declare a non-empty ${label}.`)
  }
}

function assertUniqueContractIds(
  ids: readonly string[],
  label: 'expected' | 'forbidden' | 'replacement',
  taskId: string,
): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label} contract id ${id} on M2.3 task ${taskId}.`)
    }
    seen.add(id)
  }
}

function assertRiskTags(tags: readonly string[], taskId: string): void {
  const seen = new Set<string>()
  for (const tag of tags) {
    nonEmpty(tag, 'risk tag', taskId)
    if (seen.has(tag)) throw new Error(`Duplicate risk tag ${tag} on M2.3 task ${taskId}.`)
    seen.add(tag)
  }
}

function assertReferenceRoute(route: readonly string[], taskId: string): void {
  if (route.length === 0) {
    throw new Error(`M2.3 task ${taskId} must declare a non-empty reference route.`)
  }
  for (const segment of route) nonEmpty(segment, 'reference route segment', taskId)
}

export function validateM2RetrievalCorpus(
  tasks: readonly M2RetrievalTask[],
  knownContractIds: ReadonlySet<string>,
): void {
  if (tasks.length === 0) throw new Error('M2.3 retrieval corpus must not be empty.')

  const taskIds = new Set<string>()
  const categories = new Set<M2RetrievalCategory>()
  const intentGroupCounts = new Map<string, number>()
  let noResultTasks = 0
  let forbiddenTasks = 0

  for (const task of tasks) {
    nonEmpty(task.id, 'task id', task.id || '<empty>')
    if (taskIds.has(task.id)) throw new Error(`Duplicate task id ${task.id} in M2.3 retrieval corpus.`)
    taskIds.add(task.id)
    categories.add(task.category)

    nonEmpty(task.domain, 'domain', task.id)
    nonEmpty(task.intentGroup, 'intentGroup', task.id)
    nonEmpty(task.sourceKind, 'sourceKind', task.id)
    nonEmpty(task.query, 'query', task.id)
    nonEmpty(task.provenance, 'provenance', task.id)
    assertReferenceRoute(task.referenceRoute, task.id)
    assertRiskTags(task.riskTags ?? [], task.id)

    intentGroupCounts.set(task.intentGroup, (intentGroupCounts.get(task.intentGroup) ?? 0) + 1)

    assertUniqueContractIds(task.expectedContractIds, 'expected', task.id)
    const forbidden = task.forbiddenContractIds ?? []
    const replacements = task.replacementContractIds ?? []
    assertUniqueContractIds(forbidden, 'forbidden', task.id)
    assertUniqueContractIds(replacements, 'replacement', task.id)
    if (forbidden.length > 0) forbiddenTasks += 1

    for (const id of task.expectedContractIds) {
      if (!knownContractIds.has(id)) {
        throw new Error(`Unknown expected contract ${id} on M2.3 task ${task.id}.`)
      }
    }
    for (const id of forbidden) {
      if (!knownContractIds.has(id)) {
        throw new Error(`Unknown forbidden contract ${id} on M2.3 task ${task.id}.`)
      }
      if (task.expectedContractIds.includes(id)) {
        throw new Error(`Contract ${id} is both expected and forbidden on M2.3 task ${task.id}.`)
      }
    }
    for (const id of replacements) {
      if (!knownContractIds.has(id)) {
        throw new Error(`Unknown replacement contract ${id} on M2.3 task ${task.id}.`)
      }
      if (!task.expectedContractIds.includes(id)) {
        throw new Error(
          `Replacement contract ${id} must also be an expected contract on M2.3 task ${task.id}.`,
        )
      }
    }
    if (replacements.length > 0 && !task.riskTags?.includes('version-drift')) {
      throw new Error(`M2.3 task ${task.id} with a replacement must declare the version-drift risk tag.`)
    }

    const expectNoResult = task.expectNoResult === true
    if ((task.category === 'no-result') !== expectNoResult) {
      throw new Error(
        `M2.3 task ${task.id} must use the no-result category exactly when expectNoResult is true.`,
      )
    }
    if (expectNoResult) {
      noResultTasks += 1
      if (task.expectedContractIds.length > 0) {
        throw new Error(`No-result task ${task.id} must not declare expected contracts.`)
      }
      if (replacements.length > 0) {
        throw new Error(`No-result task ${task.id} must not declare a useful replacement contract.`)
      }
    } else if (task.expectedContractIds.length === 0) {
      throw new Error(`Answerable task ${task.id} must declare at least one expected contract.`)
    }
  }

  for (const [intentGroup, count] of intentGroupCounts) {
    if (count > 3) {
      throw new Error(`M2.3 intent group ${intentGroup} contains ${count} tasks; no intent group may contain more than 3.`)
    }
  }
  if (noResultTasks === 0) {
    throw new Error('M2.3 retrieval corpus requires at least one no-result task.')
  }
  if (forbiddenTasks === 0) {
    throw new Error('M2.3 retrieval corpus requires at least one task with forbidden contracts.')
  }
  for (const category of M2_RETRIEVAL_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`M2.3 retrieval corpus is missing category ${category}.`)
    }
  }
}

function firstExpectedRank(result: M2RankedTaskResult): number | undefined {
  const expected = new Set(result.task.expectedContractIds)
  for (let index = 0; index < result.rankedContractIds.length; index += 1) {
    if (expected.has(result.rankedContractIds[index]!)) return index + 1
  }
  return undefined
}

function successAt(results: readonly M2RankedTaskResult[], limit: number): number {
  let hits = 0
  for (const result of results) {
    const expected = new Set(result.task.expectedContractIds)
    if (result.rankedContractIds.slice(0, limit).some(id => expected.has(id))) hits += 1
  }
  return hits / results.length
}

function reciprocalRankMean(results: readonly M2RankedTaskResult[]): number {
  let sum = 0
  for (const result of results) {
    const rank = firstExpectedRank(result)
    if (rank !== undefined) sum += 1 / rank
  }
  return sum / results.length
}

function noResultCorrectness(results: readonly M2RankedTaskResult[]): number {
  return results.filter(result => result.rankedContractIds.length === 0).length / results.length
}

function forbiddenHitRateAt5(results: readonly M2RankedTaskResult[]): number {
  let wrong = 0
  for (const result of results) {
    const forbidden = new Set(result.task.forbiddenContractIds ?? [])
    if (result.rankedContractIds.slice(0, 5).some(id => forbidden.has(id))) wrong += 1
  }
  return wrong / results.length
}

function categoryMetrics(results: readonly M2RankedTaskResult[]): M2CategoryMetrics {
  const answerable = results.filter(result => result.task.expectNoResult !== true)
  const noResult = results.filter(result => result.task.expectNoResult === true)
  const forbidden = results.filter(result => (result.task.forbiddenContractIds?.length ?? 0) > 0)
  return Object.freeze({
    taskCount: results.length,
    successAt1: answerable.length === 0 ? null : successAt(answerable, 1),
    successAt3: answerable.length === 0 ? null : successAt(answerable, 3),
    successAt5: answerable.length === 0 ? null : successAt(answerable, 5),
    meanReciprocalRank: answerable.length === 0 ? null : reciprocalRankMean(answerable),
    noResultCorrectness: noResult.length === 0 ? null : noResultCorrectness(noResult),
    forbiddenHitRateAt5: forbidden.length === 0 ? null : forbiddenHitRateAt5(forbidden),
  })
}

export function calculateM2RetrievalMetrics(
  results: readonly M2RankedTaskResult[],
): M2RetrievalMetrics {
  if (results.length === 0) throw new Error('M2.3 retrieval results must not be empty.')

  const resultTaskIds = new Set<string>()
  for (const result of results) {
    if (resultTaskIds.has(result.task.id)) {
      throw new Error(`Duplicate M2.3 ranked result for task ${result.task.id}.`)
    }
    resultTaskIds.add(result.task.id)
  }

  const answerable = results.filter(result => result.task.expectNoResult !== true)
  const noResult = results.filter(result => result.task.expectNoResult === true)
  const forbidden = results.filter(result => (result.task.forbiddenContractIds?.length ?? 0) > 0)
  if (answerable.length === 0) throw new Error('M2.3 retrieval metrics require answerable tasks.')
  if (noResult.length === 0) throw new Error('M2.3 retrieval metrics require no-result tasks.')
  if (forbidden.length === 0) throw new Error('M2.3 retrieval metrics require forbidden-bearing tasks.')

  const byCategory: Record<M2RetrievalCategory, M2CategoryMetrics> = {
    'exact-symbol': categoryMetrics(results.filter(result => result.task.category === 'exact-symbol')),
    'package-api': categoryMetrics(results.filter(result => result.task.category === 'package-api')),
    'natural-language': categoryMetrics(results.filter(result => result.task.category === 'natural-language')),
    indirect: categoryMetrics(results.filter(result => result.task.category === 'indirect')),
    ambiguous: categoryMetrics(results.filter(result => result.task.category === 'ambiguous')),
    'no-result': categoryMetrics(results.filter(result => result.task.category === 'no-result')),
  }

  return Object.freeze({
    taskCount: results.length,
    answerableTaskCount: answerable.length,
    noResultTaskCount: noResult.length,
    successAt1: successAt(answerable, 1),
    successAt3: successAt(answerable, 3),
    successAt5: successAt(answerable, 5),
    meanReciprocalRank: reciprocalRankMean(answerable),
    noResultCorrectness: noResultCorrectness(noResult),
    forbiddenHitRateAt5: forbiddenHitRateAt5(forbidden),
    byCategory: Object.freeze(byCategory),
  })
}
