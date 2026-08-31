# M2 Operational Status G0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the repository's M2.3 operational status with the evidence and H1 infrastructure already merged on `main`, while preserving every frozen/historical experiment artifact and keeping real H1 execution fail-closed.

**Architecture:** Add one non-normative operational status index under `docs/evaluation/m2/`, then reduce README/roadmap duplication by linking to it. Historical evaluation artifacts remain authoritative for their own facts; the new status file only composes their current gate state and next permitted action. Issues #28/#34 receive synchronization comments after the PR exists rather than rewriting historical discussion in this slice.

**Tech Stack:** Markdown documentation, GitHub Issues/PR governance, existing pnpm repository policy/CI checks.

**Spec:** `docs/superpowers/specs/2026-08-31-m2-operational-status-g0-design.md`

## Global Constraints

- Documentation/governance only; no production `src/**` changes.
- No Protocol/schema, Contract Index, retrieval ranking, H1 measurement, H1 threshold, provider-resource, or target-identity changes.
- Do not edit historical P0 result/evidence, `api-oracle-v1.json`, historical H1 commitment artifacts, or frozen H1 design artifacts.
- Historical provider-backed P0 remains `INCONCLUSIVE`; corrected offline readjudication is additive calibration evidence and does not relabel the historical run.
- No new live P0 and no H1 provider call in this slice.
- Real H1 remains prohibited until the real preregistration receipt is committed to protected `main` and bound to an immutable ref/tag.
- Issue #33 remains a separate lifecycle/target-identity track and does not mutate frozen rc.2 H1 semantics.

---

### Task 1: Add the canonical M2.3 operational status index

**Files:**
- Create: `docs/evaluation/m2/status.md`
- Read-only evidence: `docs/evaluation/m2/retrieval-baseline-v1.json`
- Read-only evidence: `docs/evaluation/m2/p0-readjudication-v2.json`
- Read-only evidence: `docs/evaluation/m2/agent-comparison-amendment-2026-08-30.md`
- Read-only evidence: `docs/evaluation/m2/h1-prospective-design-v2.json`
- Read-only evidence: `docs/evaluation/m2/h1-preregistration-publication-v2.md`

**Produces:** One current-state document that distinguishes completed evidence, immutable historical status, blockers, and the next legally permitted experiment step.

- [ ] Create `status.md` with a heading that states it is operational/non-normative and points readers to specs/ADRs/roadmap for normative/capability semantics.
- [ ] Record the frozen rc.2 Web target fingerprint and Contract Index fingerprint already used by M2.3.
- [ ] Record R1 baseline metrics exactly: Success@5 56.25%, MRR 54.6875%, natural-language 0%, indirect 0%, forbidden-hit rate@5 20%.
- [ ] Record real P0 as executed and retained, with historical result `INCONCLUSIVE`; explicitly state that the post-P0 correction policy forbids a rerun merely to change the status string.
- [ ] Record corrected offline P0 readjudication as complete without claiming it replaces the historical result.
- [ ] Record frozen H1 design values exactly: MCID 0.10, task-success NI margin 0.05, 96 tasks, 3 trials/task/arm, 864 schedule entries, paired-task percentile bootstrap with 10,000 resamples.
- [ ] Record H1 infrastructure as implemented but distinguish that from real experiment finalization.
- [ ] Mark real private dataset, strong provider/backend identity, finalized real commitment, and real public preregistration receipt as pending/not published.
- [ ] State `H1 provider execution: PROHIBITED` until the publication invariant is satisfied.
- [ ] Add the exact forward sequence from private dataset review through public receipt, one frozen H1 execution, and terminal M2 resolution.
- [ ] Add explicit M2 routing: `PASS` -> close #34/#28 and start Exact Target Plugin Check alpha; `NEEDS-IMPROVEMENT` -> freeze result and open a bounded retrieval-improvement slice; `INCONCLUSIVE` -> only the preregistered extension path may add evidence.

### Task 2: Reconcile README repository status

**Files:**
- Modify: `README.md` under `## Repository status`

**Produces:** Product-facing status text that is accurate but does not duplicate the detailed H1 gate table.

