import { createHash } from 'node:crypto'

export const R2_DEV_SCENARIOS = Object.freeze([
  'natural-paraphrase',
  'indirect-intent',
  'long-filler',
  'sibling-package-confusion',
  'fictional-identifier',
  'natural-hard-negative',
  'version-drift',
  'rare-supporting-term',
  'cross-fact-misleading',
] as const)

export type R2DevScenario = typeof R2_DEV_SCENARIOS[number]

export interface R2RetrievalTask {
  readonly id: string
  readonly scenario: R2DevScenario
  readonly domain: string
  readonly query: string
  readonly expectedContractIds: readonly string[]
  readonly forbiddenContractIds?: readonly string[]
  readonly expectNoResult?: boolean
  readonly referenceRoute: readonly string[]
  readonly provenance: string
}

const PROVENANCE =
  'newly authored from public @deepseek-ai/dsh@0.1.1-rc.2 declaration/package semantics; not selected from R1 or H1 outcomes'

function answerable(
  task: Omit<R2RetrievalTask, 'provenance' | 'expectNoResult'>,
): R2RetrievalTask {
  return Object.freeze({
    ...task,
    expectedContractIds: Object.freeze([...task.expectedContractIds]),
    ...(task.forbiddenContractIds === undefined
      ? {}
      : { forbiddenContractIds: Object.freeze([...task.forbiddenContractIds]) }),
    referenceRoute: Object.freeze([...task.referenceRoute]),
    provenance: PROVENANCE,
  })
}

function negative(
  task: Omit<R2RetrievalTask, 'provenance' | 'expectNoResult' | 'expectedContractIds'>,
): R2RetrievalTask {
  return Object.freeze({
    ...task,
    expectedContractIds: Object.freeze([]),
    ...(task.forbiddenContractIds === undefined
      ? {}
      : { forbiddenContractIds: Object.freeze([...task.forbiddenContractIds]) }),
    expectNoResult: true,
    referenceRoute: Object.freeze([...task.referenceRoute]),
    provenance: PROVENANCE,
  })
}

