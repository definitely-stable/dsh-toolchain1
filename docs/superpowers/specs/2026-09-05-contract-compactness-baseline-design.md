# Contract Search/Inspect Compactness Baseline Design

## Status

Approved implementation design for issue #184. This phase is measurement-only and MUST NOT change `src/**`, Protocol v1, Search ranking, Inspect semantics, native tool registration, or staged-provider behavior.

Base product commit: `a9465a962e99ebca685f0af4c308007117dbdc41`.

Frozen target: `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`.

Frozen ranker: `dsh-contract-search-v3-conservative-abstention`.

## Goal

Measure the exact model-visible compactness of the current `toolchain_contract_search` and `toolchain_contract_inspect` outputs, identify within-response duplication and Search -> Inspect reuse, and produce a deterministic receipt that can justify or reject a later production-compaction design.

## Critical methodology decisions

### 1. Measure the real wire representation

The DSH native tools render their result as `JSON.stringify(value)`. Therefore the primary response-size metric is the UTF-8 byte length of that exact string. The baseline does not canonicalize the model-visible payload before measuring it.

Production native calls use UUID request IDs. Deterministic baseline calls use distinct fixed 36-character synthetic UUIDs for Search and Inspect. This preserves production-equivalent request-id size while preventing artificial Search -> Inspect overlap.

### 2. Do not publish a model-token estimate

A `bytes / 4` or `characters / 4` conversion is only an English rule of thumb and varies by model, encoding, language, tool framing, and provider. The versioned baseline therefore records exact UTF-8 bytes and Unicode code-point counts only. A later provider-specific experiment may add exact tokenizer/provider measurements without changing this metric version.

### 3. Separate wire bytes from content classes

Each response reports:

- `wireBytes`: exact UTF-8 bytes of `JSON.stringify(response)`;
- `codePoints`: Unicode code points in the serialized response;
- `whitespaceTokens`: deterministic whitespace-delimited count over the serialized response;
- `scalarContentBytes`: UTF-8 bytes of serialized scalar values;
- `structuralBytes`: `wireBytes - scalarContentBytes`;
- `identityBytes`: target/index/contract identity text;
- `evidenceBytes`: evidence ids, sources, kinds, strengths and content hashes;
- `descriptiveBytes`: summaries, contract names/qualified names and fact key/value text;
- `controlBytes`: protocol/request/status/diagnostic control text;
- `otherScalarBytes`: remaining scalar content, including numeric scores.

These categories are an evaluation projection only. They do not redefine Protocol semantics.

### 4. Exact duplication is measured as a multiset

For data-bearing leaf strings, `repeatedLeafBytes` counts bytes from occurrences after the first identical occurrence. The baseline also reports repeated bytes by content class so necessary identity/evidence continuity can be distinguished from repeated descriptive text.

### 5. Shingles measure lexical, not semantic, overlap

The baseline MUST NOT label token-shingle similarity as semantic similarity.

Lexical normalization is versioned as `nfkc-lower-unicode-alnum-v1`:

1. Unicode NFKC;
2. lowercase;
3. extract ordered runs matching Unicode letters or numbers;
4. preserve duplicates and order.

Fixed 5-token shingles are formed within each leaf string, never across unrelated JSON fields. Within-response duplication reports total shingle occurrences, unique shingles, duplicate occurrences and duplication rate.

### 6. Search -> Inspect overlap is directional

For every answerable frozen R1 Search task, inspect the production top-1 returned contract. Report:

- exact leaf-string multiset intersection bytes;
- Search content covered by Inspect;
- Inspect content already present in Search;
- the same directional measures separately for required identity/evidence continuity and descriptive text;
- 5-token shingle intersection and directional containment.

Directional containment is required because Search and Inspect have materially different sizes; a symmetric Jaccard score alone can hide this asymmetry.

No-result tasks participate in Search distributions but have no synthetic Inspect follow-up.

### 7. Avoid cherry-picking

Search baseline uses the full frozen `M2_RETRIEVAL_R1` corpus. It therefore covers exact-symbol, package-api, natural-language, indirect, ambiguous and no-result queries without selecting cases based on compactness outcome.

