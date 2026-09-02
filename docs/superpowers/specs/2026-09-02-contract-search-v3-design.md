# Contract Search v3 Design

Status: approved for implementation on 2026-09-02.

Parent issue: #160. Phase 1 issue: #161.

Baseline: `dsh-contract-search-v2-intent` merged by PR #159 at merge commit `7f144f636cfa45edfd7233d5c7dbaab92a720c72`.

## Problem

Contract Search v2 fixed the largest product gap without adding a model or external search engine. On the frozen R1 development corpus it reaches Success@1 90.625%, Success@5 93.75%, MRR 92.1875%, natural-language Success@5 85.714%, indirect Success@5 83.333%, no-result correctness 100%, and forbidden-hit@5 20%.

The remaining weakness is not candidate discovery in general. It is ranking quality and confidence for natural/indirect queries. The v2 intent scorer sums fixed per-field token weights (identity 45, fact 35, summary 20, kind 15), flattens all facts into one token-to-evidence map, caps required matches at three, and uses an object-identity WeakMap that does not survive ContractIndex rematerialization between application-kernel calls.

A direct replacement with a full-text engine, embeddings, SPLADE, ColBERT, RRF, or an LLM reranker would add runtime/dependency/reproducibility cost before the deterministic evidence model has been exhausted. The v3 design therefore keeps the exact-target, provenance-backed core and applies code-search/IR ideas selectively.

## Goals

1. Preserve the exact identifier/package lookup behavior and anti-hallucination properties that already work.
2. Make search state a deterministic derived index keyed by semantic ContractIndex identity rather than object identity.
3. Preserve fact boundaries so ranking can distinguish one coherent API fact from tokens scattered across unrelated facts.
4. Add corpus-level term significance (IDF) and field-aware scoring only to the natural-language lane after the foundation is proven.
5. Make rank decisions inspectable internally before further tuning.
6. Add conservative abstention before fuzzy or semantic expansion.
7. Keep Protocol v1 and `dsh-contract-index-v1` semantic identity stable through the core v3 phases.

## Non-goals

The initial v3 implementation does not add embeddings, vector databases, neural rerankers, SPLADE, ColBERT, RRF, PageRank, query rewriting, a synonym dictionary, an external search-engine dependency, Protocol v2, or fuzzy identifier matching. These are separate experiments only after deterministic v3 reaches a measured plateau.

## Frozen invariants

The following invariants are hard gates, not optimization targets:

- `dsh-contract-index-v1` canonical projection and fingerprint do not change.
- Protocol v1 JSON schema does not change during foundation, IDF, fact-coherence, and abstention phases.
- exact-symbol Success@5 remains 100% on the historical R1 regression corpus.
- package-api Success@5 remains 100% on R1.
- no-result correctness remains 100% on R1.
- forbidden-hit@5 remains <= 20% on R1.
- every returned evidence id resolves in the exact ContractIndex used for the response.
- ranking is deterministic across supported Node and platform lanes.
- no semantic/model layer imports Node runtime globals, builtins, DSH runtime packages, or new external dependencies.
- cache state can change latency only; cache hits, misses, and eviction cannot change ranking, scores, evidence, or ContractIndex identity.

## Existing boundaries

`ContractIndex` is the semantic, target-bound evidence object. It is created from normalized `ContractDefinition[]` and `Evidence[]`, has fingerprint `dsh-contract-index-v1:<sha256>`, and is rebuilt by the application kernel from current target/contract acquisition.

`ContractReference` is already part of Protocol v1 and contains `score: number`. v3 therefore keeps a numeric public score for compatibility. Internally, ranking may use richer structured keys; external score remains a deterministic projection and must never redefine ContractIndex identity.

`ApplicationKernel.searchContracts` currently rebuilds ContractIndex on every call. v2 uses `WeakMap<ContractDefinition, IntentDocument>` inside the scorer. A rebuilt index produces new objects and therefore defeats cross-call object-identity caching. v3 moves reusable query-independent state to a fingerprint-keyed derived search index.

## Architecture

### 1. ContractSearchIndex is derived state

A new model-layer module owns query-independent search structures:

```ts
export interface ContractSearchIndex {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly documentCount: number
  readonly documents: ReadonlyMap<string, ContractSearchDocument>
  readonly postings: ReadonlyMap<string, readonly ContractSearchPosting[]>
  readonly documentFrequency: ReadonlyMap<string, number>
}
```

It is derived solely from an already-validated ContractIndex and the ranker version. It is never serialized into ContractIndex, never included in its canonical projection, and is not authoritative evidence.

