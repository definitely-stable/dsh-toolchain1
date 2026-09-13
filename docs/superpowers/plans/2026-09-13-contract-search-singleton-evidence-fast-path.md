# Contract Search Singleton Evidence Fast-Path Plan

**Goal:** Avoid unnecessary evidence dedupe/sort work when one fact matches one query token and that fact has at most one evidence ID.

**Boundary:** This is a narrow follow-up to the single-pass fact matcher. Multi-fact matches and single facts with multiple evidence IDs continue through `frozenEvidenceIds`, preserving existing normalization semantics even for manually constructed `ContractIndex` fixtures.

## Constraints

- No new cache or retained index state.
- No public API, protocol, dependency, ranker-version, scoring, ordering, evidence, threshold, or abstention change.
- Reuse only the immutable evidence array already owned by the derived fact document.
- Keep multi-evidence and multi-fact paths behaviorally identical to the existing implementation.

## Verification

- [x] Focused explanation/evidence/coherence/IDF tests pass before and after the patch.
- [x] Frozen R1/R2 retrieval and derived parity pass after the patch.
- [x] Exact baseline/candidate search output parity holds.
- [x] Same-runner alternating A/B clears the 5% latency gate without >3% CPU regression.

Evidence (Ubuntu 24.04 / Node 24.19, 736 contracts, 60 alternating rounds):
- baseline mean: `10.771256 ms`;
- candidate mean: `9.548084 ms`;
- latency delta: `-11.356%`;
- baseline mean CPU: `11200.0 us`;
- candidate mean CPU: `9859.1 us`;
- CPU delta: `-11.973%`;
- exact output parity: `true`.

## Integration

- [ ] Integrate only after PR #219, because this branch remains stacked on its exact head.
- [ ] Re-run full CI, Performance Validation, and Real Plugin Corpus on the final PR head after restacking to `main`.
- [ ] Do not merge without explicit instruction.
