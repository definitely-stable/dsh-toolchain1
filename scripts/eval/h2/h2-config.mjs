/**
 * H2 frozen experimental policy.
 *
 * These constants are the immutable budget/identity/decision boundary of the
 * H2 confirmatory product benchmark. They MUST NOT be edited after any H2
 * scoring outcome exists; `h2 freeze` binds them into the preregistration
 * receipt and `h2 run` verifies the frozen copy before spending model tokens.
 */

export const H2_POLICY_SCHEMA = 'dsh-toolchain-h2-policy-v1'

/** The six frozen task strata, exactly three tasks each. */
export const H2_STRATA = Object.freeze([
  'exact-target-api',
  'cordis-service',
  'agent-tool',
  'plugin-composition',
  'compatibility-debug',
  'runtime-verification',
])

export const H2_POLICY = Object.freeze({
  schema: H2_POLICY_SCHEMA,
  taskCount: 18,
  arms: Object.freeze(['B', 'C']),
  tasksPerStratum: 3,
  scoringObservations: 36,
  technicalObservations: 2,
  maxObservations: 38,

  /**
   * Exact model identity for every observation of both arms.
   * provider `deepseek-official` + model `deepseek-flash` is DeepSeek V4.1
   * Flash in the official DSH adapter (`@deepseek-ai/dsh-llm-deepseek`),
   * whose default reasoning effort is `high`. Pinned explicitly anyway.
   */
  model: Object.freeze({
    provider: 'deepseek-official',
    model: 'deepseek-flash',
    modelDisplayName: 'DeepSeek-V41-Flash',
    reasoningEffort: 'high',
  }),

  /**
   * Frozen resource policy. Resource exhaustion is a product outcome
   * (RESOURCE_EXHAUSTED, task success 0), never an infrastructure failure.
   */
  resource: Object.freeze({
    attemptsPerObservation: 1,
    qualityRetries: 0,
    infrastructureRetries: 0,
    providerCompletionsLimit: 6,
    wallTimeLimitMs: 180_000,
  }),

  /**
   * Frozen confirmatory decision rule: exact paired McNemar, one-sided,
   * alpha 0.05, MCID = 2/18 discordant wins (11.11 percentage points).
   */
  statistics: Object.freeze({
    test: 'exact-paired-mcnemar-one-sided',
    alpha: 0.05,
    minimumDiscordantWins: 2,
    minimumDelta: 2 / 18,
  }),

  /**
   * Frozen schedule: seeded pseudo-random task order; nine task pairs run
   * B->C, nine run C->B. The seed never changes after any outcome exists.
   */
  schedule: Object.freeze({
    seed: 'h2-product-benchmark-v1-schedule',
    balancedArmOrderTasks: 9,
  }),

  /**
   * The causal boundary: Arm C = Arm B + the production DSH Toolchain
   * bundle (a single inserted composition row), nothing else.
   */
  toolchainPatch: Object.freeze({
    patchFile: 'cordis.patch.yml',
    rowId: 'dsh-toolchain',
    rowName: 'dsh-toolchain/dsh',
    bundle: 'dsh-toolchain',
  }),
  toolchainToolPrefix: 'toolchain_',
  armsDifferOnlyBy: Object.freeze({ extraBundle: 'dsh-toolchain' }),
})

/**
 * Throws when the frozen policy violates any internal integrity invariant.
 * Kept as an executable gate so accidental policy edits fail tests loudly.
 */
export function assertH2PolicyIntegrity() {
  const { taskCount, arms, tasksPerStratum, scoringObservations, technicalObservations, maxObservations } = H2_POLICY
  for (const value of [taskCount, tasksPerStratum, scoringObservations, technicalObservations, maxObservations]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('H2 policy numeric fields must be non-negative safe integers')
  }
  if (arms.length !== 2 || arms[0] !== 'B' || arms[1] !== 'C') throw new Error('H2 arms must be exactly B, C')
  if (taskCount !== scoringObservations / arms.length) throw new Error('H2 scoring budget must be taskCount x arms')
  if (scoringObservations + technicalObservations !== maxObservations) throw new Error('H2 total budget must be scoring + technical observations')
  if (H2_STRATA.length * tasksPerStratum !== taskCount) throw new Error('H2 strata split must cover exactly the task count')
  if (H2_POLICY.schedule.balancedArmOrderTasks * 2 !== taskCount) throw new Error('H2 arm-order balance must split the task count in half')
  if (H2_POLICY.statistics.alpha !== 0.05) throw new Error('H2 alpha is frozen at 0.05')
  if (H2_POLICY.statistics.minimumDiscordantWins !== 2) throw new Error('H2 MCID is frozen at 2/18 discordant wins')
  const { attemptsPerObservation, qualityRetries, infrastructureRetries, providerCompletionsLimit, wallTimeLimitMs } = H2_POLICY.resource
  if (attemptsPerObservation !== 1 || qualityRetries !== 0 || infrastructureRetries !== 0) {
    throw new Error('H2 retry policy is frozen: one attempt, zero quality retries, zero infrastructure retries')
  }
  if (!Number.isSafeInteger(providerCompletionsLimit) || providerCompletionsLimit < 6 || providerCompletionsLimit > 8) {
    throw new Error('H2 provider-completion limit must stay within the approved 6-8 range')
  }
  if (wallTimeLimitMs !== 180_000) throw new Error('H2 wall-time limit is frozen at 180s')
}
