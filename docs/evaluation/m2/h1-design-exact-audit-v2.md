# M2.3 H1 exact-discrete planning audit v2

Status: **IMPLEMENTATION-QA ONLY**.

This audit does not replace or mutate the frozen prospective design in `h1-prospective-design-v2.json`. The pre-analysis selection method remains `normal-known-scenario-variance-v1` with the already frozen thresholds, scenarios, candidate grid and criteria.

The audit exists to answer one narrower implementation-risk question before accepting that design: **does the normal planning approximation select the same minimum task count as an exact discrete calculation over the very same frozen task-effect distributions?**

For each candidate task count and endpoint, the audit:

1. keeps the frozen known scenario variance and the same lower-bound cutoff;
2. computes the exact probability distribution of the sum of task-level effects by deterministic convolution over `effectThirds ∈ {-3,-2,-1,0,1,2,3}`;
3. evaluates the existing frozen selection criteria with those exact probabilities;
4. independently derives the smallest exact passing candidate;
5. requires exact and approximate selected task counts to agree.

No P0 result, H1 result, provider observation, random-number generator, filesystem state or network input participates. The audit cannot change MCID, NI margin, task-effect scenarios, selection criteria or the candidate grid.

If exact and approximate selection disagree, the v2 prospective design is considered unsafe for commitment. Do **not** edit v2 thresholds or scenarios to force agreement. Review the discrepancy and create a separately versioned prospective design instead.

The exact audit is not the canonical H1 inference procedure. Final H1 still uses the preregistered paired-task percentile bootstrap with 10,000 resamples and the frozen seeds.