### 2. Structured search documents preserve facts

```ts
export interface ContractSearchDocument {
  readonly contractId: string
  readonly identity: ContractSearchFieldDocument
  readonly summary: ContractSearchFieldDocument
  readonly kind: ContractSearchFieldDocument
  readonly facts: readonly ContractSearchFactDocument[]
}

export interface ContractSearchFactDocument {
  readonly index: number
  readonly key: string
  readonly value: string
  readonly tokens: readonly string[]
  readonly uniqueTokens: ReadonlySet<string>
  readonly evidenceIds: readonly string[]
}
```

Identity, summary, kind, and each fact retain ordered tokens. Document frequency counts a term once per contract, regardless of how many fields/facts contain it.

### 3. Tokenization stays code-aware and deterministic

The existing v2 behavior for CamelCase/PascalCase splitting, punctuation/dotted/kebab normalization, lowercase ASCII-oriented tokenization, deduplication for set membership, and the small linguistic stop-word set is retained initially.

Domain words such as `tool`, `agent`, `session`, `runtime`, `service`, and `profile` are not added to a manual stop-list. Future IDF naturally reduces their influence when their document frequency is high.

### 4. Search execution remains a strict-first cascade

The externally observable cascade remains:

1. strict exact/identifier/package/fact matching;
2. only if strict returns zero candidates and the query is a genuine multi-word intent query, natural-language fallback.

Phase 1 must preserve v2 ranking byte-for-byte/rank-for-rank. Later natural-lane phases may change only the fallback lane unless a separate design explicitly reopens strict semantics.

### 5. Internal explainability

Before changing natural scoring, v3 exposes an internal model-layer explanation API, not a Protocol field:

```ts
export interface ContractSearchExplanation {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly query: string
  readonly queryTokens: readonly string[]
  readonly lane: 'strict' | 'intent' | 'none'
  readonly results: readonly ContractSearchResultExplanation[]
}
```

Each result records contract id, public score, matched terms, strongest field for each term, fact index when applicable, document frequency, evidence ids, and (when relevant) rejection/acceptance metadata. Foundation explainability describes v2 decisions; later phases add IDF/coherence components without changing the Protocol response.

Explain output is diagnostic and may evolve with ranker version. It must not be used as evidence or become part of fingerprints.

### 6. Kernel cache

`ApplicationKernel` owns a bounded in-process cache:

```text
key = rankerVersion + "\0" + contractIndexFingerprint
value = ContractSearchIndex
capacity = 8
```

The cache is insertion-ordered. On insertion beyond capacity, evict the oldest entry. A cache hit does not refresh recency in Phase 1; this deliberately keeps behavior simple and deterministic. Cache entries are immutable derived values.

Why kernel, not a global module cache:

- kernel lifetime matches application/service lifetime;
- multiple kernels/tests remain isolated;
- no unbounded global state;
- exact ContractIndex fingerprint is already available there;
- cache behavior can be tested independently from acquisition.

Search receives an optional prebuilt derived index. Existing direct callers of `searchContractIndex(index, query, kinds, limit)` remain source compatible; when no derived index is supplied, the scorer builds one on demand.

Inspect does not require ContractSearchIndex and remains unchanged.

## Phase 1: behavior-preserving foundation

Phase 1 implements only:

- `ContractSearchIndex` construction;
- structured per-fact documents;
- postings and document frequency;
- optional derived-index search parameter;
- v2 intent matching backed by derived documents instead of WeakMap object cache;
- internal explain API;
- bounded kernel fingerprint cache;
- rank/evidence parity regression;
- cold/warm performance measurements.

It explicitly does not enable IDF in production.

## Phase 2: fielded IDF natural scorer

After Phase 1 is merged and observable, natural fallback becomes term-centric.

For query term `t` over `N` contract documents:

```text
idf(t) = log(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
```

Term frequency starts binary/saturated. Repetition of a common declaration token must not dominate relevance.

For each term, use the strongest semantic placement instead of summing every field occurrence. Initial relative ordering is:

```text
identity > fact > summary >> kind
```

Exact numeric weights are chosen on an R2 development corpus, not by continuing to tune R1. The scoring architecture is more important than any initial constants.

## Phase 3: fact coherence

The scorer computes how much matched IDF is explained by the strongest single fact. A candidate with three discriminative terms in one fact must outrank a candidate where the same terms are scattered across unrelated facts, all else equal.

Coherence is a secondary rank signal after meaningful term coverage/rarity; it never fabricates evidence. The winning fact's existing evidence ids are returned/explained.

