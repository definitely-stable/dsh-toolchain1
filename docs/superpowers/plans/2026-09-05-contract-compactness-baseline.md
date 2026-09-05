# Contract Compactness Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic provider-free baseline for exact model-visible Contract Search/Inspect response bytes, within-response duplication, and Search -> Inspect overlap without changing production output.

**Architecture:** Keep all measurement behavior under `tests/evaluation` and durable receipts under `docs/evaluation/m2`. Call the existing production response wrappers against the frozen rc2 kernel harness, measure their exact `JSON.stringify` wire text, enumerate the full frozen R1 Search corpus and every frozen Inspect contract, and regression-lock the result in a versioned JSON receipt.

**Tech Stack:** TypeScript 6, Node.js built-ins (`Buffer`, `crypto`), Vitest 4, existing frozen M2 fixtures and production kernel wrappers.

**Spec:** `docs/superpowers/specs/2026-09-05-contract-compactness-baseline-design.md`

## Global Constraints

- Base product candidate is `a9465a962e99ebca685f0af4c308007117dbdc41`.
- `src/**` MUST remain unchanged.
- Target remains `@deepseek-ai/dsh@0.1.1-rc.2`, profile `web`.
- Ranker remains `dsh-contract-search-v3-conservative-abstention`.
- Protocol/public schemas remain unchanged.
- No runtime dependency and no provider-backed run.
- Exact model-visible size is UTF-8 bytes of production-equivalent `JSON.stringify(response)`.
- No approximate model-token field is committed in baseline v1.
- Shingle metrics are named lexical overlap/duplication, never semantic similarity.
- Search coverage is full frozen `M2_RETRIEVAL_R1`; Inspect coverage is every frozen contract.
- Receipt stores aggregate/per-case metrics and identifiers, never raw Toolchain response bodies.

---

### Task 1: Metric primitives and serializer contract

**Files:**
- Create: `tests/evaluation/m2-compactness-metrics.spec.ts`
- Create after RED: `tests/evaluation/m2-compactness-metrics.ts`

**Interfaces:**
- Produces `measureWireResponse(value)`, `measureLeafContent(value)`, `normalizeLexicalTokens(value)`, `lexicalShingles(strings, size)`, `measureDirectionalOverlap(left, right)`, `summarizeDistribution(values)`, and `stableJsonV1(value)`.
- Later tasks consume these functions only; they do not reach into implementation internals.

- [ ] **Step 1: Write failing metric tests**

Cover exact UTF-8 bytes, Unicode code points, fixed synthetic UUID contribution, scalar-content partition summing back to total scalar bytes, repeated leaf multiset bytes, ordered Unicode lexical tokens, no cross-leaf shingles, directional containment asymmetry, and nearest-rank percentiles.

Representative assertions:

```ts
expect(measureWireResponse({ text: 'é' })).toMatchObject({
  wireJson: '{"text":"é"}',
  wireBytes: Buffer.byteLength('{"text":"é"}', 'utf8'),
  codePoints: [...'{"text":"é"}'].length,
})

expect(measureDirectionalOverlap(
  ['alpha beta gamma delta epsilon'],
  ['alpha beta gamma delta epsilon zeta eta'],
)).toMatchObject({
  leftContainment: 1,
  rightContainment: 1 / 3,
})

expect(summarizeDistribution([1, 2, 3, 4, 5])).toEqual({
  count: 5,
  min: 1,
  p50: 3,
  p90: 5,
  p95: 5,
  max: 5,
})
```

- [ ] **Step 2: Run the new spec and record RED**

Run in CI on the test-only commit:

```bash
pnpm exec vitest run tests/evaluation/m2-compactness-metrics.spec.ts
```

Expected: FAIL because the compactness metric module/API is not implemented.

- [ ] **Step 3: Implement minimal deterministic primitives**

Implementation requirements:

```ts
export const COMPACTNESS_METRIC_VERSION = 'dsh-contract-compactness-v1'
export const LEXICAL_NORMALIZER_VERSION = 'nfkc-lower-unicode-alnum-v1'
export const LEXICAL_SHINGLE_SIZE = 5

export function normalizeLexicalTokens(value: string): readonly string[] {
  return Object.freeze(value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
}
```

