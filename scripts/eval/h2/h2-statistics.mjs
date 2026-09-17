import { H2_POLICY } from './h2-config.mjs'
import { requireNonNegativeSafeInteger } from './h2-util.mjs'

/** @typedef {{ bSuccess: boolean; cSuccess: boolean; resolved: boolean }} H2TaskPair */

/**
 * Exact one-sided paired McNemar p-value.
 *
 * Under the null, discordant pairs split B/C with p = 0.5, so the
 * probability of observing cOnly or more C-only discordant wins among
 * n = cOnly + bOnly discordant pairs is the upper tail of Bin(n, 0.5):
 *
 *   P = sum_{k=cOnly..n} C(n, k) / 2^n
 *
 * Computed with BigInt binomial coefficients; n <= 36 here, so the exact
 * dyadic rational converts to a Number without precision loss.
 */
export function exactOneSidedMcNemarP({ cOnly, bOnly }) {
  const c = requireNonNegativeSafeInteger(cOnly, 'cOnly')
  const b = requireNonNegativeSafeInteger(bOnly, 'bOnly')
  const n = c + b
  if (n === 0) return 1
  const denom = 2n ** BigInt(n)
  let tail = 0n
  for (let k = c; k <= n; k += 1) tail += binomial(n, k)
  return Number(tail) / Number(denom)
}

/** Exact C(n, k) via the multiplicative formula, BigInt throughout. */
function binomial(n, k) {
  const safe = Math.min(k, n - k)
  let result = 1n
  for (let i = 1; i <= safe; i += 1) {
    result = (result * BigInt(n - safe + i)) / BigInt(i)
  }
  return result
}

/**
 * Builds the paired contingency over resolved task pairs:
 * `{ bothSuccess, bOnly, cOnly, bothFail, totalPairs }`.
 */
export function buildContingency(pairs) {
  const contingency = { bothSuccess: 0, bOnly: 0, cOnly: 0, bothFail: 0, totalPairs: 0 }
  for (const pair of pairs) {
    if (pair === null || typeof pair !== 'object') throw new Error('H2 pair must be an object')
    contingency.totalPairs += 1
    if (pair.bSuccess === true && pair.cSuccess === true) contingency.bothSuccess += 1
    else if (pair.bSuccess === true && pair.cSuccess === false) contingency.bOnly += 1
    else if (pair.bSuccess === false && pair.cSuccess === true) contingency.cOnly += 1
    else if (pair.bSuccess === false && pair.cSuccess === false) contingency.bothFail += 1
    else throw new Error('H2 pair booleans must be true/false')
  }
  return Object.freeze(contingency)
}

/**
 * Per-arm success rates and the paired delta over resolved pairs.
 * Throws when any pair is unresolved: unresolvable observations must be
 * handled by the run-level STOP policy, never silently dropped.
 */
export function computePairedOutcomes(pairs) {
  const contingency = buildContingency(pairs)
  const { totalPairs } = contingency
  if (totalPairs <= 0) throw new Error('H2 paired analysis requires at least one resolved pair')
  let bSuccess = 0
  let cSuccess = 0
  for (const pair of pairs) {
    if (pair.resolved !== true) throw new Error('H2 paired analysis received an unresolved pair')
    if (pair.bSuccess === true) bSuccess += 1
    if (pair.cSuccess === true) cSuccess += 1
  }
  return Object.freeze({
    bSuccess,
    cSuccess,
    bSuccessRate: bSuccess / totalPairs,
    cSuccessRate: cSuccess / totalPairs,
    delta: (cSuccess - bSuccess) / totalPairs,
  })
}

/**
 * The H2 confirmatory decision:
 *
 * - `STOPPED_INVALID` — any observation is unresolved (infrastructure or
 *   measurement failure); no confirmatory estimate may be computed.
 * - `CONFIRMED_BENEFIT` — requires simultaneously C success > B success,
 *   delta >= MCID (2/18), and one-sided exact McNemar p <= 0.05.
 * - `INCONCLUSIVE` — everything resolved but the confirmatory threshold is
 *   not met. A non-significant or negative signal is never interpreted as
 *   proof of absence of benefit.
 *
 * @typedef {object} H2Decision
 * @property {string} outcome
 * @property {string} reason
 * @property {Readonly<{bothSuccess: number, bOnly: number, cOnly: number, bothFail: number, totalPairs: number}>} contingency
 * @property {number} [delta]
 * @property {number} [pValue]
 *
 * @param {{pairs: H2TaskPair[], allResolved: boolean}} input
 * @returns {Readonly<H2Decision>}
 */
export function decideH2Outcome({ pairs, allResolved }) {
  if (allResolved !== true) {
    return Object.freeze({
      outcome: 'STOPPED_INVALID',
      reason: 'UNRESOLVED_OBSERVATIONS',
      contingency: buildContingency(pairs),
    })
  }
  const contingency = buildContingency(pairs)
  const { bSuccess, cSuccess, delta } = computePairedOutcomes(pairs)
  if (cSuccess <= bSuccess) {
    return Object.freeze({ outcome: 'INCONCLUSIVE', reason: 'NO_POSITIVE_DELTA', contingency, delta })
  }
  const discordantWins = contingency.cOnly - contingency.bOnly
  if (discordantWins < H2_POLICY.statistics.minimumDiscordantWins) {
    return Object.freeze({ outcome: 'INCONCLUSIVE', reason: 'DELTA_BELOW_MCID', contingency, delta })
  }
  const pValue = exactOneSidedMcNemarP({ cOnly: contingency.cOnly, bOnly: contingency.bOnly })
  if (pValue > H2_POLICY.statistics.alpha) {
    return Object.freeze({ outcome: 'INCONCLUSIVE', reason: 'MCNEMAR_ABOVE_ALPHA', contingency, delta, pValue })
  }
  return Object.freeze({ outcome: 'CONFIRMED_BENEFIT', reason: 'PREREGISTERED_THRESHOLD_MET', contingency, delta, pValue })
}