# M2 staged evaluation product-outcome separation implementation plan

> **For the implementing agent:** REQUIRED SUB-SKILL: use `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before declaring completion. Finish through an isolated PR with exact-head and post-merge CI evidence.

**Goal:** Correct staged evaluation censoring so bounded product failures are measured as product outcomes rather than misclassified as measurement/transport failures, while adding auditable per-observation evidence and preserving the frozen production ranker.

**Architecture:** Split the staged evaluation into three orthogonal planes: measurement health, bounded product outcome, and cost/trajectory evidence. Extend internal staged provider transport with a closed `product-terminal` outcome, project it through execution without pretending measurement was attempted, gate canary continuation only on measurement-plane validity, and publish report-v3 metrics/receipts that retain product budget failures in denominators.

**Tech stack:** Node.js ESM, TypeScript/Vitest test suite, GitHub Actions, existing OpenCode Go staged process transport. No new runtime dependency.

**Design spec:** `docs/superpowers/specs/2026-09-05-m2-product-outcome-separation-design.md`

## Global constraints

- Evaluation-only. Do not modify `src/`.
- Do not change `MAX_PRODUCT_TOOL_CALLS = 31`.
- Do not tune Contract Search or bump rankerVersion.
- Do not change provider/model or frozen dev-v2 selection.
- Do not dispatch a provider-backed run as part of this PR.
- Historical run `33948582894` remains immutable DEVELOPMENT_ONLY evidence.
- Do not persist chain-of-thought, prompt text, raw tool arguments/results or provider bodies.

### Task 1: RED — product terminal transport

**Files:**
- Modify: `tests/evaluation/staged-eval-provider-transport.spec.ts`
- Modify: `tests/evaluation/staged-eval-opencode-child.spec.ts`
- Modify: `tests/evaluation/staged-eval-execution.spec.ts`

**Steps:**
1. Add failing tests requiring a closed `product-terminal` transport for `tool_budget_exhausted`.
2. Require decoder output to distinguish product terminal from `unsupported` measurement transport.
3. Require execution projection to expose `measurementAttempted=false` plus bounded product outcome rather than `STRUCTURED_TRANSPORT_UNSUPPORTED`.
4. Commit test-only RED and run repository CI on that exact head. Verify failures are limited to the new expectations.

### Task 2: GREEN — transport and execution separation

**Files:**
- Modify: `scripts/eval/staged-provider-transport.mjs`
- Modify: `scripts/m2-opencode-go-staged-child.mjs`
- Modify: `scripts/eval/staged-execution.mjs`
- Potentially modify typedef/test fixtures only as required.

**Steps:**
1. Bump staged provider transport envelope to v2.
2. Add encoder/decoder for recognized product terminal `tool_budget_exhausted`.
3. Change the child’s >31-call branch to emit the product terminal while preserving the 31-call limit.
4. Add `measurementAttempted` and explicit product outcome to execution results.
5. Keep genuine structured transport failures classified as measurement failures.
6. Run targeted tests then full aggregate CI; confirm Task 1 RED becomes GREEN without unrelated changes.

### Task 3: RED — measurement health must not censor product outcomes

**Files:**
- Modify: `tests/evaluation/staged-eval-health-gate.spec.ts`
- Modify: `tests/evaluation/staged-eval-runner.spec.ts`

**Steps:**
1. Add a synthetic 16-observation canary equivalent to the dev-v2 pattern: B has 6 completed + 2 product-budget-exhausted; C has 8 completed; infrastructure and measurement-finalization transport are otherwise healthy.
2. Require measurement health PASS for that canary.
3. Require the runner to authorize the remainder under that condition.
4. Preserve RED cases for actual malformed/unsupported measurement finalization and unrecovered infrastructure.
5. Commit test-only RED and verify isolated expected failures.

### Task 4: GREEN — health-gate redesign

**Files:**
- Modify: `scripts/eval/health-gate.mjs`
- Modify: `scripts/eval/staged-runner.mjs` only if projection/field plumbing is required.

**Steps:**
1. Compute format compliance only over model outcomes where `measurementAttempted=true`.
2. Remove deterministic decision-resolution rate and arm decision-resolution gap as STOP conditions; retain them only as diagnostics if useful for compatibility.
3. Add fail-closed behavior for model-outcome canary with zero measurement attempts.
4. Preserve unrecovered infrastructure and true measurement-format gates.
5. Run targeted and full CI; verify the synthetic product-gap canary now proceeds while true measurement corruption still STOPs.

### Task 5: RED — report-v3 bounded metrics and safe receipts

**Files:**
- Modify: `tests/evaluation/staged-eval-report.spec.ts`
- Modify: `tests/evaluation/staged-eval-command.spec.ts` if schema assertions exist.

**Steps:**
1. Require schema `dsh-toolchain-staged-eval-report-v3`.
2. Require `boundedCompletion` by arm and paired C−B contingency.
3. Require `boundedApiSuccess` with budget exhaustion/unresolved outcomes retained as non-success rather than dropped.
4. Require safe ordered `observations` receipts containing task metadata, terminal outcome, adjudication, cost and tool-count summaries only.
5. Add negative assertions that prompt/reasoning/raw tool values are absent.
6. Commit test-only RED and verify failures are limited to missing report-v3 behavior.

### Task 6: GREEN — report-v3

**Files:**
- Modify: `scripts/eval/staged-report.mjs`
- Modify: `scripts/eval/staged-schedule.mjs` only if task metadata needs explicit stable projection.
- Modify: `scripts/eval/staged-runner.mjs` only if report input needs additional safe metadata.

**Steps:**
1. Build deterministic per-observation receipts sorted by ordinal.
2. Add bounded completion and bounded API-success arm metrics.
3. Add paired contingency over product-eligible task/repetition pairs.
4. Retain resolved-only API-validity metric as a clearly conditional diagnostic for continuity.
5. Preserve per-arm tokens/time/turns/tool telemetry from report v2.
6. Explicitly state `taskSuccessGuardrail.measured=false`.
7. Run targeted tests and full CI.

### Task 7: Historical receipt and operational docs

**Files:**
- Create: `docs/evaluation/m2/staged-dev-v2-outcome-2026-09-05.md`
- Modify: `docs/evaluation/m2/staged-evaluation.md`
- Modify: `docs/evaluation/m2/status.md`
- Modify policy tests if they intentionally pin the old report schema/wording.

**Steps:**
1. Record exact run `33948582894`, exact candidate SHA and artifact digest.
2. Record original STOP faithfully, explain the product-budget/measurement misclassification, and preserve the result as descriptive DEVELOPMENT_ONLY engineering evidence only.
3. Record observed canary facts: C 8/8 resolved and Toolchain used 8/8; B 6/8 resolved with two `tool_call_limit` terminals; complete-case paired API delta 0; cost/tool-use aggregates.
4. State that no immediate rerun is authorized by this PR; first interpret the corrected methodology and design H2/end-to-end success separately.
5. Update runbook/status semantics to report-v3.

### Task 8: Final verification, PR and merge

**Steps:**
1. Review full branch diff and confirm zero `src/` changes, zero dependency changes, unchanged 31-call limit and unchanged frozen selection.
2. Run fresh full CI on exact final PR head. Required: all Node/platform lanes plus build/pack/install/real-DSH/composition/target-resolution gates green.
3. Open/update PR under parent #160 with RED→GREEN evidence and methodological boundary.
4. Mark ready only after exact-head GREEN.
5. Squash merge guarded by exact expected head SHA.
6. Verify post-merge `main` CI on the exact merge SHA is fully GREEN.
7. Update #160 with merged SHA, CI evidence and next decision gate. Do not dispatch another provider-backed evaluation automatically.
