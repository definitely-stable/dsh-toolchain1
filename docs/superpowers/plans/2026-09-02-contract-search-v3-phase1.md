# Contract Search v3 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a behavior-preserving derived ContractSearchIndex, internal explainability, and bounded fingerprint cache so later IDF/coherence ranking changes are observable and safe.

**Architecture:** Keep `ContractIndex` as the semantic/evidence identity and Protocol v1 unchanged. Add a pure model-layer `contract-search-index.ts` that derives structured fields, per-fact tokens, postings, and document frequency from an existing ContractIndex. `searchContractIndex` accepts an optional matching derived index and preserves all v2 rankings/scores; `ApplicationKernel` caches up to eight derived indexes by `(rankerVersion, contractIndexFingerprint)`.

**Tech Stack:** TypeScript 6, Node 22/24/26, Vitest 4, existing pure model/kernel architecture and GitHub Actions matrix.

**Spec:** `docs/superpowers/specs/2026-09-02-contract-search-v3-design.md`

## Global Constraints

- Parent baseline is merge commit `7f144f636cfa45edfd7233d5c7dbaab92a720c72` (`dsh-contract-search-v2-intent`).
- Protocol v1 schema/generated types must not change.
- `dsh-contract-index-v1` canonical projection/fingerprint must not change.
- Production v2 ranking and numeric scores must remain identical throughout Phase 1.
- No external runtime dependency and no semantic-layer Node globals/builtins.
- Search-index cache capacity is exactly 8; insertion beyond capacity evicts the oldest inserted key; cache hits do not refresh order in Phase 1.
- A supplied derived index with wrong ContractIndex fingerprint or ranker version fails closed.
- IDF may be computed/exposed as statistics later, but Phase 1 must not use IDF to change production ordering or scores.

---

### Task 1: RED — define derived-index behavior

**Files:**
- Create: `tests/model/contract-search-index.spec.ts`
- Create later: `src/model/contract-search-index.ts`

**Interfaces:**
- Produces expected API:
```ts
export interface ContractSearchIndex { /* immutable derived state */ }
export function createContractSearchIndex(source: ContractSearchIndexSource): ContractSearchIndex
export function searchDocument(index: ContractSearchIndex, contractId: string): ContractSearchDocument | undefined
```

- [ ] **Step 1: Write failing tests**

Cover these exact behaviors with small synthetic contracts:

```ts
const source = {
  fingerprint: `dsh-contract-index-v1:${'a'.repeat(64)}`,
  contracts: [
    {
      id: 'package:tools',
      kind: 'package',
      name: '@deepseek-ai/dsh-tools',
      qualifiedName: 'package:@deepseek-ai/dsh-tools',
      availability: 'unknown',
      summary: 'Tool schema helpers',
      facts: [
        { key: 'declaration-export', value: 'validateArgs', evidenceIds: ['e:validate'] },
        { key: 'declaration-export', value: 'ToolSchema', evidenceIds: ['e:schema'] },
      ],
      evidenceIds: ['e:validate', 'e:schema'],
    },
    {
      id: 'package:other',
      kind: 'package',
      name: '@deepseek-ai/dsh-other',
      qualifiedName: 'package:@deepseek-ai/dsh-other',
      availability: 'unknown',
      summary: 'Tool runtime',
      facts: [{ key: 'declaration-export', value: 'OtherRuntime', evidenceIds: ['e:other'] }],
      evidenceIds: ['e:other'],
    },
  ],
}
```

Assertions:
- identity tokenization splits package punctuation and CamelCase deterministically;
- `facts.length === 2` and fact 0/1 keep separate token sets and evidence;
- posting for `tool` contains two contract ids but never duplicate contract ids for repeated occurrences;
- `documentFrequency.get('tool') === 2`;
- `documentFrequency.get('validate') === 1` and `documentFrequency.get('args') === 1`;
- repeated token occurrences inside one contract do not increase DF;
- documents/postings are deterministically ordered by contract id/fact index.

- [ ] **Step 2: Run RED**

Run: `pnpm vitest run tests/model/contract-search-index.spec.ts`

Expected: FAIL because `src/model/contract-search-index.ts` / exports do not exist.

- [ ] **Step 3: Commit RED only**

Commit message: `test(search): define derived ContractSearchIndex behavior`

---

### Task 2: GREEN — implement pure ContractSearchIndex

**Files:**
- Create: `src/model/contract-search-index.ts`
- Modify only if needed for type exports: none outside model initially.
- Test: `tests/model/contract-search-index.spec.ts`

**Interfaces:**

