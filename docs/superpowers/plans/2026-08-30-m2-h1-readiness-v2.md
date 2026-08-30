# M2.3 H1 Readiness & Hidden Commitment v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately versioned, fail-closed H1 readiness/commitment boundary that binds corrected M2.3 measurement semantics, commits an external hidden dataset cryptographically, and refuses H1 until the experiment is explicitly finalized with frozen thresholds, task adjudicator and immutable provider evidence.

**Architecture:** Historical H1 commitment v1 remains untouched. A new evaluation-only v2 module validates one public commitment document, derives blockers and `runAllowed`, validates/canonicalizes an externally supplied hidden dataset, hashes the complete evaluator dataset, and projects only `{id,prompt}` to the model. The public repository stores only target/measurement/statistical identities plus H1 hash/count; hidden task bytes stay outside public Git until after the experiment. Exact component source commits and a content-addressed provider-identity receipt prevent semantic aliases from silently changing under the same friendly name.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, existing canonical evaluation JSON/SHA-256 port, independent `dsh-api-truth-v2`, generic `m2-api-claims-v2`.

**Spec:** GitHub Issue #76; parent #34/#28; `docs/evaluation/m2/agent-comparison-amendment-2026-08-30.md`; `docs/roadmap.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## August 2026 external constraints

- Official DSH `dsh-v0.1.2-alpha.1` is an immutable prerelease, but it is a distinct train with substantial API/runtime changes; H1 remains frozen to registry-backed rc.2 and MUST NOT absorb alpha.1 lifecycle/API changes.
- Official DSH architecture continues to define runtime composition from profile/bundle/patch layers, reinforcing the need to bind the exact rc.2 profile/workspace identity rather than only a package version.
- GitHub Actions protected Environments can gate access to environment secrets until required-review rules pass. The later live-H1 runner should use a dedicated protected environment; this readiness slice only prepares identities for that boundary.
- GitHub secrets are limited to 48 KB. Canonical hidden H1 dataset bytes therefore MUST NOT be modeled as an ordinary repository/environment secret; the later runner should fetch/decrypt a private content-addressed blob after protected-environment approval and verify it against the public SHA-256 before any provider call.

## Global Constraints

- Evaluation/governance only. No production `src/**`, Protocol, Contract Index/ranking, provider resource widening or required-network CI.
- Do not edit historical `agent-holdout-h1.commitment.json`, `api-oracle-v1.json`, P0 definition/evidence/result, or P0 derived summary.
- No H1 provider call or H1 model outcome in this slice.
- Public repo MUST NOT contain canonical hidden H1 task prompts, oracle hints, success criteria, answers or evaluator dataset bytes.
- `runAllowed` is derived; callers cannot independently set/override it.
- `status: COMMITTED` is a separate explicit finalization gate; complete fields with `status: BLOCKED` still cannot run.
- Missing/invalid gates fail closed with explicit blockers.
- Thresholds are never inferred from observed P0 effect sizes.
- H1 provider identity must be stronger than `response-model-only` and must bind a SHA-256 identity receipt.
- Fixed target, measurement and bootstrap/statistical identities are validated against drift before H1 can become READY.

---

### Task 1: Freeze a clean RED readiness contract

**Files:**
- Create: `docs/evaluation/m2/agent-holdout-h1-v2.commitment.json`
- Create: `tests/evaluation/m2-h1-readiness-v2.spec.ts`
- Create later: `tests/evaluation/m2-h1-readiness-v2.ts`

- [x] Commit a public BLOCKED v2 document binding exact rc.2 target/workspace, Truth v2, generic API claim classifier source commit, retained P0 source/result and corrected derived report identities.
- [x] Keep task adjudicator, MCID, task-success non-inferiority margin, hidden dataset commitment and provider identity null.
- [x] Write RED tests importing the missing readiness module.
- [x] First RED CI #714 revealed an unrelated TypeScript error in the test fixture; fix the fixture rather than accepting a noisy RED.
- [x] Clean RED CI #716 fails only because `m2-h1-readiness-v2.js` does not exist.

### Task 2: Implement fail-closed readiness derivation

**Produces:**

```ts
export type H1ReadinessBlockerV2 =
  | 'COMMITMENT_NOT_FINALIZED'
  | 'TARGET_IDENTITY_INVALID'
  | 'MEASUREMENT_IDENTITY_INVALID'
  | 'TASK_ADJUDICATOR_NOT_FROZEN'
  | 'MCID_NOT_FROZEN'
  | 'NONINFERIORITY_MARGIN_NOT_FROZEN'
  | 'TASK_SET_NOT_COMMITTED'
  | 'PROVIDER_IDENTITY_NOT_FROZEN'
  | 'ANALYSIS_PLAN_INVALID'

export interface H1ReadinessV2 {
  readonly status: 'BLOCKED' | 'READY'
  readonly blockers: readonly H1ReadinessBlockerV2[]
  readonly runAllowed: boolean
}

export function evaluateH1ReadinessV2(commitment: unknown): H1ReadinessV2
```

