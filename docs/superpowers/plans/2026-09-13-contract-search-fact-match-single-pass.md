# Contract Search Fact-Match Single-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce dense intent-search CPU by eliminating intermediate arrays in per-token fact matching while preserving exact search semantics.

**Architecture:** Keep the existing document/fact index and scoring algorithm unchanged. Replace `filter + flatMap + map` in `factTokenMatch` with one ordered pass that accumulates the same evidence IDs and fact indexes, then reuse the existing deterministic `frozenEvidenceIds` normalization.

**Tech Stack:** TypeScript 6, Node 24.19, Vitest 4.

**Spec:** Existing M2 contract-search semantics and frozen R1/R2 retrieval corpus.

## Global Constraints

- No new cache or long-lived index structure.
- No public API, protocol, dependency, ranker-version, scoring, ordering, evidence, threshold, or abstention semantic change.
- Preserve fact order and deterministic evidence normalization exactly.
- Stacked validation base: `0248346eccc49d13b746771c9ea5906bfc860013` (PR #219 head).

---

### Task 1: Characterize current fact-match behavior

- [x] Run existing explanation, evidence, fact-coherence, and fielded-IDF tests on the unmodified base.
- [x] Preserve frozen R1/R2 and derived-search parity as semantic gates.

### Task 2: Replace allocation-heavy fact matching

**File:** `src/model/contract.ts`

- [x] Replace the temporary filtered facts array with a single ordered loop.
- [x] Accumulate evidence IDs and fact indexes only for matching facts.
- [x] Continue to normalize evidence IDs through `frozenEvidenceIds`.

### Task 3: Verify correctness and performance

- [x] Build succeeds after the patch.
- [x] Focused search/explanation tests and frozen retrieval/parity tests pass.
- [x] Baseline/candidate deterministic outputs are byte-equivalent.
- [x] Same-runner alternating A/B passes the >=8% mean-latency improvement gate without >3% CPU regression.

Evidence (Ubuntu 24.04 / Node 24.19, scale=4, contracts=736, 60 alternating rounds):
- baseline mean: `16.310814 ms`;
- candidate mean: `10.966654 ms`;
- latency delta: `-32.765%`;
- baseline mean CPU: `16482.2 us`;
- candidate mean CPU: `11138.4 us`;
- CPU delta: `-32.422%`;
- exact output parity: `true`.

### Task 4: Integration gate

- [ ] Rebase/retarget onto `main` only after PR #219 is integrated.
- [ ] Run full CI, Performance Validation, and Real Plugin Corpus on the final exact PR head.
- [ ] Do not merge without explicit instruction.
