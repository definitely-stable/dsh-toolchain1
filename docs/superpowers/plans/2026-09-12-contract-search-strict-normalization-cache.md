# Contract Search strict normalization cache

Status: implementation candidate
Date: 2026-09-12
Base: `feat/contract-search-postings-pruning`

## Problem

CPU profiling of the stacked #209 + #210 tree on Ubuntu 24.04 / Node 24.19 shows the strict pre-pass repeatedly rebuilding and lowercasing fact text for every contract and query. `factText()` accounts for ~58.8% of sampled CPU in warm intent search and ~84.7% in strict-search control.

## Design

Reuse the already-built internal `ContractSearchIndex` as the normalization cache for warm searches:

- retain normalized contract name, qualified name and summary in each derived search document;
- retain normalized `key + value` text in each derived fact document;
- when a validated derived index is supplied, strict matching reads those cached strings;
- when no derived index is supplied, preserve the existing cold path exactly;
- fail closed if a supplied derived index lacks the requested document.

No public API, protocol, tokenizer, score, ordering, evidence, intent threshold, abstention or ranker-version change.

## Prototype evidence

Same-runner paired A/B, 736 synthetic contracts, 20 warmups + 100 alternating rounds:

- strict warm: latency -91.05%, process CPU -90.99%;
- selective intent warm: latency -92.77%, process CPU -92.58%;
- dense intent warm: latency -61.79%, process CPU -61.73%;
- baseline/candidate lanes and `id:score` results were byte-equivalent.

This is prototype evidence only. Production acceptance still requires full R1/R2 derived parity, complete CI, Performance Validation, and bounded memory/index-build overhead.

## Acceptance

1. RED test proves derived documents do not yet retain the normalized strict-search strings.
2. Exact strict search results and evidence are identical with and without derived state for frozen R1.
3. Frozen R1/R2 retrieval and abstention snapshots remain unchanged.
4. Full CI passes on Node 22.19/24.19/26 and Windows/macOS boundaries.
5. Performance Validation passes.
6. Derived-index build/memory overhead remains bounded; otherwise reject or redesign the cache representation.
