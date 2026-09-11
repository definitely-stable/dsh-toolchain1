# Contract Search Postings Pruning Implementation Plan

Date: 2026-09-11
Base: PR #209 / `feat/ci-performance-stress-harness`

## Phase 1 — exact candidate primitive + selectivity evidence

- Add RED tests proving a postings candidate helper exactly matches exhaustive distinct-token eligibility, including repeated query tokens, no-posting tokens, thresholds 1/2/3, and empty results.
- Add the smallest internal helper to `contract-search-index.ts`; do not wire it into ranking yet.
- Measure candidate selectivity on the frozen M2 retrieval corpus and on the PR #209 synthetic performance corpus.
- Record document count, required token matches, candidate count, and ratio.

Decision gate:
- if representative intent queries materially prune the corpus, proceed to Phase 2;
- if candidate ratios are routinely near 1.0, do not add a useless filter to production ranking; retain the exact primitive/evidence only if it has a justified follow-on use, otherwise revert it and move to a postings-native scoring spike.

## Phase 2 — bounded production integration

Only if Phase 1 passes:

- In `rankContractSearch`, obtain exact candidate IDs after strict lookup misses.
- Filter the existing ordered `index.contracts` sequence by candidate ID.
- Keep `intentMatch`, `scoreIntent`, relation gating, sorting, score threshold, runner-up margin, limit, and evidence projection unchanged.
- Add black-box parity tests for frozen retrieval tasks, kind filters, ambiguous queries, no-result queries, and cold vs derived-index paths.

## Phase 3 — performance proof

- Run normal PR smoke performance validation.
- Run full `benchmark` and `stress` profiles on the optimization SHA.
- Compare against PR #209 baseline using the same runner class/profile:
  - intent cold/warm p50/p95/p99;
  - throughput;
  - CPU user/system;
  - peak RSS/heap;
  - strict-search control.
- Do not introduce a hard performance gate from one noisy hosted-run comparison.

## Phase 4 — acceptance

Accept only if:

- retrieval semantics are exactly unchanged;
- all correctness/evaluation/real-DSH CI is green;
- optimization produces a material representative improvement without a material strict-path regression.

Otherwise revert the production integration and preserve the benchmark/selectivity evidence as input to the next sparse-scoring design.
