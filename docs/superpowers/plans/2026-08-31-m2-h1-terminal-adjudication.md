# M2 H1 Terminal Adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an offline, fail-closed terminal H1 workflow that turns the exact completed durable run-store into a validated H1 result and preregistered C-vs-B decision artifacts.

**Architecture:** The terminal path is read-only with respect to H1 execution state. It restores an exact completed execution cache by run ID, validates the frozen scientific binding and complete ledger, reconstructs persisted attempts, re-adjudicates model outcomes with frozen Truth v2 and H1 task rules, validates the full result, then runs deterministic paired-task percentile bootstrap analysis. It never calls the provider and refuses partial H1 state.

**Tech Stack:** TypeScript 6, Node 24.19, Vitest, GitHub Actions, existing H1 run-store/evidence/integrity modules.

**Spec:** `docs/evaluation/m2/h1-preregistration-publication-v2.md`

## Global Constraints

- Keep the frozen H1 scientific receipt, definition SHA, dataset commitment, provider identity, A/B/C arms, retry policy, thresholds and schedule unchanged.
- Do not modify production `src/**` behavior.
- No provider/model/network call from terminal adjudication.
- Require exact completed H1 execution run ID and exact cache restore; no prefix fallback.
- Refuse adjudication unless the durable run-store validates as `COMPLETE`.
- Reuse Truth v2, API claim classifier, H1 task adjudicator and v2 result integrity validation.
- Primary: task-level B invalid rate minus C invalid rate; 3 trials/arm; 10,000 paired percentile-bootstrap resamples; seed `m2-v2-primary`; lower quantile 0.025; PASS threshold 0.10.
- Guardrail: task-level C success rate minus B success rate; seed `m2-v2-guardrail`; lower quantile 0.025; PASS threshold -0.05.
- Unresolved B/C evidence or exhausted infrastructure state yields `INCONCLUSIVE`, never a silent favorable score.

---

### Task 1: Terminal analysis engine

**Files:**
- Create: `tests/evaluation/m2-h1-terminal-analysis-v2.spec.ts`
- Create: `tests/evaluation/m2-h1-terminal-analysis-v2.ts`

**Interfaces:**
- Produces `analyzeH1TerminalResultV2(...)` returning point estimates, deterministic percentile-bootstrap intervals, decision flags and terminal status.

- [ ] Write RED tests for deterministic bootstrap, PASS, NEEDS-IMPROVEMENT and INCONCLUSIVE.
- [ ] Verify RED fails because the terminal analysis module is absent.
- [ ] Implement minimal deterministic task-level analysis and empirical percentile quantile.
- [ ] Verify focused tests pass.

### Task 2: Read-only completed run reconstruction

**Files:**
- Modify: `tests/evaluation/m2-h1-run-store-v2.ts`
- Modify: `tests/evaluation/m2-h1-attempt-coordinator-v2.ts`
- Create: `tests/evaluation/m2-h1-terminal-result-v2.spec.ts`
- Create: `tests/evaluation/m2-h1-terminal-result-v2.ts`

**Interfaces:**
- Produces a validated read-only ledger snapshot and durable evidence loader.
- Produces `buildH1TerminalResultV2(...)` that rejects non-COMPLETE state, re-adjudicates retained raw answers, reconstructs exact ordered runs, and validates the v2 result.

- [ ] Write RED tests for partial-state refusal, evidence/hash mismatch, fresh adjudication and valid COMPLETE reconstruction.
- [ ] Verify RED.
- [ ] Add narrow read-only exports reusing existing internal validators.
- [ ] Implement terminal result builder without mutating run-store state.
- [ ] Verify focused tests pass.

### Task 3: CLI finalizer and workflow

**Files:**
- Create: `scripts/finalize-m2-h1.mjs`
- Modify: `package.json`
- Create: `.github/workflows/m2-h1-terminal-adjudication.yml`
- Create: `tests/evaluation/m2-h1-terminal-command.spec.ts`
- Create: `tests/policy/m2-h1-terminal-adjudication-workflow.spec.ts`
- Create: `docs/evaluation/m2/h1-terminal-analysis-implementation-v2.md`

**Interfaces:**
- `pnpm m2:h1:finalize -- --dataset <path> --run-store <path> --output-dir <path>`
- Workflow input `h1_execution_run_id` identifies the exact final COMPLETE execution cache.
- Outputs `h1-result-v2.json`, `h1-analysis-v2.json`, `h1-summary.md` as one Actions artifact.

- [ ] Write RED command/workflow policy tests.
- [ ] Verify RED.
- [ ] Implement CLI and workflow with no `OPENCODE_API_KEY`, exact cache key restore, COMPLETE gate and artifact upload.
- [ ] Document the exact deterministic percentile algorithm before terminal use.
- [ ] Verify focused tests and `pnpm check`.

### Task 4: Review and merge

- [ ] Open bounded PR from `feat/m2-h1-terminal-adjudication`.
- [ ] Run full required CI on exact PR head.
- [ ] Review diff for scientific-design drift and provider-call paths.
- [ ] Merge only after all required jobs are green and verify post-merge main CI.