Use `Buffer.byteLength(text, 'utf8')`; preserve ordered duplicate tokens; form shingles only within one leaf string; use multiset intersection for exact leaf bytes; use set intersection for shingle containment; nearest-rank uses `ceil(p * n)`.

`stableJsonV1` recursively sorts object keys and uses ordinary `JSON.stringify` for primitives. Document in code that it is evaluation-only and is not claimed as RFC 8785 JCS.

- [ ] **Step 4: Run focused tests to GREEN**

```bash
pnpm exec vitest run tests/evaluation/m2-compactness-metrics.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run TypeScript/lint checks for the new files**

```bash
pnpm run typecheck
pnpm run lint
```

Expected: no new errors.

---

### Task 2: Frozen full-corpus baseline generator

**Files:**
- Create: `tests/evaluation/m2-compactness-baseline.spec.ts`
- Create after RED: `tests/evaluation/m2-compactness-baseline.ts`
- Reuse unchanged: `tests/evaluation/m2-search-inspect-fixture.ts`
- Reuse unchanged: `tests/evaluation/m2-retrieval-corpus.ts`
- Reuse unchanged: `tests/evaluation/m2-retrieval-index.ts`

**Interfaces:**
- Produces `buildCompactnessBaselineV1(): Promise<CompactnessBaselineV1>`.
- Receipt identity contains `baseCommit`, fixture/target/index/ranker identities, corpus fingerprint, metric/normalizer/shingle versions.
- `search.cases` has one case per frozen R1 task.
- `inspect.cases` has one case per frozen Contract Index contract.
- `searchInspect.paths` has one path for every Search case whose production response returns a top-1 match.

- [ ] **Step 1: Write failing frozen-baseline tests**

Require:

```ts
expect(baseline.identity).toMatchObject({
  baseCommit: 'a9465a962e99ebca685f0af4c308007117dbdc41',
  fixtureVersion: 'rc2-web-v1',
  rankerVersion: 'dsh-contract-search-v3-conservative-abstention',
  metricVersion: 'dsh-contract-compactness-v1',
})

expect(new Set(baseline.search.cases.map(item => item.category))).toEqual(
  new Set(['exact-symbol', 'package-api', 'natural-language', 'indirect', 'ambiguous', 'no-result']),
)