- [x] Validate schema/version/dataset id and require explicit `status: COMMITTED` as the finalization barrier.
- [x] Validate exact rc.2 package/profile, target fingerprint, Contract Index fingerprint and ordinary-workspace SHA.
- [x] Bind Truth v2, retained P0 identities and generic API classifier to exact accepted identities/source commit.
- [x] Require future task adjudicator id plus exact 40-hex source commit before readiness.
- [x] Validate MCID as finite `0 < value <= 1` when present.
- [x] Validate task-success non-inferiority margin as finite `0 <= value <= 1` when present.
- [x] Require hidden dataset SHA-256 + positive taskCount as one atomic gate.
- [x] Require HTTPS provider endpoint, exact request/response model strings, adapter/reasoning config, immutable backend fingerprint, strength `system-fingerprint | immutable-revision`, and a lowercase SHA-256 identity receipt.
- [x] Reject `response-model-only`.
- [x] Validate the frozen three-trial paired-bootstrap plan and seeds against drift.
- [x] Derive `runAllowed = blockers.length === 0`; never read a stored runAllowed boolean.

### Task 3: External hidden dataset commitment

**Produces:**

```ts
export interface H1DatasetCommitmentV2 {
  readonly sha256: string
  readonly taskCount: number
  readonly modelTasks: readonly { readonly id: string; readonly prompt: string }[]
}

export async function commitHiddenH1DatasetV2(
  dataset: unknown,
  sha256: Sha256Port,
): Promise<H1DatasetCommitmentV2>
```

- [x] Validate `datasetId: H1`, exact rc.2 target identity, declared taskCount, stable `h1-*` ids, unique ids and non-empty prompts.
- [x] Permit evaluator-only metadata in the external dataset, but hash the complete canonical evaluator dataset.
- [x] Reject pre-populated run/result/outcome/answer material before hashing.
- [x] Project model-visible tasks strictly to `{id,prompt}`.
- [x] Return only SHA/taskCount/model projection; do not persist dataset bytes.
- [x] Prove identical prompts with different evaluator-only success metadata produce different commitments.
- [x] Prove object-key order does not change the commitment while task-array order remains committed.

### Task 4: Public-repo no-peeking and semantic identity

- [x] Assert the committed v2 JSON contains no `tasks`, `prompt`, `oracleHints`, `successCriteria` or answer fields.
- [x] Assert the committed repository state remains BLOCKED / `runAllowed=false` by derivation.
- [x] Assert target/measurement/statistical-plan drift independently blocks readiness.
- [x] Assert response-model-only or provider identity without a receipt cannot become READY.
- [ ] Re-run existing retained P0 replay invariant so report SHA remains `aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69`.
- [ ] Confirm historical H1 v1 file is unchanged in the final diff.

### Task 5: GREEN verification and merge

- [ ] Confirm focused readiness/dataset tests pass after implementation.
- [ ] Confirm full `pnpm check` on Node 22.19/24.19/26.
- [ ] Confirm Windows/macOS boundary lanes remain green.
- [ ] Confirm exact package build/pack/install, minimal+Web DSH composition and multi-train target resolution remain green.
- [ ] Audit final diff for evaluation/docs only and no hidden dataset bytes.
- [ ] Merge only exact-head green CI and verify post-merge main CI.
- [ ] Close #76 only after post-merge verification; keep #34/#28 open because task-adjudicator freeze, threshold selection, private task-set commitment, protected live-run environment and H1 execution remain separate gates.

## Follow-on slices after #76

1. **H1 task adjudicator v2:** define task-neutral, hidden-dataset-driven success semantics and content-address its exact source commit; no H1 outcomes.
2. **Threshold/task-count design:** freeze MCID and task-success non-inferiority from product significance plus deterministic sensitivity/power scenarios, never by choosing values that fit retained P0 effect sizes.
3. **Private H1 authoring + commitment:** construct the hidden dataset outside public Git, validate it locally/offline, publish only SHA-256/taskCount and the adjudicator/source identities.
4. **Provider identity receipt:** probe the intended backend before H1 and freeze endpoint/model/adapter/reasoning/backend revision plus receipt SHA-256. Mutable/response-model-only identity remains a blocker.
5. **Protected H1 runner:** `workflow_dispatch` only, exact committed `main` SHA only, dedicated protected GitHub Environment, required reviewer and no self-review/bypass where account settings permit, `permissions: contents: read`, concurrency 1, secrets released only after approval, hidden blob fetched privately and hash-verified before any provider call.
6. **Single canonical H1 execution:** run the frozen balanced schedule once. Model-outcome retries remain forbidden; only preregistered infrastructure retries are permitted.
7. **Immutable analysis/exit:** validate result against exact definition, compute paired task-level bootstrap, write PASS/NEEDS-IMPROVEMENT/INCONCLUSIVE without changing thresholds/tasks/oracle after outcomes, then resolve #34/#28 according to the frozen exit rule.
