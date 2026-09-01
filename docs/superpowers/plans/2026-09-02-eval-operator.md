# DSH Eval Operator v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual, oversized post-H1 development evaluation with a repo-native B/C calibration operator that defaults to 40 calls, can stop after a 16-call measurement canary, and is invokable through one agent skill/workflow.

**Architecture:** Keep historical H1 frozen. Add a separate repository-only evaluation layer under `scripts/eval/` that plans bounded modes, runs a disclosed-H1 calibration slice, computes measurement health before product quality, and writes compact evidence. A repository skill dispatches a single GitHub Actions workflow. Structured-output replacement and the next unseen H2 remain later milestones.

**Tech Stack:** Node.js 24.19, ESM `.mjs`, TypeScript/Vitest repository tests, GitHub Actions, existing M2 evaluation runtime, pnpm 11.7.0.

**Spec:** `docs/superpowers/specs/2026-09-02-eval-operator-design.md`

## Global Constraints

- Historical H1 result remains unchanged and permanently non-confirmatory after disclosure.
- v1 development modes use arms B/C only and exactly one trial per task.
- `smoke=16`, `dev=40`, `release=64`, `research=96` maximum model outcomes.
- All modes execute the 16-outcome smoke slice first; expansion is forbidden when measurement health fails.
- `dev` is the default mode; `research` requires explicit intent.
- No cron/scheduled execution.
- No new runtime dependency.
- No production `src/**` architecture change.
- Objective grading remains deterministic; no LLM judge.

---

### Task 1: Lock mode planning and task selection policy

**Files:**
- Create: `scripts/eval/dsh-eval-config.mjs`
- Create: `scripts/eval/dsh-eval-plan.mjs`
- Create: `tests/evaluation/dsh-eval-plan.spec.ts`

**Interfaces:**
- Produces: `EVAL_MODES`, `HEALTH_THRESHOLDS`, `selectCalibrationTasks(tasks, mode)`, `buildEvalPlan(mode, tasks)`.
- `buildEvalPlan` returns `{ schema, mode, taskCount, canaryTaskCount, arms, trialsPerTask, maxModelOutcomes, canaryModelOutcomes, selectedTaskIds, canaryTaskIds }`.

- [ ] **Step 1: Write failing planner tests**

Tests must assert:

```ts
expect(plan.mode).toBe('dev')
expect(plan.arms).toEqual(['B', 'C'])
expect(plan.trialsPerTask).toBe(1)
expect(plan.taskCount).toBe(20)
expect(plan.maxModelOutcomes).toBe(40)
expect(plan.canaryTaskCount).toBe(8)
expect(plan.canaryModelOutcomes).toBe(16)
```

Additional tests assert exact budgets for all four modes, one selected task per domain in the canary, no duplicate task ids, and rejection of an unknown mode or malformed corpus.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/evaluation/dsh-eval-plan.spec.ts
```

Expected: FAIL because the planner/config modules do not exist.

- [ ] **Step 3: Implement minimal planner/config**

Implement four immutable profiles:

```js
smoke:    { taskCount: 8,  maxModelOutcomes: 16 }
dev:      { taskCount: 20, maxModelOutcomes: 40 }
release:  { taskCount: 32, maxModelOutcomes: 64 }
research: { taskCount: 48, maxModelOutcomes: 96 }
```

Every plan uses `arms=['B','C']`, `trialsPerTask=1`, and `canaryTaskCount=8`.

Selection sorts domains and task ids. `dev` selects two per domain, then one additional task from each priority domain `approval-policy`, `tool-runtime`, `session-search`, `session-reads`. Release/research select four/six per domain. Smoke selects one per domain.

- [ ] **Step 4: Verify GREEN**

Run the focused test and `pnpm check:scripts`.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/eval/dsh-eval-config.mjs scripts/eval/dsh-eval-plan.mjs tests/evaluation/dsh-eval-plan.spec.ts
git commit -m "feat(eval): add bounded calibration plans"
```

---

### Task 2: Add measurement health gate

**Files:**
- Create: `scripts/eval/dsh-eval-health.mjs`
- Create: `tests/evaluation/dsh-eval-health.spec.ts`

