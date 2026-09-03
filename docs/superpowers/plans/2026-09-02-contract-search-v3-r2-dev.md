# Contract Search v3 R2 Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze a deterministic R2 development corpus and reusable per-query comparison diagnostics before any Contract Search v3 ranking change.

**Architecture:** Keep R2 entirely in the evaluation layer. Define a separate corpus contract bound to the existing frozen rc.2 ContractIndex, canonicalize/fingerprint it independently from R1, and compare supplied baseline/candidate rankings with transparent win/loss/tie semantics. Production search code remains untouched.

**Tech Stack:** TypeScript 6, Vitest 4, Node `crypto` in evaluation-only code, existing frozen M2 rc.2 ContractIndex fixture.

**Spec:** `docs/superpowers/specs/2026-09-02-contract-search-v3-r2-dev-design.md`

## Global Constraints

- No production scorer or ranker-version changes.
- No Protocol v1 or `dsh-contract-index-v1` changes.
- R1 is regression-only and cannot be used to select ranking parameters.
- H1 hidden tasks/outcomes are not used to select R2 tasks.
- Future R2 holdout content is not created or inspected.
- No external dependency.

---

### Task 1: RED — define R2 corpus contract and coverage

**Files:**
- Create: `tests/evaluation/m2-retrieval-r2.spec.ts`
- Create later: `tests/evaluation/m2-retrieval-r2.ts`

**Interfaces:**
- Produces `R2_DEV_SCENARIOS`, `R2_RETRIEVAL_DEV`, `validateR2RetrievalCorpus`, `canonicalizeR2RetrievalCorpus`, `fingerprintR2RetrievalCorpus`.

- [ ] **Step 1: Write failing contract tests**

Tests require all nine scenarios, unique task ids, exact rc.2 known-contract validation, answerable/no-result consistency, unknown/overlapping contract rejection, deterministic canonicalization under task/set ordering, and fingerprint drift on semantic mutation.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/evaluation/m2-retrieval-r2.spec.ts`
Expected: FAIL because `m2-retrieval-r2.ts` is absent.

- [ ] **Step 3: Commit RED**

Commit: `test(search): define R2 development corpus contract`

---

### Task 2: GREEN — implement and freeze R2-dev

**Files:**
- Create: `tests/evaluation/m2-retrieval-r2.ts`
- Test: `tests/evaluation/m2-retrieval-r2.spec.ts`

**Interfaces:**

```ts
export const R2_DEV_SCENARIOS: readonly R2DevScenario[]
export const R2_RETRIEVAL_DEV: readonly R2RetrievalTask[]
export function validateR2RetrievalCorpus(tasks, knownContractIds): void
export function canonicalizeR2RetrievalCorpus(tasks, contractIndexFingerprint): string
export function fingerprintR2RetrievalCorpus(tasks, contractIndexFingerprint): string
```

- [ ] **Step 1: Implement task/scenario types and fail-closed validation**

Require non-empty ids/domain/query/provenance/reference routes, every scenario, known contract ids, no expected/forbidden overlap, and exact no-result semantics.

- [ ] **Step 2: Add newly authored R2 tasks**

Use public rc.2 declaration/package semantics only. Include multiple natural/indirect cases plus explicit sibling, negative, version-drift, rare-term and coherent-fact stress cases. Do not copy R1 query strings.

- [ ] **Step 3: Implement canonical identity**

Sort tasks by id and sort set-like id arrays. Preserve query and route semantics. Hash canonical UTF-8 JSON with SHA-256 and prefix `dsh-contract-search-r2-dev-v1:`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run tests/evaluation/m2-retrieval-r2.spec.ts tests/evaluation/m2-retrieval-corpus.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat(eval): freeze Contract Search R2 development corpus`

---

### Task 3: RED — define per-query comparison semantics

**Files:**
- Create: `tests/evaluation/m2-retrieval-r2-comparison.spec.ts`
- Create later: `tests/evaluation/m2-retrieval-r2-comparison.ts`

**Interfaces:**

```ts
export type R2ComparisonOutcome = 'win' | 'loss' | 'tie'
export interface R2TaskComparison { /* task id, ranks, flags, outcome */ }
export function compareR2RetrievalResults(tasks, baseline, candidate): readonly R2TaskComparison[]
```

- [ ] **Step 1: Write failing tests**

Cover improved/worsened expected rank, absent expected result, forbidden-hit tie-break, correct/incorrect no-result transitions, input task/result identity mismatch, and deterministic task-id ordering.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/evaluation/m2-retrieval-r2-comparison.spec.ts`
Expected: FAIL because comparison module is absent.

- [ ] **Step 3: Commit RED**

Commit: `test(search): define R2 per-query comparison diagnostics`

---

### Task 4: GREEN — implement comparison diagnostics

**Files:**
- Create: `tests/evaluation/m2-retrieval-r2-comparison.ts`
- Test: `tests/evaluation/m2-retrieval-r2-comparison.spec.ts`

- [ ] **Step 1: Validate exact task/result coverage**

Reject duplicate, missing, or unknown task ids before comparing.

- [ ] **Step 2: Implement transparent outcome ordering**

Answerable: expected rank first (`null` = infinity), forbidden top-5 hit second. No-result: empty result correctness only.

- [ ] **Step 3: Verify GREEN**

Run: `pnpm vitest run tests/evaluation/m2-retrieval-r2-comparison.spec.ts tests/evaluation/m2-retrieval-r2.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

Commit: `feat(eval): add R2 per-query ranking diagnostics`

---

### Task 5: Freeze identity and baseline observations

**Files:**
- Modify: `tests/evaluation/m2-retrieval-r2.spec.ts`
- Create: `tests/evaluation/m2-retrieval-r2-baseline.spec.ts`

- [ ] **Step 1: Pin the literal R2-dev fingerprint**

Compute the GREEN corpus fingerprint once and assert the exact literal so semantic corpus edits require an explicit corpus-review change.

- [ ] **Step 2: Record current v2 baseline without gating future improvement**

Run production `searchContractIndex` over R2-dev with limit 5, emit one `M2_RETRIEVAL_R2_DEV_BASELINE` marker containing corpus fingerprint and aggregate descriptive counts/metrics. Do not assert current v2 R2 quality as a hard future ceiling/floor except invariant correctness checks.

- [ ] **Step 3: Keep R1 immutable gate**

Run `tests/evaluation/m2-retrieval-v2-development.spec.ts` and full R1 parity tests unchanged.

- [ ] **Step 4: Commit**

Commit: `test(search): lock R2 development identity and baseline`

---

### Task 6: Full verification and merge readiness

**Files:**
- No production files expected.

- [ ] **Step 1: Confirm changed-file boundary**

No changes under `src/model/contract.ts`, `src/model/contract-search-index.ts`, `src/protocol`, or `spec/schemas/v1` in this slice.

- [ ] **Step 2: Run full check**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 3: Verify CI**

Required: primary Node 24.19, compatibility Node 22.19/24.19/26, Windows boundary, macOS boundary.

- [ ] **Step 4: Merge exact green head**

Use an expected-head SHA guard. Close #164 only when exact-head CI is green.
