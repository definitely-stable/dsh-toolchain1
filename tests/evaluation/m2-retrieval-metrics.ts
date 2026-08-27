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
  readonly query: string
  readonly expectedContractIds: readonly string[]
  readonly forbiddenContractIds?: readonly string[]
  readonly expectNoResult?: boolean
  readonly provenance: string
}

export interface M2RankedTaskResult {
  readonly task: M2RetrievalTask
  readonly rankedContractIds: readonly string[]
}

export interface M2CategoryMetrics {
  readonly taskCount: number
  readonly recallAt1: number | null
  readonly recallAt3: number | null
  readonly recallAt5: number | null
  readonly meanReciprocalRank: number | null
  readonly noResultCorrectness: number | null
  readonly wrongContractRate: number | null
}

export interface M2RetrievalMetrics {
  readonly taskCount: number
  readonly answerableTaskCount: number
  readonly noResultTaskCount: number
  readonly recallAt1: number
  readonly recallAt3: number
  readonly recallAt5: number
  readonly meanReciprocalRank: number
  readonly noResultCorrectness: number
  readonly wrongContractRate: number
  readonly byCategory: Readonly<Record<M2RetrievalCategory, M2CategoryMetrics>>
}

export function validateM2RetrievalCorpus(
  tasks: readonly M2RetrievalTask[],
  knownContractIds: ReadonlySet<string>,
): void {
  void tasks
  void knownContractIds
  throw new Error('M2.3 retrieval corpus validation is not implemented')
}

export function calculateM2RetrievalMetrics(
  results: readonly M2RankedTaskResult[],
): M2RetrievalMetrics {
  void results
  throw new Error('M2.3 retrieval metrics are not implemented')
}