**Interfaces:**
- Consumes rows shaped as `{ arm, hasModelOutcome, formatCompliant, decisionResolved, unrecoveredInfrastructure }`.
- Produces `evaluateMeasurementHealth(rows)` returning rates, violated thresholds and `status: 'HEALTHY' | 'MEASUREMENT_INVALID'`.

- [ ] **Step 1: Write failing health tests**

Cover:

1. 16 clean B/C rows -> `HEALTHY`.
2. H1-like canary with 50% decision resolution -> `MEASUREMENT_INVALID` and violation `decisionResolutionRate`.
3. One-sided missingness that creates B/C resolution gap > 0.10 -> invalid.
4. Unrecovered infrastructure > 0.05 -> invalid.
5. Recovered infrastructure does not count as unrecovered missingness when a model outcome exists.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/evaluation/dsh-eval-health.spec.ts
```

Expected: FAIL because the health module does not exist.

- [ ] **Step 3: Implement minimal health evaluator**

Use thresholds copied from the design:

```js
modelOutcomeRate >= 0.95
formatComplianceRate >= 0.95
decisionResolutionRate >= 0.95
abs(BResolutionRate - CResolutionRate) <= 0.10
unrecoveredInfrastructureRate <= 0.05
```

Do not calculate a product quality score when health is invalid.

- [ ] **Step 4: Verify GREEN**

Run focused tests and `pnpm check:scripts`.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/eval/dsh-eval-health.mjs tests/evaluation/dsh-eval-health.spec.ts
git commit -m "feat(eval): stop unhealthy measurement canaries"
```

---

### Task 3: Implement bounded disclosed-H1 calibration runner

**Files:**
- Create: `scripts/eval/run-dsh-eval.mjs`
- Create: `tests/evaluation/dsh-eval-runner.spec.ts`
- Modify: `package.json`

**Interfaces:**
- CLI: `node scripts/eval/run-dsh-eval.mjs --dataset <path> --mode <mode> --output-dir <path> [--plan-only]`.
- `--plan-only` validates corpus selection without provider calls.
- Provider execution uses existing `OPENCODE_API_KEY` and existing OpenCode Go child adapter.
- Outputs `dsh-eval-result-v1.json`, `dsh-eval-cases-v1.jsonl`, `dsh-eval-summary.md`, `dsh-eval-sha256sums.txt`.

- [ ] **Step 1: Write failing runner tests**

Use a synthetic 96-task/eight-domain dataset generated in the test temp directory. Assert `--plan-only --mode dev` exits 0, selects 20 tasks, predicts 40 outcomes, and marks the corpus `DISCLOSED_CALIBRATION` rather than holdout.