Inspect baseline enumerates every contract in the frozen rc2 Contract Index. This produces an exhaustive Inspect-size distribution and objective p50/p90/p95/max and worst-case identities.

### 8. Deterministic statistics

Distributions use `nearest-rank-v1`: sort ascending and select rank `ceil(p * n)`, clamped to `[1, n]`. Receipts include `count`, `min`, `p50`, `p90`, `p95`, and `max`.

### 9. Receipt identity

The receipt is versioned as `dsh-contract-compactness-baseline-v1` and binds:

- base product commit;
- frozen fixture version;
- target fingerprint;
- Contract Index fingerprint;
- ranker version;
- full R1 corpus fingerprint;
- metric version;
- lexical normalizer and shingle size.

A recursively key-sorted `stable-json-v1` representation is used only for deterministic evaluation fingerprints/receipt comparison. It is not claimed as full RFC 8785 JCS and is not used as the measured wire payload.

### 10. Privacy-safe future turn telemetry stays out of Phase A/B

No provider run is authorized by this issue. A future staged integration may compare per-observation lexical fragments using an ephemeral random HMAC-SHA-256 key, persist aggregate overlap counts only, and discard both key and fragment tags. Plain SHA-256 tags of low-entropy API/package strings are explicitly rejected because they are dictionary-testable.

## Components

### `tests/evaluation/m2-compactness-metrics.ts`

Pure deterministic metric primitives: wire measurement, scalar classification, exact duplicate accounting, lexical tokenization/shingling, directional overlap, nearest-rank distributions, and stable evaluation JSON.

### `tests/evaluation/m2-compactness-baseline.ts`

Runs production Search/Inspect response wrappers against the frozen M2 harness and frozen retrieval corpus. Enumerates all Inspect contracts, builds Search -> top-1 Inspect paths, validates frozen identities, and returns the versioned receipt object.

### `tests/evaluation/m2-compactness-baseline.spec.ts`

TDD and regression contract. It verifies serializer parity with the native DSH tool renderer, metric edge cases, frozen identity checks, exhaustive category coverage, deterministic distributions, and exact equality with the committed receipt.

### `docs/evaluation/m2/contract-compactness-baseline-v1.json`

Durable deterministic receipt. Contains metrics and reproducible case identifiers, never raw tool-response payloads.

### `docs/evaluation/m2/contract-compactness-baseline-2026-09-05.md`

Human interpretation: whether payload size, within-response duplication, cross-call overlap, or neither justifies a separate production-compaction proposal. It must not claim provider-token savings from byte measurements alone.

## Fail-closed conditions

Generation/test fails when:

- base commit identity is not the explicitly bound candidate for this baseline;
- fixture version, target fingerprint, Contract Index fingerprint or ranker version drifts;
- R1 corpus fingerprint changes without a metric/receipt update;
- duplicate case ids exist;
- a Search top-1 contract cannot be inspected with the returned Contract Index fingerprint;
- an Inspect contract references evidence omitted from the Inspect response;
- a metric is non-finite or outside its defined range;
- receipt recomputation differs from the committed JSON.

## Non-goals

No Search/Inspect compaction, Protocol v2, output truncation, hidden summarization, ranking change, provider/model run, H1/dev-v1/dev-v2 rerun, or H2 inference occurs in this work.

## References used for methodology review

- RFC 8785, JSON Canonicalization Scheme: canonical representation is appropriate for invariant hashing, distinct from the application wire representation.
- ECMAScript/MDN `JSON.stringify`: enumerable own-property traversal has stable ordering for the same JSON-serializable object.
- Node.js `Buffer.byteLength`: exact byte length for UTF-8 encoded strings.
- OpenAI token-counting guidance: tokenization varies by model and encoding; four characters per token is only a rough English heuristic.
- A. Broder, document resemblance/containment work: fixed shingles and directional containment are established lexical duplicate-detection concepts.
- NIST HMAC guidance: keyed hashes provide the basis for future ephemeral fragment tags without persisting raw low-entropy fragment hashes.
