/**
 * H2 frozen experimental policy.
 *
 * These constants are the immutable budget/identity/decision boundary of the
 * H2 confirmatory product benchmark. They MUST NOT be edited after any H2
 * scoring outcome exists; `h2 freeze` binds them into the preregistration
 * receipt and `h2 run` verifies the frozen copy before spending model tokens.
 */

export const H2_POLICY_SCHEMA = 'dsh-toolchain-h2-policy-v1'

/**
 * Reasoning levels the frozen route may pin. Owned here rather than by the
 * control plane so the policy and the ACP config-option surface cannot drift
 * apart silently: the control plane validates against this list.
 */
export const H2_REASONING_EFFORTS = Object.freeze(['off', 'low', 'high', 'max'])

/** The six frozen task strata, exactly three tasks each. */
export const H2_STRATA = Object.freeze([
  'exact-target-api',
  'cordis-service',
  'agent-tool',
  'plugin-composition',
  'compatibility-debug',
  'runtime-verification',
])

/**
 * Provider completions the public calibration task consumed when nothing
 * truncated it: measured 2026-09-16, unbounded, ending naturally on `end_turn`
 * after 28 tool calls and 107 s of wall time.
 *
 * It anchors the budget instead of leaving it to taste. A limit below the real
 * length of a task truncates every observation, which makes task success `false`
 * on *both* sides of every pair — so the confirmatory contrast collapses to
 * 0 vs 0 by construction, after the full budget has been spent. The dry run
 * proved that outcome is not hypothetical: at the provisional limit of 6, both
 * arms were cut off at 7 completions.
 */
export const H2_MEASURED_TASK_COMPLETIONS = 16

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
   *
   * AMENDED BEFORE ANY OUTCOME EXISTS. The route below is the one this
   * deployment can actually run: `opencode-go` (the OpenCode Zen relay)
   * serving DeepSeek V4.1 Flash — the same model the operator's own DSH
   * session runs on, through the only credential this machine holds. The
   * original preregistration named the official adapter
   * (`deepseek-official` / `deepseek-flash`), for which no credential exists
   * here at all, so that route could not have produced a single observation;
   * see docs/evaluation/h2/h2-design-preregistration.md section 11.
   *
   * The arm contrast is untouched by the amendment: the route is a controlled
   * constant, pinned identically in both arms, and is never part of the
   * Arm-C-minus-Arm-B difference.
   */
  model: Object.freeze({
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    modelDisplayName: 'DeepSeek V4.1 Flash',
    reasoningEffort: 'high',
    /**
     * Credential reference the route resolves per request. It is an
     * environment-variable name by DSH's own credential contract, resolved
     * from the inherited environment first and from the observation home's
     * credential document second.
     */
    credentialRef: 'OPENCODE_GO_API_KEY',
    /**
     * The relay rejects a model request that carries no routing header with
     * `400 MissingSessionID`, and the value only has to be opaque and stable
     * per conversation. The operator's own DSH supplies it through a plugin;
     * the benchmark pins it as route configuration instead, with one value per
     * observation, so no two observations can share a relay backend and no
     * arm can warm the other's prompt cache.
     */
    sessionAffinityHeader: 'x-opencode-session',
  }),

  /**
   * Frozen resource policy. Resource exhaustion is a product outcome
   * (RESOURCE_EXHAUSTED, task success 0), never an infrastructure failure.
   *
   * Amended before any scoring outcome exists: the completion limit was 6 and
   * the wall clock 180 s, both calibrated against nothing this corpus contains.
   * The limit is now 1.5x the measured natural length of a real task (24 over a
   * measured 16) and the wall clock is 600 s, which is 5.6x the 107 s that task
   * actually used. Both changes exist for the same reason: a budget that
   * truncates the agent turns a capability difference into a budget artefact.
   */
  resource: Object.freeze({
    attemptsPerObservation: 1,
    qualityRetries: 0,
    infrastructureRetries: 0,
    providerCompletionsLimit: 24,
    wallTimeLimitMs: 600_000,
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
  if (!Number.isSafeInteger(providerCompletionsLimit)
    || providerCompletionsLimit < H2_MEASURED_TASK_COMPLETIONS
    || providerCompletionsLimit > H2_MEASURED_TASK_COMPLETIONS * 3) {
    throw new Error(
      `H2 provider-completion limit must stay within ${H2_MEASURED_TASK_COMPLETIONS}-${H2_MEASURED_TASK_COMPLETIONS * 3}: `
      + 'below the measured task length it truncates every observation, above three times it a single observation can run away with the run',
    )
  }
  if (wallTimeLimitMs !== 600_000) throw new Error('H2 wall-time limit is frozen at 600s')
  const { provider, model, reasoningEffort, credentialRef, sessionAffinityHeader } = H2_POLICY.model
  for (const [label, value] of [['provider', provider], ['model', model], ['reasoningEffort', reasoningEffort]]) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`H2 frozen route ${label} must be a non-empty string`)
  }
  if (!H2_REASONING_EFFORTS.includes(reasoningEffort)) throw new Error(`H2 frozen reasoning effort must be one of ${H2_REASONING_EFFORTS.join(', ')}`)
  // A credential reference is a credential-store key, not a secret: it must be
  // a bare identifier so it can never smuggle a literal key into the policy.
  if (typeof credentialRef !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialRef)) {
    throw new Error('H2 frozen credentialRef must be a bare credential-reference identifier')
  }
  if (typeof sessionAffinityHeader !== 'string' || !/^x-[a-z0-9-]+$/.test(sessionAffinityHeader)) {
    throw new Error('H2 frozen session-affinity header must be a lowercase x- header name')
  }
}