expect(baseline.search.cases).toHaveLength(M2_RETRIEVAL_R1.length)
expect(baseline.inspect.cases).toHaveLength(index.contracts.length)
```

Also verify every returned Search top-1 id is inspectable using the Search response Contract Index fingerprint, every inspected contract evidence id resolves in `data.evidence`, and different 36-character synthetic UUIDs are used for Search and Inspect.

- [ ] **Step 2: Run focused spec and record RED**

```bash
pnpm exec vitest run tests/evaluation/m2-compactness-baseline.spec.ts
```

Expected: FAIL because `buildCompactnessBaselineV1` is absent.

- [ ] **Step 3: Implement production-wrapper measurement**

Use existing:

```ts
searchContractsResponse(harness.kernel, request, SEARCH_REQUEST_ID)
inspectContractResponse(harness.kernel, request, INSPECT_REQUEST_ID)
```

with fixed UUID-shaped IDs:

```ts
const SEARCH_REQUEST_ID = '00000000-0000-4000-8000-000000000001'
const INSPECT_REQUEST_ID = '00000000-0000-4000-8000-000000000002'
```

For Search, run all `M2_RETRIEVAL_R1` tasks with production default limit omitted. For Inspect exhaustive distribution, enumerate `createFrozenM2RetrievalIndex().contracts`. For Search -> Inspect, inspect each successful Search top-1 match.

Build per-category distributions for `wireBytes`, `descriptiveBytes`, `evidenceBytes`, `repeatedLeafBytes`, `lexicalDuplicationRate`, `uniqueEvidencePerKiB`, plus global distributions and worst-case ids.

- [ ] **Step 4: Verify serializer parity with native DSH output renderer**

Construct native Search and Inspect tool definitions around deterministic resolvers and assert their `output.render(...)[0].text` exactly equals the response string measured by `measureWireResponse`. This proves baseline bytes match the model-visible native tool serialization path.

- [ ] **Step 5: Run focused baseline tests to GREEN**

```bash
pnpm exec vitest run tests/evaluation/m2-compactness-metrics.spec.ts tests/evaluation/m2-compactness-baseline.spec.ts
```

Expected: PASS.

---

### Task 3: Freeze and regression-lock the durable receipt

**Files:**
- Create: `docs/evaluation/m2/contract-compactness-baseline-v1.json`
- Modify: `tests/evaluation/m2-compactness-baseline.spec.ts`

**Interfaces:**
- Test reads the committed receipt and compares it deeply to fresh `buildCompactnessBaselineV1()` output.
- Receipt contains no `wireJson`, raw response bodies, prompts, CoT or staged trajectories.

- [ ] **Step 1: Add failing receipt-parity assertion**

```ts
const expected = JSON.parse(await readFile(
  new URL('../../docs/evaluation/m2/contract-compactness-baseline-v1.json', import.meta.url),
  'utf8',
))
expect(actual).toEqual(expected)
```

Before the receipt exists, print `stableJsonV1(actual)` or pretty JSON once in the focused CI log so the exact deterministic receipt can be captured.

- [ ] **Step 2: Run focused test and record RED**

Expected: FAIL because the durable receipt is missing or differs.

- [ ] **Step 3: Commit the generated receipt exactly**

Create `docs/evaluation/m2/contract-compactness-baseline-v1.json` from the focused CI-generated object. Do not manually alter metrics.

- [ ] **Step 4: Run focused receipt parity to GREEN**

```bash
pnpm exec vitest run tests/evaluation/m2-compactness-baseline.spec.ts
```

Expected: PASS with exact deep equality.

- [ ] **Step 5: Assert privacy boundary**

Add a regression assertion that the serialized receipt contains none of the keys `wireJson`, `rawResponse`, `prompt`, `chainOfThought`, `workspaceContents`, or `toolPayload`.

---

### Task 4: Interpret baseline and update evaluation status

**Files:**
- Create: `docs/evaluation/m2/contract-compactness-baseline-2026-09-05.md`
- Modify: `docs/evaluation/m2/status.md`
- Modify: issue #184 after merge only.

**Interfaces:**
- Human report cites exact receipt fields and classifies the result as one of: `PAYLOAD-SIZE`, `WITHIN-RESPONSE-DUPLICATION`, `SEARCH-INSPECT-OVERLAP`, `MULTIPLE`, or `NO-CLEAR-COMPACTION-SIGNAL`.
- It explicitly states byte measurements are not provider token savings.

- [ ] **Step 1: Derive interpretation from the frozen receipt**

Report Search and Inspect p50/p90/p95/max, worst cases, repeated descriptive bytes, lexical duplication, evidence density and both Search -> Inspect directional containments. Do not invent thresholds post hoc; describe magnitude and candidates for later independent design.

- [ ] **Step 2: Update status without authorizing production compaction**

Mark #184 deterministic baseline as implemented/verified. State that any production output change requires a new issue/PR with RED semantic parity tests and explicit contract review.

- [ ] **Step 3: Run full repository verification**

```bash
pnpm run check
pnpm run build
```

Expected: all checks green; `src/**` diff empty.

- [ ] **Step 4: Verify exact-head CI across the repository matrix**

Require every CI job for the final PR head to complete successfully before merge.

- [ ] **Step 5: Review final diff**

Confirm changed paths are only `docs/**` and `tests/evaluation/**`; no runtime/package/protocol dependency changes; no provider workflow dispatch.

- [ ] **Step 6: Merge and verify post-merge main CI**

Squash merge only after exact-head GREEN. Then require the main push CI for the exact merge SHA to be GREEN before declaring completion.