Add a source-policy test asserting the runner does not import or mutate `m2-h1-run-store-v2` or the historical H1 ledger.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/evaluation/dsh-eval-runner.spec.ts
```

Expected: FAIL because the runner is absent.

- [ ] **Step 3: Implement plan-only path first**

Parse arguments, validate the disclosed dataset schema, call `buildEvalPlan`, and emit the plan without compiling/provider access.

- [ ] **Step 4: Verify plan-only GREEN**

Run the focused test.

- [ ] **Step 5: Add provider execution path**

Reuse existing M2 exact-target components, but write a new calibration result envelope. Execute only selected B/C trial-1 cases. For each case:

- create a fresh process/session attempt;
- allow one infrastructure retry only for existing retryable transport reasons;
- re-adjudicate the returned raw answer with Truth v2 + the disclosed task success rule;
- record format compliance, invalid API, UNKNOWN API, task success, trace/tool counts, token usage and wall time;
- after the first 16 model slots, call `evaluateMeasurementHealth`;
- on invalid health, stop immediately and write `MEASUREMENT_INVALID` evidence;
- otherwise continue to the requested mode budget.

Do not append to historical H1 durable state.

- [ ] **Step 6: Add package scripts**

Add:

```json
"eval:plan": "node scripts/eval/dsh-eval-plan.mjs",
"eval:run": "node scripts/eval/run-dsh-eval.mjs"
```

- [ ] **Step 7: Verify GREEN**

Run focused tests, `pnpm check:scripts`, `pnpm lint`, and `pnpm typecheck`.

- [ ] **Step 8: Commit Task 3**

```bash
git add scripts/eval/run-dsh-eval.mjs tests/evaluation/dsh-eval-runner.spec.ts package.json
git commit -m "feat(eval): add canary-first calibration runner"
```

---

### Task 4: Add one-dispatch workflow and repository skill

**Files:**
- Create: `.github/workflows/dsh-eval.yml`
- Create: `.agents/skills/dsh-eval/SKILL.md`
- Create: `tests/evaluation/dsh-eval-operator-policy.spec.ts`

**Interfaces:**
- Workflow input: `mode` choice with default `dev` and choices `smoke/dev/release/research`.
- Skill command surface: `$dsh-eval` with natural-language intent; default dev behavior.

- [ ] **Step 1: Write failing static policy tests**

Assert the future workflow:

- has `workflow_dispatch` only and no `schedule`;
- defaults to `dev`;
- exposes exactly the four bounded modes;
- runs planner/tests before provider execution;
- invokes one `eval:run` command rather than chunk recursion;
- uploads result/cases/summary/checksums with `if: always()`;
- fails the final measurement gate only after upload when result status is `MEASUREMENT_INVALID`.

Assert the skill explicitly says no automatic research, no manual chunk loop, stop on invalid measurement, and disclosed H1 is calibration-only.

- [ ] **Step 2: Verify RED**

```bash
pnpm vitest run tests/evaluation/dsh-eval-operator-policy.spec.ts
```

Expected: FAIL because workflow/skill are absent.

- [ ] **Step 3: Implement workflow**

Use pinned actions already accepted by repository policy. Materialize the disclosed H1 corpus from `M2_H1_DATASET_GZIP_BASE64`, verify its historical raw SHA, execute the evaluator, upload evidence, then convert `MEASUREMENT_INVALID` into a visible failed gate.

- [ ] **Step 4: Implement skill**

The skill must read `AGENTS.md`/`CONTRIBUTING.md`, run deterministic checks first, choose the smallest appropriate mode, dispatch/observe `DSH Eval`, inspect its result artifact, and return a concise decision/cost/failure report.

- [ ] **Step 5: Verify GREEN**

Run focused policy tests and repository CI-storage/policy checks.

- [ ] **Step 6: Commit Task 4**

```bash
git add .github/workflows/dsh-eval.yml .agents/skills/dsh-eval/SKILL.md tests/evaluation/dsh-eval-operator-policy.spec.ts
git commit -m "feat(eval): add one-dispatch eval operator skill"
```

---

### Task 5: Remove one-shot H1 automation and document the transition

**Files:**
- Delete: `.github/workflows/m2-h1-finalize-once.yml`
- Create: `docs/evaluation/m2/h1-outcome-and-next-eval-v1.md`
- Modify tests only if repository workflow inventory requires it.

**Interfaces:**
- Historical canonical ids recorded: execution `33533666686`, terminal `33541873817`, post-analysis `33541936135`.
- H1 status recorded as `INCONCLUSIVE`; no new scoring claim.

- [ ] **Step 1: Add/adjust failing workflow inventory test if necessary**

The test must reject reintroduction of the one-shot hard-coded workflow while retaining historical manual H1 workflows.

- [ ] **Step 2: Remove one-shot workflow and write transition document**

Document the canonical run ids/hashes, the fact that the disclosed corpus is now development-only, and the v1 -> structured-sidecar -> efficiency -> H2 sequence.

- [ ] **Step 3: Run repository-wide verification**

Run:

```bash
pnpm check
```

Then rely on GitHub CI for Node 22/24/26 and Windows/macOS lanes.

- [ ] **Step 4: Final diff review**

Confirm no frozen H1 scorer/threshold/Truth/schedule changes, no production `src/**` changes, no dependency additions, and no cron.

- [ ] **Step 5: Commit Task 5**

```bash
git add -A
git commit -m "chore(eval): retire one-shot H1 finalizer"
```

---

### Task 6: PR and merge gate

**Files:**
- PR only; no additional code unless CI identifies a real defect.

- [ ] **Step 1: Open PR**

Title:

```text
feat(eval): add canary-first DSH eval operator
```

PR body must state Why/What/Contract impact/Verification/Risks/Related according to `CONTRIBUTING.md`.

- [ ] **Step 2: Verify exact PR head CI**

Require all repository CI lanes green. If a check fails, fix the defect with a regression test rather than weakening a gate.

- [ ] **Step 3: Merge exact verified head**

Use the repository-supported merge method and pass the expected head SHA so a moved PR cannot be merged accidentally.