```ts
import type { ContractDefinition } from '../protocol/index.js'

export interface ContractSearchIndexSource {
  readonly fingerprint: string
  readonly contracts: readonly ContractDefinition[]
}

export interface ContractSearchFieldDocument {
  readonly tokens: readonly string[]
  readonly uniqueTokens: ReadonlySet<string>
}

export interface ContractSearchFactDocument extends ContractSearchFieldDocument {
  readonly index: number
  readonly key: string
  readonly value: string
  readonly evidenceIds: readonly string[]
}

export interface ContractSearchDocument {
  readonly contractId: string
  readonly identity: ContractSearchFieldDocument
  readonly summary: ContractSearchFieldDocument
  readonly kind: ContractSearchFieldDocument
  readonly facts: readonly ContractSearchFactDocument[]
}

export interface ContractSearchPosting {
  readonly contractId: string
}

export interface ContractSearchIndex {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly documentCount: number
  readonly documents: ReadonlyMap<string, ContractSearchDocument>
  readonly postings: ReadonlyMap<string, readonly ContractSearchPosting[]>
  readonly documentFrequency: ReadonlyMap<string, number>
  readonly retainedTokenCount: number
  readonly postingCount: number
}

export const CONTRACT_SEARCH_RANKER_VERSION = 'dsh-contract-search-v2-intent'
export function searchTokens(value: string): readonly string[]
export function intentQueryTokens(query: string): readonly string[]
export function createContractSearchIndex(source: ContractSearchIndexSource): ContractSearchIndex
export function searchDocument(index: ContractSearchIndex, contractId: string): ContractSearchDocument | undefined
```

- [ ] **Step 1: Implement tokenizer by moving/copying v2 behavior exactly**

Use the current CamelCase/PascalCase regexes, lowercase normalization, non-alphanumeric splitting and existing linguistic stop words. `searchTokens` returns ordered unique tokens for Phase 1 compatibility; fact documents retain token order as produced by the deterministic tokenizer.

- [ ] **Step 2: Implement document construction**

For each contract build immutable identity/summary/kind/fact documents. Keep fact index and evidence ids unchanged except deterministic copy/freeze.

- [ ] **Step 3: Implement postings/DF**

For each contract create a union of all unique terms across fields/facts. Add one posting per `(token, contractId)`. Sort postings by contract id. `documentFrequency[token] = postings[token].length`.

- [ ] **Step 4: Run focused GREEN**

Run: `pnpm vitest run tests/model/contract-search-index.spec.ts`

Expected: PASS.

- [ ] **Step 5: Run architecture/type gates**

Run: `pnpm run check:architecture && pnpm run typecheck`

Expected: PASS; no semantic external/runtime dependencies.

- [ ] **Step 6: Commit**

Commit: `feat(search): add derived ContractSearchIndex`

---

### Task 3: RED — require exact v2 parity with supplied derived index

**Files:**
- Create: `tests/model/contract-search-derived-parity.spec.ts`
- Modify later: `src/model/contract.ts`

**Interfaces:**

Extend internal function source-compatibly:

```ts
export function searchContractIndex(
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit?: number,
  derived?: ContractSearchIndex,
): ContractSearchSelection
```

- [ ] **Step 1: Write parity test over full R1**

For every `M2_RETRIEVAL_R1` task:

```ts
const cold = searchContractIndex(index, task.query, undefined, 5)
const derived = createContractSearchIndex(index)
const warm = searchContractIndex(index, task.query, undefined, 5, derived)
expect(warm).toEqual(cold)
```

Also assert the full ordered `(id, score, evidenceIds)` projection is identical.

- [ ] **Step 2: Write mismatch tests**

A derived index with wrong `contractIndexFingerprint` must throw an error containing `ContractSearchIndex fingerprint mismatch`.

A derived index with wrong ranker version must throw an error containing `ContractSearchIndex ranker version mismatch`.

- [ ] **Step 3: Run RED**

Run: `pnpm vitest run tests/model/contract-search-derived-parity.spec.ts`

Expected: FAIL because the fifth argument is not supported / validation is absent.

- [ ] **Step 4: Commit RED**

Commit: `test(search): require derived-index v2 parity`

---

### Task 4: GREEN — back v2 intent matching with derived documents

**Files:**
- Modify: `src/model/contract.ts`
- Modify: `src/model/contract-search-index.ts` if a small lookup helper is needed.
- Test: `tests/model/contract-search-derived-parity.spec.ts`
- Existing regression: `tests/evaluation/m2-retrieval-v2-development.spec.ts`

**Interfaces:**
- `searchContractIndex(..., derived?)` as defined above.

- [ ] **Step 1: Remove the WeakMap intent-document cache from production matching**