export const R2_RETRIEVAL_DEV: readonly R2RetrievalTask[] = Object.freeze([
  answerable({
    id: 'r2-natural-prompt-context-order',
    scenario: 'natural-paraphrase',
    domain: 'system-prompt',
    query: 'build the system instruction text while keeping the supplied context sections in their intended order',
    expectedContractIds: ['package:@deepseek-ai/dsh-system-prompt'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-system-prompt',
      'declaration-export:renderPrompt',
      'types:@deepseek-ai/dsh-system-prompt:lib/types/index.d.ts',
    ],
  }),
  answerable({
    id: 'r2-natural-question-choice-flow',
    scenario: 'natural-paraphrase',
    domain: 'user-questions',
    query: 'present a question to the human with a bounded set of choices and collect the selected answer',
    expectedContractIds: ['package:@deepseek-ai/dsh-user-questions'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-user-questions',
      'declaration-export:AskUserQuestionRequest',
      'types:@deepseek-ai/dsh-user-questions:lib/types/index.d.ts',
    ],
  }),

  answerable({
    id: 'r2-indirect-child-final-message',
    scenario: 'indirect-intent',
    domain: 'subagent',
    query: 'after a delegated child agent finishes, where do I read the assistant message it ultimately produced',
    expectedContractIds: ['package:@deepseek-ai/dsh-subagent'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-subagent',
      'declaration-export:finalAssistantOutput',
      'types:@deepseek-ai/dsh-subagent:lib/types/assistant-output.d.ts',
    ],
  }),
  answerable({
    id: 'r2-indirect-scope-ancestry',
    scenario: 'indirect-intent',
    domain: 'scope',
    query: 'given an owned carrier, I need to walk its dependency scope ancestry from the current scope upward',
    expectedContractIds: ['package:@deepseek-ai/dsh-scope'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-scope',
      'declaration-export:scopeChainOf',
      'types:@deepseek-ai/dsh-scope:lib/types/index.d.ts',
    ],
  }),

  answerable({
    id: 'r2-long-tools-schema-validation',
    scenario: 'long-filler',
    domain: 'tools',
    query: 'before I let the dispatcher invoke anything, I have a fairly large request object and only need the contract that checks the incoming tool arguments against the schema that the tool itself declared',
    expectedContractIds: ['package:@deepseek-ai/dsh-tools'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-tools',
      'declaration-export:validateArgs',
      'types:@deepseek-ai/dsh-tools:lib/types/schema.d.ts',
    ],
  }),
  answerable({
    id: 'r2-long-session-text-query',
    scenario: 'long-filler',
    domain: 'session-query',
    query: 'for a debugging screen I already have persisted session event records and do not want a model involved; I only need the API that compiles a text filter so those stored session events can be searched deterministically',
    expectedContractIds: ['package:@deepseek-ai/dsh-session-query'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-session-query',
      'declaration-export:compileSessionTextFilter',
      'types:@deepseek-ai/dsh-session-query:lib/types/filters.d.ts',
    ],
  }),

  answerable({
    id: 'r2-sibling-compaction-pruner',
    scenario: 'sibling-package-confusion',
    domain: 'compaction',
    query: 'which installed compaction package is specifically the tool result pruner rather than the general compaction engine',
    expectedContractIds: ['package:@deepseek-ai/dsh-compaction-tool-result-pruner'],
    forbiddenContractIds: [
      'package:@deepseek-ai/dsh-compaction',
      'package:@deepseek-ai/dsh-compaction-basic',
    ],
    referenceRoute: [
      'package:@deepseek-ai/dsh-compaction-tool-result-pruner',
      'manifest:@deepseek-ai/dsh-compaction-tool-result-pruner',
    ],
  }),
  answerable({
    id: 'r2-sibling-bash-sandbox',
    scenario: 'sibling-package-confusion',
    domain: 'bash',
    query: 'use the sandbox-backed bash package, not the local-machine bash implementation',
    expectedContractIds: ['package:@deepseek-ai/dsh-bash-sandbox'],
    forbiddenContractIds: ['package:@deepseek-ai/dsh-bash-local'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-bash-sandbox',
      'manifest:@deepseek-ai/dsh-bash-sandbox',
    ],
  }),

  negative({
    id: 'r2-fictional-tool-universe-transmuter',
    scenario: 'fictional-identifier',
    domain: 'tools',
    query: 'ToolUniverseTransmuter',
    referenceRoute: ['negative-oracle:rc2-contract-index:no-such-identifier'],
  }),
  negative({
    id: 'r2-fictional-session-quantum-indexer',
    scenario: 'fictional-identifier',
    domain: 'session-query',
    query: 'SessionQuantumIndexer',
    referenceRoute: ['negative-oracle:rc2-contract-index:no-such-identifier'],
  }),

  negative({
    id: 'r2-hard-negative-parallel-universe',
    scenario: 'natural-hard-negative',
    domain: 'conversation',
    query: 'find the contract that teleports the current conversation into a parallel universe while preserving alternate causal branches',
    referenceRoute: ['negative-oracle:rc2-contract-index:no-supported-operation'],
  }),
  negative({
    id: 'r2-hard-negative-future-memory',
    scenario: 'natural-hard-negative',
    domain: 'session-query',
    query: 'which contract reconstructs session events that have not happened yet and indexes those future memories for search',
    referenceRoute: ['negative-oracle:rc2-contract-index:no-supported-operation'],
  }),

  negative({
    id: 'r2-version-drift-tools-vnext-api',
    scenario: 'version-drift',
    domain: 'tools',
    query: '@deepseek-ai/dsh-tools validateToolGraphVNext from a later release',
    forbiddenContractIds: ['package:@deepseek-ai/dsh-tools'],
    referenceRoute: ['negative-oracle:rc2-contract-index:later-release-api-absent'],
  }),
  negative({
    id: 'r2-version-drift-session-vnext-api',
    scenario: 'version-drift',
    domain: 'session-query',
    query: '@deepseek-ai/dsh-session-query streamFutureSessionDocumentsVNext from a later release',
    forbiddenContractIds: ['package:@deepseek-ai/dsh-session-query'],
    referenceRoute: ['negative-oracle:rc2-contract-index:later-release-api-absent'],
  }),

  answerable({
    id: 'r2-rare-balanced-tool-pairing',
    scenario: 'rare-supporting-term',
    domain: 'compaction',
    query: 'balanced tool pairing after compaction',
    expectedContractIds: ['package:@deepseek-ai/dsh-compaction'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-compaction',
      'declaration-export:toolPairingBalancedAfter',
      'types:@deepseek-ai/dsh-compaction:lib/types/tool-pairing.d.ts',
    ],
  }),
  answerable({
    id: 'r2-rare-session-search-documents',
    scenario: 'rare-supporting-term',
    domain: 'session-query',
    query: 'materialize session event search documents',
    expectedContractIds: ['package:@deepseek-ai/dsh-session-query'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-session-query',
      'declaration-export:buildSessionEventSearchDocuments',
      'types:@deepseek-ai/dsh-session-query:lib/types/documents.d.ts',
    ],
  }),

  answerable({
    id: 'r2-coherent-bind-scope-parent',
    scenario: 'cross-fact-misleading',
    domain: 'scope',
    query: 'bind scope parent for a child scope',
    expectedContractIds: ['package:@deepseek-ai/dsh-scope'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-scope',
      'declaration-export:bindScopeParent',
      'types:@deepseek-ai/dsh-scope:lib/types/index.d.ts',
    ],
  }),
  answerable({
    id: 'r2-coherent-compact-checkpoint-source',
    scenario: 'cross-fact-misleading',
    domain: 'compaction',
    query: 'compact checkpoint source from conversation state',
    expectedContractIds: ['package:@deepseek-ai/dsh-compaction'],
    referenceRoute: [
      'package:@deepseek-ai/dsh-compaction',
      'declaration-export:compactCheckpointSource',
      'types:@deepseek-ai/dsh-compaction:lib/types/checkpoint.d.ts',
    ],
  }),
])

