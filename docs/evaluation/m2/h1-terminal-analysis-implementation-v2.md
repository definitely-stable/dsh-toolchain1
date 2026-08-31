# H1 terminal analysis implementation v2

Status: **FROZEN BEFORE TERMINAL H1 ANALYSIS**

This document fixes the implementation details needed to execute the already-preregistered H1 analysis without changing its scientific design. It does not change the H1 task set, arms, provider, retry policy, MCID, non-inferiority margin, analysis unit, seeds or resample count.

The terminal path is offline and read-only with respect to H1 execution. It accepts only a durable run-store whose canonical ledger validates as `COMPLETE`, reloads every ledger-referenced durable attempt evidence object, rebuilds frozen Truth v2, and re-adjudicates every retained model raw answer with `dsh-toolchain-m2-h1-task-adjudicator-v2`. Stored `parsedApiClaims` and `taskSuccess` must exactly match fresh adjudication or finalization fails closed.

For each of the 96 tasks, the primary task effect is the mean invalid-API indicator across the three B trials minus the mean across the three C trials. The guardrail task effect is the mean task-success indicator across the three C trials minus the mean across the three B trials. `INVALID` contributes 1 to the invalid indicator; otherwise 0. `SUCCESS` contributes 1 to task success and `FAILURE` contributes 0. Any B/C `UNKNOWN` API classification, B/C `UNKNOWN` task success, missing B/C model outcome, or exhausted infrastructure state makes the terminal decision `INCONCLUSIVE`; unresolved evidence is never converted into a favorable 0/1 score.

Both endpoints use 10,000 paired-task bootstrap resamples over the 96 task effects. Each resample draws 96 task indices with replacement and averages the selected task effects. The primary seed is `m2-v2-primary`; the guardrail seed is `m2-v2-guardrail`. A seed string is converted to a 32-bit initial state from the first eight hexadecimal characters of its SHA-256 digest; sampling uses the fixed 32-bit Mulberry32 transition implemented in `m2-h1-terminal-analysis-v2.ts`.

The empirical bootstrap distribution is sorted numerically and quantiles use linear Type-7 interpolation: position `(n - 1) * p`, linear interpolation between the floor and ceiling positions. The reported two-sided 95% interval uses `p=0.025` and `p=0.975`.

`PASS` requires the primary lower bound to be at least `0.10` and the guardrail lower bound to be at least `-0.05`. Fully resolved evidence that misses either rule is `NEEDS-IMPROVEMENT`. Incomplete/unresolved decision evidence is `INCONCLUSIVE`.

The full reconstructed v2 result is finally checked by `validateAgentV2ResultAgainstDefinition()` against the exact frozen H1 definition before any terminal artifact is emitted. The workflow performs no provider/model call and requires no provider credential.