- [ ] Replace the stale statement that M2.2 is merely on a development PR with an explicit statement that M2.1 and M2.2 are implemented and merged.
- [ ] Replace the generic "remaining M2 slice is frozen retrieval evaluation" wording with the current state: R1 baseline, provider-backed P0, corrected measurement semantics, and H1 execution/preregistration machinery are present; real H1 remains blocked on private finalization/public preregistration.
- [ ] Link `docs/evaluation/m2/status.md` as the canonical current operational state.
- [ ] Keep `docs/roadmap.md` as the capability sequencing source.
- [ ] Do not add detailed threshold/schedule tables to README.

### Task 3: Reconcile M2.3 roadmap gate state

**Files:**
- Modify: `docs/roadmap.md` under `### M2.3 — Frozen retrieval evaluation / milestone exit`

**Produces:** Capability roadmap whose exit criteria match current merged evidence without turning the roadmap into an experiment log.

- [ ] Update M2.3 status to say that R1, provider-backed P0, measurement correction/readjudication, frozen H1 design, and durable execution/preregistration infrastructure are implemented; real H1 evidence remains pending.
- [ ] Keep the measured R1 baseline unchanged.
- [ ] Replace the stale H1 prerequisite prose that says P0/MCID/NI are still unfrozen with the current facts and a link to `docs/evaluation/m2/status.md`.
- [ ] Mark provider-backed P0 execution as complete while preserving its historical `INCONCLUSIVE` state.
- [ ] Mark MCID 0.10, NI margin 0.05, 96-task/3-trial/864-entry design and paired-bootstrap analysis as frozen.
- [ ] Leave real hidden dataset/provider identity/public preregistration receipt/controlled H1 outcome unchecked.
- [ ] Keep the no-retrieval-tuning-before-evidence rule unchanged.

### Task 4: Review the branch diff for governance scope

**Files:**
- Review all changed paths between `main` and `docs/m2-operational-status-g0`.

**Produces:** Evidence that the change did not alter runtime or frozen experiment semantics.

- [ ] Confirm changed paths are limited to the design/plan plus `docs/evaluation/m2/status.md`, `README.md`, and `docs/roadmap.md`.
- [ ] Confirm no `src/**`, `spec/**`, schema, package manifest, workflow, evaluation JSON artifact, frozen commitment, or test fixture changed.
- [ ] Search changed prose for claims that P0 became `CALIBRATED` or that H1 is authorized; both must be absent.
- [ ] Search changed prose for synthetic/premature claims that a real hidden H1 dataset, provider identity, receipt, or result exists; all must be absent.
- [ ] Confirm all repository-relative links point to existing files.

### Task 5: Open the governance PR and use CI as executable verification

**GitHub objects:**
- Create PR from `docs/m2-operational-status-g0` to `main`.
- Add synchronization comments to Issues #28 and #34 after the PR number exists.

**Produces:** One reviewable G0 PR with exact CI evidence and unambiguous issue tracking.

- [ ] Open PR titled `docs(m2): reconcile H1 operational status`.
- [ ] PR `Why`: status drift can cause accidental P0 rerun or premature H1 assumptions.
- [ ] PR `What`: canonical status index plus README/roadmap reconciliation only.
- [ ] PR `Contract / architecture impact`: None; no normative/runtime contract changes.
- [ ] PR `Verification`: initially state documentation/source review only and explicitly say repository CI is pending; do not claim `pnpm check` was run locally.
- [ ] Wait for exact-head GitHub Actions and inspect every required job conclusion.
- [ ] If CI is green, update the PR verification section with the exact run id/SHA and actual required checks observed.
- [ ] Add a concise comment to #28 linking the PR and stating that stale P0/H1 prerequisite checkboxes are superseded by the canonical operational status; do not close #28.
- [ ] Add a concise comment to #34 with the same synchronization and explicit statement that real H1 remains blocked until public preregistration; do not close #34.
- [ ] Do not merge unless exact-head required CI is green; after merge, verify post-merge `main` CI before declaring G0 complete.

## Completion boundary

This plan intentionally stops before private H1 finalization. The next slice starts from the existing H1 publication procedure: privately author/review the 96-task dataset, freeze a strong provider/backend identity using probes that contain no H1 prompts, finalize the real commitment/execution definition, and publish the real preregistration receipt before any H1 model outcome.