The derived index becomes the source of identity/summary/kind/fact token membership for intent matching. Direct callers without `derived` create one on demand.

- [ ] **Step 2: Preserve v2 weighting exactly**

For Phase 1 retain:

```text
identity = 45
fact = 35
summary = 20
kind = 15
coverage bonus unchanged
requiredIntentMatches unchanged
strict lane unchanged
fallback top-1 unchanged
```

When a fact token matches, collect evidence ids from all facts in the same contract containing that token, preserving current v2 evidence semantics.

- [ ] **Step 3: Validate derived identity before search**

Reject mismatched ContractIndex fingerprint/ranker version before reading its documents.

- [ ] **Step 4: Run parity + v2 development gates**

Run:
`pnpm vitest run tests/model/contract-search-derived-parity.spec.ts tests/model/contract-intent-search.spec.ts tests/evaluation/m2-retrieval-v2-development.spec.ts`

Expected: all PASS and development metrics remain exactly the v2 baseline.

- [ ] **Step 5: Run full check**

Run: `pnpm check`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `refactor(search): use derived index without ranking drift`

---

### Task 5: RED — define internal search explanation

**Files:**
- Create: `tests/model/contract-search-explain.spec.ts`
- Modify later: `src/model/contract-search-index.ts` and/or `src/model/contract.ts`

**Interfaces:**

```ts
export type ContractSearchLane = 'strict' | 'intent' | 'none'
export type ContractSearchField = 'identity' | 'fact' | 'summary' | 'kind'

export interface ContractSearchTermExplanation {
  readonly token: string
  readonly documentFrequency: number
  readonly field: ContractSearchField
  readonly factIndexes: readonly number[]
  readonly evidenceIds: readonly string[]
}

export interface ContractSearchResultExplanation {
  readonly contractId: string
  readonly score: number
  readonly terms: readonly ContractSearchTermExplanation[]
}

export interface ContractSearchExplanation {
  readonly rankerVersion: string
  readonly contractIndexFingerprint: string
  readonly query: string
  readonly queryTokens: readonly string[]
  readonly lane: ContractSearchLane
  readonly results: readonly ContractSearchResultExplanation[]
}

export function explainContractSearch(
  index: ContractIndex,
  query: string,
  kinds?: readonly ContractKind[],
  limit?: number,
  derived?: ContractSearchIndex,
): ContractSearchExplanation
```

- [ ] **Step 1: Test strict explanation**

Exact `ToolDefinition` must report lane `strict`, the same winning contract/score as search, and no fabricated evidence.

- [ ] **Step 2: Test natural explanation**

A natural query matching `validateArgs` must report lane `intent`, meaningful query tokens, DF values from the derived index, `fact` as strongest matching field when appropriate, correct fact index(es), and evidence ids from those facts.

- [ ] **Step 3: Test no-result explanation**

Fictional identifier/no-match reports lane `none`, empty results and does not create a fallback candidate.

- [ ] **Step 4: Run RED and commit**

Run: `pnpm vitest run tests/model/contract-search-explain.spec.ts`
Expected: FAIL because explain API is absent.
Commit: `test(search): define internal search explanation`

---

### Task 6: GREEN — implement explanation without Protocol changes

**Files:**
- Modify: `src/model/contract.ts`
- Modify: `src/model/contract-search-index.ts`
- Test: `tests/model/contract-search-explain.spec.ts`

- [ ] **Step 1: Reuse ranking path**

Do not implement a second independent scorer. Search/explain must share the same lane decision and result ordering. Add internal match metadata where necessary, but strip it when creating `ContractReference`.

- [ ] **Step 2: Determine strongest field with v2 precedence**

For a query token, explanation uses the same precedence as v2 matching: identity -> fact -> summary -> kind. Fact matches list deterministic fact indexes and their evidence ids.

- [ ] **Step 3: Add DF from derived index**

