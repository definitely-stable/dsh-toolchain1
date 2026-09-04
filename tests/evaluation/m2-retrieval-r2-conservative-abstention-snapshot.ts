import type { R2RankedResult } from './m2-retrieval-r2-comparison.js'

export const R2_CONSERVATIVE_ABSTENTION_FREEZE_RANKER_VERSION =
  'dsh-contract-search-v3-conservative-abstention'
export const R2_CONSERVATIVE_ABSTENTION_FREEZE_CORPUS_FINGERPRINT =
  'dsh-contract-search-r2-dev-v1:f2ba02022f1567a3ab748d8182e113d63773556020ab70f3738299645ef4e1b4'
export const R2_CONSERVATIVE_ABSTENTION_FREEZE_COMMIT =
  '7ea5b095ec6730e279195f0d83c3d230e7085c68'

export const R2_CONSERVATIVE_ABSTENTION_FREEZE_RESULTS: readonly R2RankedResult[] = Object.freeze([
  { taskId: 'r2-natural-prompt-context-order', rankedContractIds: ['package:@deepseek-ai/dsh-system-prompt'] },
  { taskId: 'r2-natural-question-choice-flow', rankedContractIds: [] },
  { taskId: 'r2-indirect-child-final-message', rankedContractIds: ['package:@deepseek-ai/dsh-subagent'] },
  { taskId: 'r2-indirect-scope-ancestry', rankedContractIds: [] },
  { taskId: 'r2-long-tools-schema-validation', rankedContractIds: ['package:@deepseek-ai/dsh-llm'] },
  { taskId: 'r2-long-session-text-query', rankedContractIds: ['package:@deepseek-ai/dsh-session-query'] },
  { taskId: 'r2-sibling-compaction-pruner', rankedContractIds: ['package:@deepseek-ai/dsh-compaction-tool-result-pruner'] },
  { taskId: 'r2-sibling-bash-sandbox', rankedContractIds: ['package:@deepseek-ai/dsh-bash-sandbox'] },
  { taskId: 'r2-fictional-tool-universe-transmuter', rankedContractIds: [] },
  { taskId: 'r2-fictional-session-quantum-indexer', rankedContractIds: [] },
  { taskId: 'r2-hard-negative-parallel-universe', rankedContractIds: [] },
  { taskId: 'r2-hard-negative-future-memory', rankedContractIds: ['package:@deepseek-ai/dsh-api-remotes'] },
  { taskId: 'r2-version-drift-tools-vnext-api', rankedContractIds: [] },
  { taskId: 'r2-version-drift-session-vnext-api', rankedContractIds: [] },
  { taskId: 'r2-rare-balanced-tool-pairing', rankedContractIds: ['package:@deepseek-ai/dsh-compaction'] },
  { taskId: 'r2-rare-session-search-documents', rankedContractIds: ['package:@deepseek-ai/dsh-session-query'] },
  { taskId: 'r2-coherent-bind-scope-parent', rankedContractIds: ['package:@deepseek-ai/dsh-scope'] },
  { taskId: 'r2-coherent-compact-checkpoint-source', rankedContractIds: ['package:@deepseek-ai/dsh-compaction'] },
].map(result => Object.freeze({
  taskId: result.taskId,
  rankedContractIds: Object.freeze([...result.rankedContractIds]),
})))
