# M2.3 H1 Readiness & Hidden Commitment v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately versioned, fail-closed H1 readiness/commitment boundary that binds corrected M2.3 measurement semantics, commits an external hidden dataset cryptographically, and refuses H1 until thresholds and immutable provider identity are explicitly frozen.

**Architecture:** Historical H1 commitment v1 remains untouched. A new evaluation-only v2 module validates one public commitment document, derives blockers and `runAllowed`, validates/canonicalizes an externally supplied hidden dataset, hashes the complete evaluator dataset, and projects only `{id,prompt}` to the model. The repository commits only H1 identities/hash/count; hidden task bytes stay outside public Git until after the experiment.

**Tech Stack:** TypeScript 6, Node.js `^22.19.0 || >=24`, Vitest 4, existing canonical evaluation JSON/SHA-256 port, independent `dsh-api-truth-v2`, generic `m2-api-claims-v2`.

**Spec:** GitHub Issue #76; parent #34/#28; `docs/evaluation/m2/agent-comparison-amendment-2026-08-30.md`; `docs/roadmap.md`; `AGENTS.md`; `CONTRIBUTING.md`.

## Global Constraints

- Evaluation/governance only. No production `src/**`, Protocol, Contract Index/ranking, provider resource widening or required-network CI.
- Do not edit historical `agent-holdout-h1.commitment.json`, `api-oracle-v1.json`, P0 definition/evidence/result, or P0 derived summary.
- No H1 provider call or H1 model outcome in this slice.
- Public repo MUST NOT contain canonical hidden H1 task prompts, oracle hints, success criteria, answers or evaluator dataset bytes.
- `runAllowed` is derived; callers cannot independently set/override it.
- Missing/invalid gates fail closed with explicit blockers.
- Thresholds are never inferred from observed P0 effect sizes.
- H1 provider identity must be stronger than `response-model-only`.

---

### Task 1: Freeze RED readiness contract

**Files:**
- Create: `docs/evaluation/m2/agent-holdout-h1-v2.commitment.json`
- Create: `tests/evaluation/m2-h1-readiness-v2.spec.ts`
- Create later: `tests/evaluation/m2-h1-readiness-v2.ts`

- [x] Commit a public BLOCKED v2 document binding exact rc.2 target, Truth v2, generic API claim classifier, retained P0 source/result and corrected derived report identities.
- [x] Keep MCID, task-success non-inferiority margin, hidden dataset commitment and provider identity null.
- [x] Write RED tests importing the missing readiness module.
- [ ] Confirm CI fails only because the readiness module does not exist.

### Task 2: Implement fail-closed readiness derivation

**Produces:**

```ts
export type H1ReadinessBlockerV2 =
  | 'MEASUREMENT_IDENTITY_INVALID'
  | 'MCID_NOT_FROZEN'
  | 'NONINFERIORITY_MARGIN_NOT_FROZEN'
  | 'TASK_SET_NOT_COMMITTED'
  | 'PROVIDER_IDENTITY_NOT_FROZEN'

export interface H1ReadinessV2 {
  readonly blockers: readonly H1ReadinessBlockerV2[]
  readonly runAllowed: boolean
}

export function evaluateH1ReadinessV2(commitment: unknown): H1ReadinessV2
```

- [ ] Validate schema/version/status and exact immutable measurement identities.
- [ ] Validate MCID as finite `0 < value <= 1` when present.
- [ ] Validate task-success non-inferiority margin as finite `0 <= value <= 1` when present.
- [ ] Require hidden dataset SHA-256 + positive taskCount as one atomic gate.
- [ ] Require exact provider/request/response model, adapter/reasoning config, non-empty immutable backend fingerprint and identity strength `system-fingerprint | immutable-revision`.
- [ ] Reject `response-model-only`.
- [ ] Derive `runAllowed = blockers.length === 0`; never read a stored boolean.

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

- [ ] Validate `datasetId: H1`, exact rc.2 target identity, declared taskCount, unique stable ids and non-empty prompts.
- [ ] Permit evaluator-only metadata in the external dataset, but hash the complete canonical evaluator dataset.
- [ ] Project model-visible tasks strictly to `{id,prompt}`.
- [ ] Return only SHA/taskCount/model projection; do not persist dataset bytes.
- [ ] Prove two datasets with identical prompts but different evaluator-only oracle/success metadata have different commitments.
- [ ] Prove reordering object keys does not change the commitment while task-array order remains committed.

### Task 4: Public-repo no-peeking and semantic identity

- [ ] Assert the committed v2 JSON contains no `tasks`, `prompt`, `oracleHints`, `successCriteria` or answer fields.
- [ ] Assert the committed repository state remains BLOCKED / `runAllowed=false` by derivation.
- [ ] Assert historical H1 v1 file remains byte-unchanged.
- [ ] Assert P0 derived report SHA remains `aaba6e82c2506d0af0b440cb0bf34c1ebf68efc9293f32ca8eeeadeb294bdd69`.

### Task 5: Verification and merge

- [ ] Run focused readiness/dataset tests and existing generic API/P0 replay tests.
- [ ] Run full `pnpm check` plus normal Node/platform/package/DSH matrix.
- [ ] Audit final diff for evaluation/docs only and no hidden dataset bytes.
- [ ] Merge only exact-head green CI and verify post-merge main CI.
- [ ] Close #76 only after post-merge verification; keep #34/#28 open because thresholds, private task-set commitment, immutable provider identity and H1 execution remain real external gates.