Unknown query tokens report DF 0 only if they appear in a result explanation context; do not invent matches for them.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run tests/model/contract-search-explain.spec.ts tests/model/contract-search-derived-parity.spec.ts`
Then `pnpm check`.
Expected: PASS, Protocol generated files untouched.

- [ ] **Step 5: Commit**

Commit: `feat(search): add internal deterministic explanations`

---

### Task 7: RED — require bounded kernel fingerprint cache

**Files:**
- Modify: `tests/kernel/contract-intelligence.spec.ts`
- Modify later: `src/kernel/index.ts`

**Interfaces:**

No public Protocol/kernel method changes. Add kernel-private cache helper or a small model utility. The observable requirement is derived-index construction reuse.

Because direct constructor-call counting would require mocking internals, expose an optional test-neutral factory in `ApplicationKernelOptions` only if necessary:

```ts
readonly createContractSearchIndex?: typeof createContractSearchIndex
```

Default is the production pure builder. This is application dependency injection, not Protocol/API surface.

- [ ] **Step 1: Same fingerprint reuse**

Use contract acquisition that returns fresh object copies on every call but the same semantic fingerprint. Perform two searches. Assert derived builder called once and outputs identical results.

- [ ] **Step 2: Fingerprint change**

Change declaration content so ContractIndex fingerprint changes. Next search must invoke builder again.

- [ ] **Step 3: Capacity/eviction**

Generate nine deterministic ContractIndex fingerprints through acquisition. Assert cache never retains/reuses more than eight and revisiting the first fingerprint after nine inserts invokes builder again. Cache hits do not refresh insertion order.

- [ ] **Step 4: Run RED and commit**

Run: `pnpm vitest run tests/kernel/contract-intelligence.spec.ts`
Expected: FAIL because kernel currently rebuilds/uses scorer without fingerprint cache.
Commit: `test(kernel): require bounded contract search cache`

---

### Task 8: GREEN — implement kernel cache

**Files:**
- Modify: `src/kernel/index.ts`
- Test: `tests/kernel/contract-intelligence.spec.ts`

- [ ] **Step 1: Add per-kernel Map**

```ts
const MAX_CONTRACT_SEARCH_INDEX_CACHE = 8
const contractSearchIndexes = new Map<string, ContractSearchIndex>()
```

- [ ] **Step 2: Add cache key and getter**

```ts
function searchIndexKey(index: ContractIndex): string {
  return `${CONTRACT_SEARCH_RANKER_VERSION}\u0000${index.fingerprint}`
}
```

On miss, build, insert, and evict `contractSearchIndexes.keys().next().value` when size exceeds 8. Do not refresh on hit.

- [ ] **Step 3: Pass derived index only to search**

`inspectContract` remains unchanged and still validates/rebuilds current ContractIndex for staleness.

- [ ] **Step 4: Verify kernel and parity tests**

Run: `pnpm vitest run tests/kernel/contract-intelligence.spec.ts tests/model/contract-search-derived-parity.spec.ts`
Then `pnpm check`.
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `perf(kernel): cache derived contract search indexes`

---

### Task 9: Add performance and immutable-baseline audit

**Files:**
- Create: `tests/evaluation/m2-retrieval-v3-foundation.spec.ts`
- Existing: `tests/evaluation/m2-retrieval-v2-development.spec.ts`

- [ ] **Step 1: Rank/evidence parity audit**

Over all R1 tasks compare direct cold search with a prebuilt derived-index search. Assert complete equality of matches and evidence arrays, not only metrics.

- [ ] **Step 2: Collect bounded performance markers**

Measure with `performance.now()` in-process:
- derived index build;
- one cold R1 pass without supplied derived index;
- one warm R1 pass with one prebuilt derived index;
- retainedTokenCount;
- postingCount;
- documentCount.

Emit one marker:

```text
M2_RETRIEVAL_V3_FOUNDATION { ... }
```

Do not assert microsecond-level timing. Hard requirements are: existing `m2-retrieval.spec.ts` timeout remains unchanged; warm path must not rebuild the derived index; document/posting counters must be positive/deterministic.

- [ ] **Step 3: Full quality gate**

Run: `pnpm check`
Expected: all tests pass, v2 development metrics unchanged.

- [ ] **Step 4: Commit**

Commit: `test(search): audit v3 foundation parity and cost`

---

### Task 10: CI, documentation and merge readiness

**Files:**
- Update if needed: `docs/superpowers/specs/2026-09-02-contract-search-v3-design.md`
- Update if needed: issue #161 / PR body only; no unrelated code.

- [ ] **Step 1: Confirm no schema/fingerprint changes**

Run: `git diff <v2-baseline> -- spec/schemas/v1 src/protocol` should be empty for Protocol files. Contract canonicalization tests must remain green.

- [ ] **Step 2: Verify GitHub CI**

Required lanes: primary Node 24.19, compatibility Node 22.19/24.19/26, Windows boundary, macOS boundary.

- [ ] **Step 3: Review exact metrics**

R1 v2 metrics must remain:
- Success@1 0.90625
- Success@5 0.9375
- MRR 0.921875
- no-result 1
- forbidden-hit@5 0.2
- natural-language@5 0.8571428571428571
- indirect@5 0.8333333333333334

- [ ] **Step 4: Merge only exact green head**

Use expected-head SHA guard. Close #161 when merged. Leave #160 open for ranking-changing phases.
