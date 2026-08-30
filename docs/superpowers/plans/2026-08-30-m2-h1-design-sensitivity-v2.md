# M2.3 H1 Prospective Design Sensitivity v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, P0-independent prospective sensitivity engine that applies a pre-frozen task-count selection rule to synthetic task-level paired-effect distributions before hidden H1 authoring or execution.

**Architecture:** `h1-prospective-design-v2.json` is the immutable pre-analysis input. The engine validates it closed-world, computes exact scenario means/variances from discrete three-trial task effects, applies a transparent normal planning approximation for lower-bound pass probability, evaluates every frozen selection criterion, and mechanically selects the smallest passing candidate or returns `INADEQUATE`. It never reads P0, provider, hidden H1 or production retrieval state and cannot replace canonical H1 inference.

**Tech Stack:** TypeScript 6, Vitest 4, Node.js; no new dependencies, network, provider calls or random-number generator.

**Spec:** Issue #83; `docs/evaluation/m2/h1-prospective-design-v2.json`; `docs/evaluation/m2/h1-design-rationale-v2.md`; parent #34/#28.

## Global Constraints

- Evaluation/governance only; no production `src/**`, Protocol, Contract Index/ranking or provider workflow changes.
- `MCID=0.10` and `NI=0.05` are product-significance decisions frozen before sensitivity output.
- Candidate task counts, scenarios and selection criteria are frozen before implementation output.
- Task is the analysis unit; effects are multiples of one third because each task/arm averages exactly three trial indicators.
- Canonical H1 inference remains paired-task percentile bootstrap, 10,000 resamples, confidence level 0.95, two-sided lower quantile 0.025.
- Planning approximation is diagnostic only: normal approximation using exact frozen scenario variance and fixed z=1.959963984540054.
- No `Math.random`, Monte Carlo, P0 inputs, retained run data or H1 outcomes.
- If no candidate satisfies all criteria, return `INADEQUATE`; do not mutate this design in place.

---

### Task 1: Freeze pre-analysis design and clean RED

**Files:**
- Create: `docs/evaluation/m2/h1-prospective-design-v2.json`
- Create: `docs/evaluation/m2/h1-design-rationale-v2.md`
- Create: `tests/evaluation/m2-h1-design-sensitivity-v2.spec.ts`
- Create later: `tests/evaluation/m2-h1-design-sensitivity-v2.ts`

**Interfaces:**
- Consumes: frozen JSON design only.
- Produces later: `validateH1ProspectiveDesignV2()` and `analyzeH1ProspectiveDesignV2()`.

- [ ] Commit the complete pre-analysis design, rationale and tests before implementation.
- [ ] Tests import the missing engine and therefore establish RED without observing a sensitivity result.
- [ ] Run exact CI and require the only TypeScript failure to be the intentionally missing module.

### Task 2: Closed-world design validation

**Files:**
- Create: `tests/evaluation/m2-h1-design-sensitivity-v2.ts`
- Test: `tests/evaluation/m2-h1-design-sensitivity-v2.spec.ts`

**Interfaces:**

```ts
export interface H1ProspectiveDesignV2 { /* frozen schema projection */ }

export function validateH1ProspectiveDesignV2(value: unknown): H1ProspectiveDesignV2
```

- [ ] Require exact schema/version/status, `analysisUnit=task`, `trialsPerTaskArm=3`.
- [ ] Require MCID exactly 0.10 and NI exactly 0.05 for this frozen design version.
- [ ] Require canonical H1 inference identity including two-sided 95%, lowerQuantile 0.025, 10,000 resamples and frozen seeds.
- [ ] Require planning approximation identity and exact z constant.
- [ ] Require strictly increasing unique positive candidate task counts.
- [ ] Validate scenario ids, purposes, declared means, effect distributions and unique criteria.
- [ ] Reject unknown object keys so silent design drift cannot pass validation.

### Task 3: Exact discrete scenario moments

**Interfaces:**

```ts
export interface H1EffectMomentsV2 {
  readonly mean: number
  readonly variance: number
  readonly standardDeviation: number
}

export function h1EffectMomentsV2(
  distribution: readonly { effectThirds: number; weight: number }[],
): H1EffectMomentsV2
```

- [ ] Require `effectThirds` integer in [-3,3].
- [ ] Require finite weights in (0,1] summing to 1 within 1e-12.
- [ ] Compute effect as `effectThirds / 3`.
- [ ] Validate frozen `expectedPrimaryMean` and `expectedGuardrailMean` within 1e-12.
- [ ] Test that all scenario means are produced mathematically rather than trusted from labels.

### Task 4: Prospective lower-bound sensitivity

**Interfaces:**

```ts
export interface H1EndpointSensitivityV2 {
  readonly mean: number
  readonly standardDeviation: number
  readonly threshold: number
  readonly estimatorResolution: number
  readonly expectedLowerBound: number
  readonly passProbability: number
}
```

For candidate `N`:

- [ ] `estimatorResolution = 1 / (3*N)`.
- [ ] Primary threshold is MCID.
- [ ] Guardrail threshold is `-NI`.
- [ ] Compute expected lower bound using exact scenario standard deviation and frozen z.
- [ ] Compute normal planning pass probability with a deterministic standard-normal CDF approximation.
- [ ] Handle zero-variance distributions exactly without division by zero.
- [ ] Test boundary scenarios: at-MCID and at-`-NI` pass probability is approximately 0.025, independent of N when variance is nonzero.

### Task 5: Mechanical candidate selection

**Interfaces:**

```ts
export interface H1ProspectiveSensitivityReportV2 {
  readonly schema: 'dsh-toolchain-m2-h1-sensitivity-report-v2'
  readonly designStatus: 'FROZEN-PRE-ANALYSIS'
  readonly candidates: readonly H1CandidateSensitivityV2[]
  readonly selectedTaskCount: number | null
  readonly outcome: 'ADEQUATE' | 'INADEQUATE'
}

export function analyzeH1ProspectiveDesignV2(value: unknown): H1ProspectiveSensitivityReportV2
```

- [ ] Compute every scenario/endpoint for every candidate.
- [ ] Evaluate criteria only by their frozen comparator/value.
- [ ] Select the smallest candidate satisfying every criterion.
- [ ] If none satisfy, return `selectedTaskCount=null`, `INADEQUATE`.
- [ ] Boundary diagnostics are reported but never used as hidden selection criteria.
- [ ] Tests prove candidate order does not alter mathematical results after validation and that removing the selected candidate chooses the next valid one rather than changing thresholds.

### Task 6: P0/H1 anti-contamination boundary

- [ ] Read the engine source in a policy-style test.
- [ ] Assert it contains no import/read reference to `p0-live`, `p0-readjudication`, `agent-pilot-p0`, `m2-agent-p0-*`, provider probes or H1 result data.
- [ ] Assert it has no `Math.random` and no filesystem/network import.
- [ ] The engine receives the design object as its only domain input.

### Task 7: GREEN, report freeze and follow-on gate

- [ ] Run exact-head CI: Node 22/24/26, Windows/macOS, full `pnpm check`, package and DSH lanes.
- [ ] Diff audit: evaluation docs/tests only; no H1 hidden bytes or provider data.
- [ ] Merge the engine only after exact-head GREEN and verify post-merge main CI.
- [ ] **Only after that merge**, run the now-frozen engine against the already-frozen design and persist a separate sensitivity report.
- [ ] The report may freeze the mechanically selected task count into H1 readiness only if `outcome=ADEQUATE`; otherwise H1 remains BLOCKED and a separately versioned design is required.
- [ ] Do not author hidden H1 tasks before the selected count is frozen.
