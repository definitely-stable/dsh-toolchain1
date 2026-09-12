# Contract Search Postings Pruning Design

Date: 2026-09-11
Status: completed spike; production decision refined by `docs/superpowers/plans/2026-09-12-adaptive-contract-search-pruning.md`
Base: PR #209 head `047ee20f9dd0256bd25886ffc6d11d1650a8c570`

## Goal

Reduce CPU cost of Contract Search intent ranking without changing strict lookup, ranking, evidence projection, R1/R2 quality, or conservative-abstention semantics.

## Current evidence

The performance harness from PR #209 identifies intent search as the dominant measured hot path. On the scale=4 stress corpus (736 synthetic contracts), steady-state intent search is about 13 ops/s, cold intent search about 7 ops/s, while strict search is about 39 ops/s. Increasing same-process burst concurrency from 1 to 8 does not materially increase search throughput, which is consistent with a CPU-bound ranking path.

The kernel already caches derived ContractSearchIndex instances, so another index cache is out of scope. ContractSearchIndex already contains deterministic token postings, but `rankContractSearch` still begins intent ranking from every contract in the ContractIndex.

## Correctness constraint

The current intent eligibility predicate is exact: after kind filtering, a contract is eligible when its derived document contains at least `requiredIntentMatches(queryTokens.length)` distinct query tokens. The postings index contains one posting per document/token. Counting distinct query-token postings per contract can therefore reproduce this eligibility predicate exactly.

Candidate pruning must never use a heuristic top-K, IDF cutoff, score cutoff, rare-token requirement, or candidate cap. Those would risk changing runner-up margins and conservative abstention.

## Spike gate: prove selectivity before production change

Postings-based pruning is only valuable when it eliminates enough contracts. The synthetic stress corpus deliberately contains many shared summary tokens, so it may be an adverse case where the exact threshold still admits most documents.

Before changing `rankContractSearch`, measure candidate selectivity for:

1. the frozen retrieval corpus / current real DSH ContractIndex;
2. the synthetic performance corpus;
3. positive natural-language and negative/ambiguous queries.

Record candidate count, document count, candidate ratio, and required-match threshold. If candidate ratios are routinely near 1.0, do not ship unconditional pruning as a performance optimization.

## Spike outcome

The exact candidate primitive is semantically correct and frozen R1 intent queries are highly selective, but unconditional production pruning failed the performance gate on the dense scale=4 stress workload. It was therefore reverted rather than accepted on favorable smoke data.

The accepted refinement is adaptive and remains exact: for `T` distinct query tokens and threshold `R`, every eligible contract must occur in at least one of the `T - R + 1` rarest postings. Production uses that safe superset only when the sum of those posting frequencies is cheaper than ranking the full filtered contract list; otherwise it returns the original list unchanged. See the 2026-09-12 adaptive implementation note for paired A/B evidence and final invariants.

## Proof requirements

The optimization is acceptable only if all of the following hold:

- candidate membership never excludes a contract capable of satisfying the unchanged token threshold;
- dense fallback preserves the original full-list path;
- cold/derived search parity remains exact;
- frozen R1/R2 retrieval snapshots remain exact;
- abstention and ambiguity tests remain exact;
- full `pnpm check` and real-DSH verification stay green;
- paired performance evidence shows a material selective-workload win without a material dense/strict regression.

No retrieval-quality trade-off is permitted.

## Out of scope

- changing ranker weights or ranker version;
- changing tokenizer/normalization;
- changing conservative-abstention thresholds;
- worker-thread parallelism;
- a second derived-index cache;
- provider/model evaluation changes;
- public API changes.
