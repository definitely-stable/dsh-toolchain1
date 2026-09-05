# Contract Search / Inspect compactness baseline — 2026-09-05

Status: **COMPLETE / MEASUREMENT-ONLY**

This receipt measures the frozen Contract Search / Inspect product at base commit `a9465a962e99ebca685f0af4c308007117dbdc41`. It does not change production output, ranking, Protocol, Contract Index semantics, or provider execution.

Canonical machine-readable receipt: [`contract-compactness-baseline-v1.json`](contract-compactness-baseline-v1.json).

## Frozen identity

- DSH: `@deepseek-ai/dsh@0.1.1-rc.2`
- profile: `web`
- target: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`
- Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`
- ranker: `dsh-contract-search-v3-conservative-abstention`
- compactness corpus: `dsh-contract-compactness-r1-v1:9e738791960745ccc6e08ecc4d87568ed9a4c4ed7bcc569e996b8720e5f2b58e`
- metric version: `dsh-contract-compactness-v1`
- lexical normalization: `nfkc-lower-unicode-alnum-v1`, fixed 5-token shingles

The population is exhaustive for the frozen fixture: all **36** R1 Search queries, all **184** Contract Index contracts for Inspect, and all **30** actual Search → top-1 Inspect paths produced by current production Search.

## Measurement contract

The primary size metric is the UTF-8 byte length of the exact text exposed by the native DSH tool renderer: `JSON.stringify(response)`. Deterministic stable JSON is used only for receipt identities, not to redefine the production wire representation.

No approximate model-token count is published. A byte-to-token constant would be model/tokenizer dependent and would create false precision. Provider-billed input tokens therefore remain a separate future measurement if a pinned provider/tokenizer experiment is explicitly authorized.

Five-token shingle metrics are **lexical overlap only**. They are not semantic similarity, token billing, or proof that text can be removed safely. Exact leaf-string byte overlap is the primary redundancy signal.

The committed receipt contains identities, population counts, aggregate distributions and worst-case identifiers only. It does not retain raw tool responses, prompts, chain-of-thought, workspace contents or raw tool payloads. Full per-case measurements are reproduced provider-free by the test suite from the frozen fixture.

## Results

| Metric | Search | Inspect |
| --- | ---: | ---: |
| wire bytes p50 | 1,258 | 4,260 |
| wire bytes p95 | 3,080 | 14,223 |
| wire bytes max | 3,241 | 44,998 |
| repeated exact leaf bytes p50 | 163 | 1,761 |
| repeated exact leaf bytes p95 | 693 | 8,048 |
| repeated exact leaf bytes max | 728 | 27,101 |
| repeated exact leaf rate p50 | 12.97% | 40.89% |
| repeated exact leaf rate p95 | 22.46% | 55.15% |
| repeated exact leaf rate max | 22.50% | 65.31% |
| unique evidence ids / KiB p50 | 1.60 | 1.06 |

Search is bounded and comparatively compact. Its largest observed response is only 3,241 bytes. Inspect is the dominant response-size tail: p95 is 14,223 bytes and `package:@deepseek-ai/dsh-client-runtime` reaches 44,998 bytes.

Inspect also carries substantial exact within-response repetition. The median response repeats 1,761 serialized leaf bytes (40.89% of the full wire payload by this conservative leaf accounting), p95 repeats 8,048 bytes (55.15%), and the worst contract repeats 27,101 bytes.

## Search → Inspect overlap

Across the 30 actual Search → top-1 Inspect paths:

- exact Search content later present in Inspect: p50 **100%**, minimum **58.12%**;
- exact Inspect content already present in Search: p50 **18.41%**, p95 **27.67%**, max **35.82%**;
- exact descriptive Inspect content already present in Search: p50 **7.72%**, p95 **12.17%**, max **14.14%**.

This is asymmetric. Inspect generally subsumes the preceding Search result, but most Inspect bytes are still new. Therefore cross-turn Search → Inspect repetition is real, but it is not the main source of payload inflation.

The lexical shingle signal is much larger — median Inspect-side containment is 60%, and descriptive containment is 70% — but this is only corroborative lexical reuse. It must not be converted directly into removable bytes or token-savings claims.

## Decision

**Production compaction is justified for Inspect as a separate engineering phase. Search is not the primary compactness bottleneck.**

The evidence points to this ordering for a future proposal:

1. reduce exact within-Inspect duplication first, especially repeated evidence/provenance and repeated contract/fact projections;
2. preserve one authoritative representation for every evidence-bearing fact and maintain direct inspectability;
3. consider Search → Inspect continuity compaction only after within-Inspect duplication is addressed;
4. leave Search ranking and selection behavior unchanged unless independent retrieval evidence requires otherwise.

The baseline does **not** justify lossy summarization, hidden truncation, evidence removal, ranking changes, or a provider-token savings claim.

## Required parity boundary for a future production PR

A separate production-compaction change must begin with RED tests and preserve at minimum:

- selected contract ids and Search ranking/order;
- current scores where exposed by the semantic result;
- target and Contract Index provenance;
- evidence ids and evidence resolvability;
- stale-target and fail-closed behavior;
- no-result and conservative-abstention semantics;
- ability to Inspect every returned contract/evidence path;
- CLI/native/MCP semantic parity.

Only after a semantically equivalent compact representation exists should provider-backed measurement be considered to estimate actual model-token and end-to-end cost effects.