## Phase 4: R2 development corpus

R1 is historical regression evidence after v2. It must not become the tuning set for v3.

R2-dev must contain:

- natural paraphrases of real DSH operations;
- indirect intent queries;
- long queries with generic filler and several discriminative terms;
- sibling-package confusion (`dsh-subagent` variants, compaction variants, interface vs implementation packages);
- fictional identifier negatives;
- natural-language hard negatives where only generic terms occur;
- version-drift negatives;
- queries where the correct result is one rare term plus one supporting term;
- queries where misleading terms are distributed across different facts.

A later R2 holdout is frozen before final tuning and is not read during optimization.

## Phase 5: acceptance and abstention

Only after R2 exists, replace v2's `min(3, max(2, ceil(tokens*0.4)))` with query-length- and information-aware acceptance.

Inputs include:

- meaningful query-token count;
- matched token count;
- matched IDF coverage;
- out-of-vocabulary ratio;
- strongest-fact coherence;
- top-1/top-2 separation when multiple candidates survive.

Low-confidence intent queries return no result rather than a weak guess. High-confidence navigational intent may return one result. Truly ambiguous but high-confidence intent may return a small bounded set in a later phase.

## Optional later phases

Coarse fact-local proximity (same fact, ordered sequence, adjacent/near) is considered only if R2 demonstrates remaining confusion. Full positional indexing is not built preemptively.

Fuzzy identifier matching is a separate lane after v3 precision stabilizes. It must be restricted to identifier-like queries and protected by fictional-API negatives. It is not allowed to weaken strict no-result behavior.

Graph/PageRank context and semantic sparse/dense retrieval are research options only after deterministic v3 plateaus.

## Public score compatibility

Protocol v1 requires `ContractReference.score: number`. During Phase 1 the exact v2 scores are preserved. Later v3 internal ranking may use a lexicographic rank key. If so, the public number is a deterministic bounded projection used for display/debugging; the internal comparator, not floating-point score arithmetic across unrelated lanes, defines ranking.

Any change to public score semantics requires a dedicated compatibility test and documentation, but not necessarily a Protocol schema version because the type remains `number`.

## Performance requirements

Phase 1 records at least:

- derived-index build time;
- cold search time (build + search);
- warm search time using cached derived index;
- derived document/posting counts;
- approximate retained token/posting count as a stable memory proxy.

The existing production R1 search test remains under its current timeout. Raising timeout is not an acceptable response to a performance regression.

The corpus is small enough that a native in-memory `Map`/array implementation is preferred over Tantivy/Meilisearch/Typesense/OpenSearch or another runtime service.

## Failure handling

SearchIndex construction assumes ContractIndex has already passed reference validation. If a derived index is supplied whose `contractIndexFingerprint` or `rankerVersion` does not match the search request, the model layer fails closed with a programmer error rather than silently using stale derived state.

Kernel cache misses rebuild deterministically. Eviction never causes a user-facing failure.

No fallback is allowed from a stale derived index to a different ContractIndex.

## Testing strategy

Phase 1 uses TDD and must prove:

1. SearchIndex preserves per-fact boundaries and evidence ids.
2. Document frequency counts contracts, not repeated occurrences.
3. Postings are deterministic and do not reference unknown contracts.
4. Derived index identity matches the supplied ContractIndex fingerprint and ranker version.
5. v2 output parity holds over the full frozen R1 corpus with and without a supplied derived index.
6. Explain output identifies lane/terms/fact placement without changing search output.
7. Kernel reuses one derived index across repeated searches with the same semantic ContractIndex even when acquisition rematerializes new objects.
8. A changed ContractIndex fingerprint builds a new derived index.
9. Cache never exceeds eight entries and deterministic eviction preserves correctness.
10. Protocol schema/generated files remain unchanged.
11. Full Node 22/24/26, Linux/macOS/Windows CI remains green.

Ranking-changing phases add per-query win/loss/tie diagnostics and cannot merge on aggregate improvement alone.

## Rollout

Each ranking-changing phase is a separate PR. Phase 1 is deliberately behavior preserving so it can merge independently and provide observability for later changes.

The canonical implementation sequence is:

```text
v2 baseline
  -> Phase 1 SearchIndex/explain/cache
  -> Phase 2 fielded IDF
  -> Phase 3 fact coherence
  -> R2-dev
  -> Phase 5 abstention
  -> optional proximity
  -> optional identifier fuzzy
  -> fresh R2 holdout / later H2 agent evaluation
```
