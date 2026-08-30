import { canonicalizeEvaluationJson } from './m2-agent-eval-integrity.js'
import {
  validateH1TaskSuccessRuleV2,
  type H1TaskSuccessRuleV2,
} from './m2-h1-task-adjudication-v2.js'

export const H1_DATASET_CONSTRUCTION_POLICY_ID_V2 = 'dsh-toolchain-m2-h1-dataset-construction-v2' as const

const EXPECTED_TASK_COUNT = 96
const MIN_DOMAIN_COUNT = 8
const MAX_DOMAIN_COUNT = 16
const MIN_TASKS_PER_DOMAIN = 4
const MAX_TASKS_PER_DOMAIN = 16
const EXPECTED_POSITIVE_TASK_COUNT = 72
const EXPECTED_ABSENCE_TASK_COUNT = 24
const MAX_CANONICAL_RULE_REPETITIONS = 2
const MAX_ATOMIC_CLAIM_REPETITIONS = 2

const TREATMENT_CUES = Object.freeze([
  { label: 'contract.search', pattern: /contract\.search/iu },
  { label: 'contract.inspect', pattern: /contract\.inspect/iu },
  { label: 'DSH Toolchain', pattern: /\bdsh\s+toolchain\b/iu },
  { label: 'successRule', pattern: /\bsuccessrule\b/iu },
  { label: 'arm label', pattern: /\barm\s*[abc]\b/iu },
])

export interface H1DatasetConstructionSummaryV2 {
  readonly policyId: typeof H1_DATASET_CONSTRUCTION_POLICY_ID_V2
  readonly taskCount: number
  readonly domainCount: number
  readonly minimumTasksPerDomain: number
  readonly maximumTasksPerDomain: number
  readonly positiveTaskCount: number
  readonly absenceTaskCount: number
  readonly uniqueNormalizedPromptCount: number
  readonly uniqueCanonicalRuleCount: number
  readonly uniqueAtomicClaimCount: number
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function normalizePrompt(value: string): string {
  const tokens = value
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? []
  return tokens.join(' ')
}

function incrementCount(map: Map<string, number>, key: string): number {
  const next = (map.get(key) ?? 0) + 1
  map.set(key, next)
  return next
}

function atomicClaimKeys(rule: H1TaskSuccessRuleV2): readonly string[] {
  if (rule.kind === 'api-exists-any') {
    return rule.symbols.map(symbol => `exists:${rule.package}:${symbol}`)
  }
  const scope = rule.proofScope.kind === 'target'
    ? 'target'
    : `package:${rule.proofScope.package}`
  return rule.symbols.map(symbol => `absent:${scope}:${symbol}`)
}

export function validateH1DatasetConstructionPolicyV2(value: unknown): H1DatasetConstructionSummaryV2 {
  const dataset = requireRecord(value, 'H1 dataset construction input')
  if (!Array.isArray(dataset.tasks)) throw new Error('H1 dataset construction tasks must be an array')
  if (dataset.tasks.length !== EXPECTED_TASK_COUNT || dataset.taskCount !== EXPECTED_TASK_COUNT) {
    throw new Error(`H1 dataset construction requires exactly ${EXPECTED_TASK_COUNT} tasks`)
  }

  const domainCounts = new Map<string, number>()
  const normalizedPrompts = new Set<string>()
  const canonicalRuleCounts = new Map<string, number>()
  const atomicClaimCounts = new Map<string, number>()
  let positiveTaskCount = 0
  let absenceTaskCount = 0

  dataset.tasks.forEach((taskValue, index) => {
    const task = requireRecord(taskValue, `H1 construction task[${index}]`)
    const id = requireString(task.id, `H1 construction task[${index}].id`)
    const domain = requireString(task.domain, `H1 construction task ${id} domain`)
    incrementCount(domainCounts, domain)

    const prompt = requireString(task.prompt, `H1 construction task ${id} prompt`)
    for (const cue of TREATMENT_CUES) {
      if (cue.pattern.test(prompt)) {
        throw new Error(`H1 dataset construction prompt ${id} contains treatment cue ${cue.label}`)
      }
    }
    const normalizedPrompt = normalizePrompt(prompt)
    if (normalizedPrompt.length === 0) {
      throw new Error(`H1 dataset construction prompt ${id} has no normalized lexical content`)
    }
    if (normalizedPrompts.has(normalizedPrompt)) {
      throw new Error(`H1 dataset construction has duplicate normalized prompt at ${id}`)
    }
    normalizedPrompts.add(normalizedPrompt)

    const rule = validateH1TaskSuccessRuleV2(task.successRule)
    if (rule.kind === 'api-exists-any') positiveTaskCount += 1
    else absenceTaskCount += 1

    const canonicalRule = canonicalizeEvaluationJson(rule)
    if (incrementCount(canonicalRuleCounts, canonicalRule) > MAX_CANONICAL_RULE_REPETITIONS) {
      throw new Error(
        `H1 dataset construction repeats one canonical success-rule proposition more than ${MAX_CANONICAL_RULE_REPETITIONS} times`,
      )
    }

    for (const atomicClaim of atomicClaimKeys(rule)) {
      if (incrementCount(atomicClaimCounts, atomicClaim) > MAX_ATOMIC_CLAIM_REPETITIONS) {
        throw new Error(
          `H1 dataset construction repeats atomic API claim ${atomicClaim} more than ${MAX_ATOMIC_CLAIM_REPETITIONS} times`,
        )
      }
    }
  })

  if (domainCounts.size < MIN_DOMAIN_COUNT || domainCounts.size > MAX_DOMAIN_COUNT) {
    throw new Error(
      `H1 dataset construction requires ${MIN_DOMAIN_COUNT}..${MAX_DOMAIN_COUNT} domains; observed ${domainCounts.size}`,
    )
  }
  const counts = [...domainCounts.values()]
  const minimumTasksPerDomain = Math.min(...counts)
  const maximumTasksPerDomain = Math.max(...counts)
  if (minimumTasksPerDomain < MIN_TASKS_PER_DOMAIN || maximumTasksPerDomain > MAX_TASKS_PER_DOMAIN) {
    throw new Error(
      `H1 dataset construction requires ${MIN_TASKS_PER_DOMAIN}..${MAX_TASKS_PER_DOMAIN} tasks per represented domain`,
    )
  }

  if (
    positiveTaskCount !== EXPECTED_POSITIVE_TASK_COUNT
    || absenceTaskCount !== EXPECTED_ABSENCE_TASK_COUNT
  ) {
    throw new Error(
      `H1 dataset construction balance must be ${EXPECTED_POSITIVE_TASK_COUNT} api-exists-any / ${EXPECTED_ABSENCE_TASK_COUNT} api-absent tasks`,
    )
  }

  return Object.freeze({
    policyId: H1_DATASET_CONSTRUCTION_POLICY_ID_V2,
    taskCount: EXPECTED_TASK_COUNT,
    domainCount: domainCounts.size,
    minimumTasksPerDomain,
    maximumTasksPerDomain,
    positiveTaskCount,
    absenceTaskCount,
    uniqueNormalizedPromptCount: normalizedPrompts.size,
    uniqueCanonicalRuleCount: canonicalRuleCounts.size,
    uniqueAtomicClaimCount: atomicClaimCounts.size,
  })
}
