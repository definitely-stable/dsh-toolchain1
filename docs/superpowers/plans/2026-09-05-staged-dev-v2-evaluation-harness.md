# M2 staged dev v2 evaluation harness implementation plan

**Date:** 2026-09-05

**Goal:** Repair the DEVELOPMENT_ONLY staged B/C evaluation harness after run `33939213526` exposed deterministic sampling bias and insufficient telemetry. Preserve the frozen Contract Search v3 production candidate; this plan changes evaluation infrastructure only.

## Evidence boundary

- Baseline production/evaluation commit: `8eba7eccba77bb3e047868dbad8ea9c9ced3b033`.
- The completed dev-v1 run `33939213526` is valid measurement-health evidence (`PASS`) but its product comparison is ceiling-saturated and uninformative because all 20 selected tasks were `api-absent` tasks.
- The H1-derived corpus remains `DEVELOPMENT_ONLY`, disclosed, and forbidden as H2 holdout material.
- No model run is authorized by this PR. A new run after merge is a versioned `dev-v2` engineering-signal experiment, not a rerun of dev-v1 and not H2.
- No production search/ranking, Protocol, ContractIndex, DSH target, provider identity, or dependency changes.

## Task 1 — Make staged task selection stratified by oracle kind

**Files:**
- Modify `scripts/eval/development-corpus.mjs`
- Modify `tests/evaluation/staged-eval-corpus.spec.ts`
- Modify `tests/evaluation/staged-eval-schedule.spec.ts`

**RED:** Add characterization tests proving that a 20-task selection from the real corpus must contain 12 `api-exists-any` tasks and 8 `api-absent` tasks, span all eight domains, and contain both kinds for every domain. Prove the selected result is invariant to misleading lexical task-id ordering.

**GREEN design:** Build deterministic `domain × successRule.kind` strata. Within each stratum sort by task id only for deterministic tie-breaking. Selection proceeds in rounds: first select one positive and one negative task from each domain; after every domain/kind stratum is represented once, consume additional positive discovery tasks before additional negative tasks at the same depth. For the 20-task dev budget this deterministically yields 12 positive + 8 negative without inferring task kind from IDs. Keep all selected IDs unique.

**Canary:** The first eight selected tasks remain deterministic and include both task kinds. Canary remains a measurement-health gate, not the product-composition estimator.

## Task 2 — Freeze the dev-v2 selected-task identity before any model outcome

**Files:**
- Add `docs/evaluation/m2/staged-dev-v2-selection.json`
- Add `tests/evaluation/staged-dev-v2-selection.spec.ts`

Record the exact 20 selected task IDs, counts by kind/domain, selector version, source corpus identity, frozen v3 commit, and a deterministic selection commitment/hash. The test must recompute the selection from the committed corpus and fail on any drift.

## Task 3 — Preserve product-tool telemetry by arm and tool identity

**Files:**
- Modify `scripts/eval/staged-provider-executor.mjs`
- Modify `tests/evaluation/staged-eval-provider-executor.spec.ts`
- Modify `scripts/eval/staged-report.mjs`
- Modify `tests/evaluation/staged-eval-report.spec.ts`

**RED:** Require executor output to retain ordinary/toolchain counts and the exact counts for `ordinary_read`, `ordinary_search`, `toolchain_contract_search`, and `toolchain_contract_inspect`. Require report cost summaries by B/C arm and a C-arm Toolchain-use observation/rate.

**GREEN:** Derive telemetry only from existing trace entries (`family`, `name`); do not change model-visible tools or transport. Keep aggregate cost totals while adding deterministic `byArm` summaries and tool-use counts.

## Task 4 — Stop presenting API correctness as an independent task-success guardrail

**Files:**
- Modify `scripts/eval/staged-adjudication.mjs`
- Modify `tests/evaluation/staged-eval-adjudication.spec.ts`
- Modify `scripts/eval/staged-execution.mjs` if needed
- Modify `scripts/eval/staged-report.mjs`
- Modify `tests/evaluation/staged-eval-execution.spec.ts` if needed
- Modify `tests/evaluation/staged-eval-report.spec.ts`

The current development oracle can deterministically judge exactly one API claim; it cannot independently judge end-to-end task completion. Remove the duplicated `taskSuccess` boolean from the staged development decision/report or explicitly mark the guardrail as unavailable. Prefer a report-v2 contract with `apiValid` as the product outcome and `taskSuccess: { measured: false, reason: ... }` rather than fabricating a second metric.

## Task 5 — Record dev-v1 outcome and dev-v2 authorization boundary

**Files:**
- Add `docs/evaluation/m2/staged-dev-v1-outcome-2026-09-05.md`
- Modify `docs/evaluation/m2/staged-evaluation.md` and/or `docs/evaluation/m2/status.md` only where needed

Record run `33939213526`: exact SHA, provider/transport health, 40/40 execution, zero infra failures/retries, 20/20 B and C API-valid, zero B/C delta, and the deterministic 20-negative selection defect. Classify the product comparison as `UNINFORMATIVE / CEILING-SATURATED DUE TO SELECTION BIAS`, not product failure.

## Task 6 — Verification and integration

1. Run/inspect RED CI after test-only commits; only intended new expectations may fail.
2. Implement minimum code to make each RED test green.
3. Run full repository CI on exact PR head: Node 22.19/24.19/26, Windows 2025, macOS 15, aggregate checks, build, pack/install, real-DSH composition and target-resolution smokes.
4. Review exact diff for accidental `src/` or production-ranker changes.
5. Merge only with expected head SHA after all checks pass.
6. Verify post-merge `main` CI on exact merge SHA.
7. Update issue #160: dev-v1 measurement PASS but product comparison uninformative; harness-v2 ready; next step is one new `dev-v2` dispatch on merged `main`.

## Acceptance criteria

- Real 20-task dev-v2 selection: exactly 12 positive discovery / 8 negative existence checks, all 8 domains represented, both kinds in every domain.
- Selection depends on `successRule.kind`, never `n/p` naming conventions.
- Exact selected-task receipt is committed and drift-tested before the next model run.
- Per-arm B/C tokens, wall time, turns, provider completions and product-tool calls are reported.
- Tool telemetry distinguishes ordinary vs Toolchain and search vs inspect; C-arm Toolchain-use rate is observable.
- Staged development report no longer claims `taskSuccess` is independently measured when it is only the same API-claim adjudication.
- Dev-v1 remains DEVELOPMENT_ONLY and is not reinterpreted as negative product evidence.
- No production Contract Search behavior changes.
