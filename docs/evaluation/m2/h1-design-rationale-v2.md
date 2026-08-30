# M2.3 H1 prospective design rationale v2

Status: **FROZEN-PRE-ANALYSIS**. This document and `h1-prospective-design-v2.json` are frozen before the sensitivity engine is implemented or any design result is observed. If the frozen candidate grid cannot satisfy its own selection criteria, this design is inadequate; do not edit the criteria in place to force a task count.

## Purpose

Choose an H1 task count prospectively from practical product thresholds and explicit synthetic task-level variability assumptions. This is a design diagnostic only. It must never replace the preregistered H1 paired-task bootstrap, and it must not read retained P0 effects or future H1 outcomes.

## Practical thresholds

### Invalid API Task Rate MCID = 0.10 absolute reduction

The product claim for Contract Intelligence is not merely that search/inspect can sometimes help, but that it materially reduces invalid DSH API claims against an exact installed target. An absolute ten-percentage-point reduction means preventing roughly one additional invalid-API task per ten comparable development tasks. Smaller changes are not sufficient evidence, on their own, to justify the added tool surface and agent workflow complexity.

This threshold is a product-significance decision. It is not estimated from P0 and must not be changed in response to P0/H1 effects.

### Task-success non-inferiority margin = 0.05

Toolchain must not buy fewer invalid API claims by materially reducing successful task completion. A five-percentage-point loss is the largest degradation accepted for the guardrail. This is deliberately tighter than the primary MCID because task completion is a fundamental capability rather than the improvement target.

This margin is likewise frozen independently of P0/H1 outcomes.

## Analysis unit and discreteness

Each task/arm has three trials. Trial indicators are averaged within task before B-vs-C comparison. Therefore task-level paired effects live on thirds and the H1 analysis unit is the task, not an individual model completion.

The prospective scenario file represents distributions of these valid task-level paired differences directly as `effectThirds ∈ {-3,-2,-1,0,1,2,3}`. This avoids pretending that nine model calls on one task are nine independent experimental units.

NIST guidance for paired observations analyzes within-pair differences, and NIST bootstrap guidance states that paired bootstrap samples must retain the same rows for the dependent variables. H1 therefore resamples tasks as intact paired units.

References:
- NIST/SEMATECH e-Handbook of Statistical Methods, paired-observation guidance: https://www.itl.nist.gov/div898/handbook/
- NIST Dataplot Bootstrap Plot reference: https://itl.nist.gov/div898/software/dataplot/refman1/auxillar/bootplot.htm

## Confidence-limit clarification

The historical preregistration froze `confidenceLevel = 0.95`, paired-task bootstrap, 10,000 resamples and fixed seeds, but did not explicitly encode whether the lower percentile was 0.05 or 0.025.

Before any H1 output, v2 resolves that ambiguity conservatively as a **two-sided 95% percentile interval**, so the decision uses the lower 0.025 percentile. NIST's bootstrap documentation reports 2.5/97.5 percentiles for the ordinary 95% two-sided percentile interval and distinguishes 5/95 percentiles separately.

Canonical H1 still uses 10,000 paired-task bootstrap resamples. The design sensitivity engine does not implement a replacement inference procedure.

## Prospective planning approximation

Nested bootstrap power simulation would be unnecessarily expensive and would add pseudo-precision unsupported by empirical H1 variance data. The pre-analysis design instead uses an exact mean/variance calculation over each explicitly frozen discrete task-effect distribution, followed by a normal planning approximation for the probability that a lower 95% confidence bound clears the relevant threshold.

For a scenario with task-level effect mean `μ`, standard deviation `σ`, task count `N`, threshold `τ`, and `z = 1.959963984540054`:

`expectedLowerBound = μ - z × σ / sqrt(N)`

and the planning pass probability is:

`Φ((μ - τ) × sqrt(N) / σ - z)`.

For the primary endpoint, `τ = MCID`. For the guardrail, `τ = -nonInferiorityMargin`.

This approximation is used only to size the holdout. Final H1 PASS/NEEDS-IMPROVEMENT remains determined by the frozen 10,000-resample paired-task bootstrap over observed task effects.

## Candidate grid and selection rule

Candidate task counts are frozen as `24, 32, 48, 64, 80, 96, 128`. The selected count is the **smallest candidate satisfying every frozen selection criterion**.

The criteria intentionally separate:

- type-I/false-accept behavior below the practical MCID;
- useful-effect sensitivity at 0.20 absolute primary improvement;
- neutral guardrail sensitivity;
- rejection of a materially harmful -0.10 guardrail effect;
- a high-heterogeneity/adverse-pairing stress case.

Boundary scenarios at exactly MCID and exactly `-NI` are diagnostics, not high-power targets. With a two-sided 95% lower limit, a true effect exactly on the decision threshold should only clear the lower-bound rule at approximately 2.5%; demanding 80% power at the boundary would be mathematically incoherent.

## Anti-overfitting boundary

The sensitivity implementation must not import, read or parse:

- retained P0 result/probe artifacts;
- `p0-readjudication-v2.json`;
- `agent-pilot-p0.json`;
- P0 adjudication/run modules;
- any H1 model output or provider metadata.

The only inputs are the frozen prospective design document and pure mathematical functions. If no candidate passes, create a separately versioned prospective design after review rather than editing this frozen design based on its output.
