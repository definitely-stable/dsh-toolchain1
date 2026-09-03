# Staged Evaluation Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual H1-scale development evaluation with a deterministic, budgeted, staged control plane that fails early on unhealthy measurement and reserves future H2 for a fresh hidden holdout.

**Architecture:** Repository-only `.mjs` scripts own immutable mode budgets and health decisions; an agent skill orchestrates them but cannot weaken them. H1 evidence is archived as development-only data, the one-shot finalizer is removed, and no production `src/**` or frozen H1 scoring contract is changed.

**Tech Stack:** Node.js 22.19+/24.19+, ESM `.mjs`, Vitest, GitHub Actions, repository `.agents` skill discovery.

**Spec:** `docs/superpowers/specs/2026-09-02-staged-eval-control-plane-design.md`

## Global Constraints

- H1 remains canonical `INCONCLUSIVE`; do not rerun or reinterpret it.
- Do not change H1 Truth, task adjudicator semantics, bootstrap, thresholds, schedule, provider evidence, or observed outcomes.
- Default development comparison is B/C only, one repetition.
- Model-call budgets are fail-closed and deterministic.
- Measurement health is independent from product effect.
- A future H2 requires a fresh hidden dataset and separate preregistration.
- No new runtime dependencies.

---

### Task 1: Archive H1 outcome and disclosed development corpus

**Files:**
- Create: `docs/evaluation/m2/h1-terminal-outcome-2026-09-02.md`
- Create: `docs/evaluation/m2/h1-dev-corpus-v1/manifest.json` and four 24-task shards
- Delete: `.github/workflows/m2-h1-finalize-once.yml`

- [x] Record terminal status, run IDs, result/analysis hashes, terminal source revision, and the reason H1 was inconclusive.
- [x] Archive all 96 disclosed H1 tasks as `DEVELOPMENT_ONLY`, with `futureHoldoutAllowed=false` and source evidence identities.
- [x] Split the corpus into SHA-addressed shards so normal small evals do not require hand-curated copies.
- [x] Delete the hardcoded one-shot finalization workflow after its completion chain is durably recorded.
- [ ] Verify every shard hash and policy test in exact-head CI.

### Task 2: Add deterministic evaluation budget planner with TDD

**Files:**
- Create: `scripts/eval/budget-plan.mjs`
- Create: `tests/evaluation/staged-eval-budget-plan.spec.ts`
- Modify: `package.json`

- [x] Write RED tests for all mode defaults, unknown mode rejection, cap overflow, repetition overflow, and deterministic zero-call mode.
- [x] Observe the intended RED CI before implementation.
- [x] Implement immutable mode definitions and fail-closed planner.
- [x] Add `eval:plan` package script.
- [ ] Verify GREEN on exact-head CI.

### Task 3: Add measurement health gate with TDD

**Files:**
- Create: `scripts/eval/health-gate.mjs`
- Create: `tests/evaluation/staged-eval-health-gate.spec.ts`
- Modify: `package.json`

**Thresholds:** format >= .98, decision resolution >= .95, unrecovered infrastructure missingness <= .02, B/C resolution gap <= .05.

- [x] Write RED tests for healthy input, low format compliance, low decision resolution, unrecovered infrastructure, recovered retry behavior, asymmetric B/C missingness and malformed input.
- [x] Implement deterministic metrics and explicit `PASS`/`STOP` reason codes.
- [x] Separate recovered retry cost from unrecovered infrastructure missingness so successful retry does not invalidate measurement.
- [x] Add `eval:health` package script.
- [ ] Verify GREEN on exact-head CI.

### Task 4: Add H1 prefix-health audit utility

**Files:**
- Create: `scripts/eval/audit-h1-health.mjs`
- Create: `tests/evaluation/staged-eval-h1-audit.spec.ts`

- [x] Add a synthetic fixture proving an unhealthy early prefix returns `STOP` while original scientific status is preserved.
- [x] Implement 12/24/48/96/all historical health snapshots from terminal run evidence.
- [x] Explicitly prohibit replacement H1 PASS/FAIL computation in this utility.
- [x] Add `eval:audit-h1` package script.
- [ ] Verify GREEN on exact-head CI.

### Task 5: Add verified development-corpus selection

**Files:**
- Create: `scripts/eval/development-corpus.mjs`
- Create: `tests/evaluation/staged-eval-corpus.spec.ts`
- Modify: `package.json`

- [x] Verify manifest/shard identities and SHA-256 before selection.
- [x] Reject corpus use when not marked `DEVELOPMENT_ONLY` or when future holdout use is allowed.
- [x] Select tasks deterministically and domain-balanced so an 8-task canary spans all eight H1 domains.
- [x] Add `eval:select` package script.
- [ ] Verify GREEN on exact-head CI.

### Task 6: Add repository `dsh-eval` skill and runbook

**Files:**
- Create: `.agents/skills/dsh-eval/SKILL.md`
- Create: `docs/evaluation/m2/staged-evaluation.md`
- Create: `tests/evaluation/staged-eval-policy.spec.ts`

- [x] Document deterministic/canary/dev/release/research modes and exact hard caps.
- [x] Require deterministic checks before model calls and 16-call canary before spending a larger changed-measurement budget.
- [x] Forbid H1 reruns, H1 corpus use as future holdout, arm-A/repetition creep and manual 12/24/48 chunk loops.
- [x] Require reports to separate measurement health, product signal, cost and next action.
- [x] Document the pre-H2 product-optimization lane: search-to-inspect conversion, duplicate-query suppression, result compaction, tool budget and token overhead.
- [ ] Verify skill/policy tests on exact-head CI.

### Task 7: Full verification, PR, and governance update

- [ ] Run the full repository CI on the exact PR head.
- [ ] Review changed-file list for unrelated edits and frozen H1 drift.
- [ ] Update PR from draft/WIP text to final implementation evidence.
- [ ] Merge only an exact CI-green head.
- [ ] Confirm post-merge CI on `main`.
- [ ] Comment on #149 with the merged commit and close it when acceptance criteria are met.
- [ ] Comment on #34 recording that H1 remains `INCONCLUSIVE` and future work proceeds through calibration/new H2 rather than H1 reruns.

---

## Follow-up implementation (separate PR after this control plane is green)

The next PR turns these deterministic controls into the actual one-dispatch model runner:

- structured measurement sidecar replacing the fragile free-text `API_CLAIM` transport for development calibration;
- B/C-only runner over the verified development corpus;
- one dispatch: plan -> first 16 calls -> health gate -> STOP or bounded remainder;
- one evidence artifact containing health/product/cost data;
- a real 16-call canary execution before any 40/64/96-call development run is allowed.

This is deliberately separate from the control-plane PR so measurement transport can be calibrated without coupling its provider/runtime risks to the archival/budget/policy foundation.
