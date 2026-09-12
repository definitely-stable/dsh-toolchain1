# Adaptive Contract Search Pruning — Implementation Note

## Decision

Use postings only when a cheap, semantics-preserving upper bound proves the candidate superset is cheaper than ranking the full filtered contract list. Dense intent queries keep the original full-list path.

For `T` distinct query tokens and required threshold `R`, any contract that can satisfy the unchanged intent threshold must occur in at least one of the `T - R + 1` rarest postings. Their union is therefore a safe candidate superset.

Before materializing that union, sum the selected posting frequencies. If that sum is greater than or equal to the number of contracts being ranked, return the original contracts array unchanged. Otherwise materialize the union and filter the contracts in their existing order.

## Evidence

Same-runner paired A/B on 736 synthetic contracts, Node 24.19, 20 alternating rounds after 4 warmups:

- selective workload: candidate set 1/736 for all four queries;
- selective mean latency: 33.453 ms -> 25.642 ms (-23.35%);
- selective user CPU: -22.99%;
- dense workload: adaptive gate returned the original 736-contract list for all four queries;
- dense mean latency: 43.833 ms -> 43.598 ms (-0.54%);
- dense user CPU: +0.36% (effectively flat).

The earlier unconditional exact-pruning implementation was rejected because the dense stress workload regressed throughput/CPU despite strong R1 selectivity.

## Invariants

- strict lane unchanged;
- package-qualified API guard unchanged;
- ranker version unchanged;
- IDF population unchanged;
- scorer, coherence bonus, ordering and abstention unchanged;
- adaptive candidate set is a superset of every contract capable of satisfying `requiredIntentMatches`;
- dense fallback returns the original contracts reference rather than building a candidate collection.
