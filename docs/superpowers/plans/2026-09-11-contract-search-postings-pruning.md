# Contract Search Postings Pruning Implementation Plan

Date: 2026-09-11
Base: PR #209 / `feat/ci-performance-stress-harness`
Status: completed with adaptive refinement on 2026-09-12

## Phase 1 — exact candidate primitive + selectivity evidence

- Add RED tests proving a postings candidate helper exactly matches exhaustive distinct-token eligibility, including repeated query tokens, no-posting tokens, thresholds 1/2/3, and empty results.
- Add the smallest internal helper to `contract-search-index.ts`; do not wire it into ranking yet.
- Measure candidate selectivity on the frozen M2 retrieval corpus and on the PR #209 synthetic performance corpus.
- Record document count, required token matches, candidate count, and ratio.

Outcome: corrected frozen R1 intent queries were highly selective (mean 1.54%, median 0.54%, max 4.89%), but the synthetic stress workload was deliberately dense.

## Phase 2 — bounded production integration

The first implementation used unconditional exact candidate filtering after strict lookup missed. Correctness stayed exact, but dense full stress showed no representative win and regressed CPU/throughput. That wiring was reverted.

The refined implementation uses an adaptive, semantics-preserving selector:

- compute `T - R + 1` rarest query postings, where `T` is distinct query-token count and `R` is the unchanged intent threshold;
- their union is a safe superset of every contract that can satisfy the threshold;
- before materializing the union, compare the sum of selected posting frequencies with the filtered contract count;
- if the posting scan cannot be cheaper, return the original contracts array unchanged;
- otherwise filter the existing ordered contracts by the safe posting union;
- keep `intentMatch`, IDF, coherence, ordering, abstention, limit and evidence projection unchanged.

## Phase 3 — performance proof

Evidence was deliberately split by workload density.

The unconditional implementation failed full benchmark/stress acceptance on dense synthetic queries and was rejected.

A same-runner paired A/B for the adaptive implementation used 736 contracts, four warmups and 20 alternating rounds:

- selective candidate sets: 1 / 736;
- selective mean latency: -23.35%;
- selective user CPU: -22.99%;
- dense queries: original 736-contract list returned unchanged;
- dense mean latency: -0.54%;
- dense user CPU: +0.36% (effectively flat).

## Phase 4 — acceptance

Accept the adaptive implementation only if final PR CI confirms:

- retrieval semantics remain exact;
- frozen R1/R2 and conservative-abstention tests remain green;
- all Node/platform/real-DSH verification remains green;
- PR performance smoke has no material control-path regression.

Do not add another search optimization in this PR. Remaining warm-path cost should be profiled separately after this change is integrated.

Detailed rationale and evidence: `docs/superpowers/plans/2026-09-12-adaptive-contract-search-pruning.md`.