function nonEmpty(value: string, label: string, taskId: string): void {
  if (value.trim() === '') throw new Error(`R2 task ${taskId} must declare a non-empty ${label}.`)
}

function assertUniqueIds(ids: readonly string[], label: string, taskId: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    nonEmpty(id, label, taskId)
    if (seen.has(id)) throw new Error(`Duplicate ${label} ${id} on R2 task ${taskId}.`)
    seen.add(id)
  }
}

export function validateR2RetrievalCorpus(
  tasks: readonly R2RetrievalTask[],
  knownContractIds: ReadonlySet<string>,
): void {
  if (tasks.length === 0) throw new Error('R2 retrieval development corpus must not be empty.')

  const taskIds = new Set<string>()
  const scenarioCounts = new Map<R2DevScenario, number>()
  const knownScenarios = new Set<R2DevScenario>(R2_DEV_SCENARIOS)

  for (const task of tasks) {
    nonEmpty(task.id, 'task id', task.id || '<empty>')
    if (taskIds.has(task.id)) throw new Error(`Duplicate R2 task id ${task.id}.`)
    taskIds.add(task.id)

    if (!knownScenarios.has(task.scenario)) {
      throw new Error(`Unknown R2 scenario ${String(task.scenario)} on task ${task.id}.`)
    }
    scenarioCounts.set(task.scenario, (scenarioCounts.get(task.scenario) ?? 0) + 1)

    nonEmpty(task.domain, 'domain', task.id)
    nonEmpty(task.query, 'query', task.id)
    nonEmpty(task.provenance, 'provenance', task.id)
    if (task.referenceRoute.length === 0) {
      throw new Error(`R2 task ${task.id} must declare a non-empty reference route.`)
    }
    for (const segment of task.referenceRoute) nonEmpty(segment, 'reference route segment', task.id)

    assertUniqueIds(task.expectedContractIds, 'expected contract id', task.id)
    const forbidden = task.forbiddenContractIds ?? []
    assertUniqueIds(forbidden, 'forbidden contract id', task.id)

    if (task.expectNoResult === true) {
      if (task.expectedContractIds.length !== 0) {
        throw new Error(`No-result R2 task ${task.id} must not declare expected contracts.`)
      }
    } else if (task.expectedContractIds.length === 0) {
      throw new Error(`Answerable R2 task ${task.id} must declare at least one expected contract.`)
    }

    for (const id of task.expectedContractIds) {
      if (!knownContractIds.has(id)) throw new Error(`Unknown expected contract ${id} on R2 task ${task.id}.`)
    }
    for (const id of forbidden) {
      if (!knownContractIds.has(id)) throw new Error(`Unknown forbidden contract ${id} on R2 task ${task.id}.`)
      if (task.expectedContractIds.includes(id)) {
        throw new Error(`Contract ${id} is both expected and forbidden on R2 task ${task.id}.`)
      }
    }
  }

  for (const scenario of R2_DEV_SCENARIOS) {
    const count = scenarioCounts.get(scenario) ?? 0
    if (count === 0) throw new Error(`R2 retrieval development corpus is missing scenario ${scenario}.`)
    if (count < 2) throw new Error(`R2 scenario ${scenario} requires at least two tasks; found ${count}.`)
  }
}

interface CanonicalR2Task {
  readonly id: string
  readonly scenario: R2DevScenario
  readonly domain: string
  readonly query: string
  readonly expectedContractIds: readonly string[]
  readonly forbiddenContractIds: readonly string[]
  readonly expectNoResult: boolean
  readonly referenceRoute: readonly string[]
  readonly provenance: string
}

function canonicalTask(task: R2RetrievalTask): CanonicalR2Task {
  return {
    id: task.id,
    scenario: task.scenario,
    domain: task.domain,
    query: task.query,
    expectedContractIds: [...task.expectedContractIds].toSorted(),
    forbiddenContractIds: [...(task.forbiddenContractIds ?? [])].toSorted(),
    expectNoResult: task.expectNoResult === true,
    referenceRoute: [...task.referenceRoute],
    provenance: task.provenance,
  }
}

export function canonicalizeR2RetrievalCorpus(
  tasks: readonly R2RetrievalTask[],
  contractIndexFingerprint: string,
): string {
  nonEmpty(contractIndexFingerprint, 'contract index fingerprint', '<corpus>')
  return JSON.stringify({
    schema: 'dsh-contract-search-r2-dev-v1',
    contractIndexFingerprint,
    tasks: tasks.map(canonicalTask).toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  })
}

export function fingerprintR2RetrievalCorpus(
  tasks: readonly R2RetrievalTask[],
  contractIndexFingerprint: string,
): string {
  const canonical = canonicalizeR2RetrievalCorpus(tasks, contractIndexFingerprint)
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex')
  return `dsh-contract-search-r2-dev-v1:${digest}`
}
