# Contract Search Intent Query Hoist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Remove repeated intent-query tokenization from per-contract ranking while preserving frozen search semantics.

**Architecture:** Compute the intent query tokens and required-match threshold once after the strict lane misses, then pass that immutable query context into candidate scoring. Keep the threshold formula in the internal search-index module so production candidate selection, scoring, and evaluation use one source of truth.

**Tech Stack:** TypeScript 6, Node 24.19, Vitest 4.

**Spec:** Existing M2 contract-search semantics and frozen R1/R2 retrieval corpus.

## Global Constraints

- No public API or protocol change.
- No ranker-version change.
- No scoring, ordering, evidence, threshold, or abstention semantic change.
- No new dependency.
- Preserve strict-lane behavior and the no-whitespace intent short-circuit.
- Base validated from `8c0e0260cb31afce57a2c1d7d211977b54cae409`.

---

### Task 1: Canonical query threshold and RED coverage

**Files:**
- Modify: `src/model/contract-search-index.ts`
- Modify: `tests/model/contract-search-postings-candidates.spec.ts`

- [x] Add a failing test for the canonical threshold helper.
- [x] Observe RED before implementation.
- [x] Export the internal threshold helper from the search-index module.
- [x] Re-run the focused test to GREEN.

### Task 2: Hoist immutable intent query context

**Files:**
- Modify: `src/model/contract.ts`

- [x] Preserve the whitespace short-circuit while producing tokens once.
- [x] Compute `requiredMatches` once.
- [x] Pass tokens and threshold into `intentMatch`.
- [x] Keep the scoring function and evidence behavior unchanged.

### Task 3: Remove evaluation formula duplication

**Files:**
- Modify: `tests/evaluation/m2-postings-selectivity-analysis.spec.ts`

- [x] Import the canonical threshold helper.
- [x] Remove the duplicated formula.

### Task 4: Verify correctness and performance

- [x] Build succeeds.
- [x] Candidate, derived-parity, selectivity, and frozen R1/R2 tests pass.
- [x] Same-runner scale=4 dense-intent A/B improves versus baseline.
- [ ] Full CI, Performance Validation, and Real Plugin Corpus pass on the exact PR head.
