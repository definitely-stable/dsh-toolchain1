# Contract Search Postings Pruning Design

Date: 2026-09-11
Status: optimization spike
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

Record candidate count, document count, candidate ratio, and required-match threshold. If candidate ratios are routinely near 1.0, do not ship pruning as a performance optimization; preserve the evidence and move to a postings-native sparse scoring spike instead.

## Safe implementation if the gate passes

Add an internal model helper in `contract-search-index.ts` that returns candidate contract IDs by counting distinct query-token postings and applying the exact required-match threshold.

In `rankContractSearch`:

- leave strict/package lookup unchanged;
- build or receive the same derived index as today;
- derive the exact candidate ID set;
- preserve original `index.contracts` order and filter it by candidate membership;
- run the existing `intentMatch`, `scoreIntent`, relation gate, sort, minimum score, runner-up margin, limit, and evidence projection unchanged.

Keeping `intentMatch` after pruning is intentional for the first production change: it acts as a semantic guard even though candidate membership should make the token threshold redundant.

## Proof requirements

The optimization is acceptable only if all of the following hold:

- helper candidate membership equals exhaustive token-threshold eligibility for deterministic fixtures;
- cold/derived search parity remains exact;
- frozen R1/R2 retrieval snapshots remain exact;
- abstention and ambiguity tests remain exact;
- full `pnpm check` and real-DSH verification stay green;
- benchmark/stress show a material CPU/latency or throughput improvement on representative intent workloads;
- strict search does not regress materially.

No retrieval-quality trade-off is permitted.

## Out of scope

- changing ranker weights or ranker version;
- changing tokenizer/normalization;
- changing conservative-abstention thresholds;
- worker-thread parallelism;
- a second derived-index cache;
- provider/model evaluation changes;
- public API changes.
