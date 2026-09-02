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
- Create: `docs/evaluation/m2/h1-dev-corpus-v1.json`
- Delete: `.github/workflows/m2-h1-finalize-once.yml`

**Interfaces:**
- Consumes: terminal run `33541873817`, post-analysis run `33541936135`, H1 execution run `33533666686`.
- Produces: durable historical receipt and a dataset explicitly labeled `DEVELOPMENT_ONLY`.

- [ ] Record terminal status, run IDs, result/analysis hashes, terminal source revision, and the reason H1 was inconclusive.
- [ ] Commit the disclosed 96 H1 tasks as a development-only corpus with an explicit prohibition on H2 holdout use.
- [ ] Delete the hardcoded one-shot finalization workflow after its completion chain is durably recorded.
- [ ] Verify JSON parses and workflow is absent.

### Task 2: Add deterministic evaluation budget planner with TDD

**Files:**
- Create: `scripts/eval/budget-plan.mjs`
- Create: `tests/evaluation/staged-eval-budget-plan.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `getEvalMode(name)`, `planEvalBudget(input)`, CLI JSON output.
- Mode defaults: deterministic=0, canary=8 tasks/16 calls, dev=20/40, release=32/64, research=48/96; B/C only and one repetition for model modes.

- [ ] Write failing tests for all mode defaults, unknown mode rejection, cap overflow, repetition overflow, and no implicit arm A.
- [ ] Run focused test and verify RED.
- [ ] Implement immutable mode definitions and fail-closed planner.
- [ ] Add `eval:plan` package script.
- [ ] Run focused test and `pnpm run check:scripts` and verify GREEN.

### Task 3: Add measurement health gate with TDD

**Files:**
- Create: `scripts/eval/health-gate.mjs`
- Create: `tests/evaluation/staged-eval-health-gate.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `evaluateMeasurementHealth(input)` and CLI JSON output.
- Input observations contain `arm`, `formatValid`, `decisionResolved`, `infrastructureFailures`, `attemptCount`.
- Thresholds: format >= .98, resolution >= .95, infra <= .02, B/C resolution gap <= .05.

- [ ] Write failing tests for healthy input, low format compliance, low decision resolution, excess infra failures, asymmetric B/C missingness, malformed input, and zero denominators.
- [ ] Run focused test and verify RED.
- [ ] Implement deterministic metrics and explicit `PASS`/`STOP` reason codes.
- [ ] Add `eval:health` package script.
- [ ] Run focused test and script check and verify GREEN.

### Task 4: Add H1 prefix-health audit utility

**Files:**
- Create: `scripts/eval/audit-h1-health.mjs`
- Create: `tests/evaluation/staged-eval-h1-audit.test.ts`

**Interfaces:**
- Consumes: terminal `h1-result-v2.json`.
- Produces: health snapshots for prefixes 12/24/48/96/all without changing H1 status.

- [ ] Write a synthetic fixture test proving an unhealthy early prefix returns STOP while the utility remains exploratory.
- [ ] Implement extraction of format/resolution/infra observations from terminal run evidence.
- [ ] Verify the utility never computes or changes H1 PASS/FAIL.
- [ ] Run focused tests.

### Task 5: Add repository `dsh-eval` skill

**Files:**
- Create: `.agents/skills/dsh-eval/SKILL.md`

**Interfaces:**
- Consumes: change intent, deterministic scripts, GitHub workflow evidence when available.
- Produces: one operator flow selecting the cheapest sufficient mode and stopping on health failure.

- [ ] Document mode selection rules and explicit model-call caps.
- [ ] Require deterministic checks before model calls.
- [ ] Require canary for changed evaluator/measurement paths before larger modes.
- [ ] Forbid H1 reruns and H1 corpus use as future holdout.
- [ ] Require report sections: measurement health, product signal, cost, next action.

### Task 6: Add control-plane documentation and workflow policy tests

**Files:**
- Create: `docs/evaluation/m2/staged-evaluation.md`
- Create or modify relevant repository policy tests to assert the one-shot H1 workflow is absent and the skill/scripts are retained.

**Interfaces:**
- Produces: maintainer runbook and durable H2 entry conditions.

- [ ] Document `deterministic -> canary -> dev -> release/research` lifecycle.
- [ ] Document that workflow success is not product PASS.
- [ ] Document H2 prerequisites and fresh-holdout rule.
- [ ] Add policy coverage only where an existing policy suite already owns this boundary; do not create unrelated architecture rules.

### Task 7: Full verification, PR, and governance update

**Files:**
- Update Issue #149 and Issue #34 comments only; no scientific contract edits.

**Interfaces:**
- Produces: reviewed PR with exact verification evidence.

- [ ] Run focused eval tests.
- [ ] Run `pnpm run check` through CI on the exact PR head.
- [ ] Review changed-file list for unrelated edits and frozen H1 drift.
- [ ] Open PR with Why/What/Contract impact/Verification/Risks/Related sections.
- [ ] Merge only an exact CI-green head.
- [ ] Comment on #149 with the merged commit and close it when acceptance criteria are met.
- [ ] Comment on #34 recording that H1 remains `INCONCLUSIVE` and future work proceeds through calibration/new H2 rather than H1 reruns.
