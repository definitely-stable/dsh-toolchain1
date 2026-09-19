# Model Render Lossless Compaction Design

Status: **APPROVED FOR IMPLEMENTATION**

Related: #237, #238, and the enclosing model-render PR.

## Problem

H2 established that the Toolchain can reach correct DSH plugin states but that its model-facing
integration costs too much to reach them reliably inside a bounded coding task: Arm C matched Arm B on
the independent grader while spending 23% more provider completions, 24% more tool calls and 35% more
tokens. The post-H2 hardening lane therefore reduces the *cost* of the surface rather than adding
intelligence to it. Two costs are separable:

1. the advertised tool catalog — every advertised tool costs model context on every turn whether or
   not it is called. The lean default surface (`src/integrations/dsh/agent-surface-policy.ts`)
   addresses it: five advertised tools, 2,321 of 8,221 model-visible capability bytes withheld;
2. the result payload — a tool that returns a large canonical response charges the model for bytes
   that carry no extra decision-relevant information.

Only the second cost is in scope here. The frozen compactness baseline
(`docs/evaluation/m2/contract-compactness-baseline-v1.json`) and the frozen Inspect receipt
(`docs/evaluation/m2/contract-inspect-compaction-v1.json`) already quantify it: Contract Inspect
responses reach p95 `14,223` UTF-8 bytes and max `44,998` across 184 frozen contracts, Contract Search
stays bounded at p95 `3,080` / max `3,241` across the 36-case frozen R1 corpus, and the dominant
duplicated scalar category inside Inspect is evidence references (`334,887` repeated bytes across
`5,364` repeated occurrences).

The canonical Protocol v1 shape repeats canonical evidence ids in every row that references them and
again as `data.evidence[].id`. The application result is semantically correct and remains the source of
truth; only its direct JSON rendering is unnecessarily expensive for a model to read.

## Goals

1. Give each model-facing Toolchain result a lossless projection whose exact UTF-8 payload is never
   larger than canonical Protocol v1 JSON.
2. Keep the canonical Protocol v1 response unchanged as the application, CLI and machine-facing
   contract.
3. Prove losslessness by round-trip parity through an independent test-only inverse over a real
   frozen population, not over hand-written examples.
4. Keep native DSH and MCP model-facing text on the same projection while MCP `structuredContent` and
   CLI remain canonical.
5. Make the decision for operations that receive *no* projection explicit, measured, and mechanically
   enforced instead of implicit.
6. Quantify exact-byte effects deterministically before any provider or model experiment.

## Non-goals

- no Protocol v1 schema, generated type, example or DTO change;
- no Search ranking, score, order, `dsh-target-v2` or `dsh-contract-index-v1` change;
- no truncation, summarization, pagination, or progressive disclosure (`core | provenance | full`);
- no evidence removal: canonical evidence ids and records stay recoverable after expansion;
- no tokenizer, provider call, wall-time or model-quality claim;
- no H1/H2 rerun and no use of H2 tasks as development material;
- no rewrite of `docs/evaluation/m2/agent-surface-baseline-v1.json`, which stays the historical
  pre-change surface snapshot.

## Architecture

```text
ApplicationKernel
    |
    v
canonical Protocol v1 response
    |                         |
    |                         +--> CLI machine JSON (unchanged)
    |                         +--> MCP structuredContent + outputSchema (unchanged)
    |
    v
shared model-facing serializer (src/model/compact-response.ts)
    |
    +--> per-operation projection (search | inspect | plugin.check)
    |
    +--> native DSH text renderer
    +--> MCP text content
```

The projection is a deterministic semantic projection, never a second source of truth. The kernel
produces one canonical response; frontends that expose model-facing text may render a compact view of
it. The shared serializer lives in the runtime-neutral model layer because it is deterministic,
performs no IO and has no transport concepts; it imports nothing but Protocol types.

## Compact representations

Each projected operation has its own explicit representation identity:

| Operation | Identity |
| --- | --- |
| `contract.search` | `dsh-contract-search-compact-v1` |
| `contract.inspect` | `dsh-contract-inspect-compact-v1` |
| `plugin.check` | `dsh-plugin-check-compact-v1` |

The identity itself fixes the success-envelope invariants and therefore does not repeat them in model
text: `protocolVersion` is exactly `'1'`, `status` is exactly `'ok'`, and an omitted `diagnostics`
means the canonical empty array `[]`. Non-empty diagnostics stay explicit. These are not dropped
variable semantics: the independent inverse reconstructs the fixed values and must reproduce the
canonical response exactly.

Canonical long `evidenceIds` arrays become `evidenceRefs`, and `data.evidence` becomes
`evidenceByRef`, keyed by deterministic local refs `e0`, `e1`, ... assigned in canonical
`data.evidence` order. No canonical id is renamed or hashed; each one remains exactly present once in
its evidence record.

Decision-relevant fields are never elided or summarized:

- `plugin.check` keeps `verdict`, `subjectCompleteness`, `ruleset`, `scopeComplete` and
  `candidateCodeExecuted` explicit, so `unproven` cannot look like a pass and a static result cannot
  look like runtime verification;
- `contract.search` keeps match order, identity, availability and score;
- `contract.inspect` keeps contract identity, availability, fact order and every fact;
- failed and stale responses are returned unchanged and stay canonical.

## Non-regressing serializer

The frontends never emit a projection blindly. `serializeModelResponse` compares the exact UTF-8 byte
lengths of canonical `JSON.stringify(response)` and the projected JSON and emits the projection only
when it is **strictly smaller**. Ties and regressions fall back to canonical JSON.

This policy is `strictly-smaller-utf8-v1` and it is the reason a projection can never make a
model-facing payload larger:

- a response whose canonical example is minimal, or whose evidence ids are short enough that the ref
  table costs more than it saves, keeps canonical bytes;
- the fallback is not a lossy path: the canonical value *is* the complete value, so nothing is hidden
  by declining a projection;
- a canonical evidence id that already looks like a local ref (`e0`) would make `evidenceRefs`
  ambiguous between a local ref and an original id, so the projection declines and the response stays
  canonical.

## Lossless parity contract

Production code contains only the forward projection. Tests maintain an independent test-only inverse
(`tests/model/model-facing-inverse.ts`) written from the published representation contracts rather
than from the projection implementation, so a round-trip test proves losslessness instead of
self-consistency. For every successful response in the measured population:

```text
expandForTest(serialize(response)) == response
```

Equality is semantic JSON-value equality including reconstructed envelope invariants, request id,
snapshots and fingerprints, contract or match identity and order, optional summaries, fact order and
content, every canonical evidence id, the full evidence records in canonical order, and non-empty
diagnostics.

A successful canonical response that references an evidence id absent from `data.evidence`, or that
contains duplicate evidence records with the same id, fails loudly during projection rather than
rendering a provenance graph that looks complete.

## Decline policy

Only operations whose model-facing cost *scales with a repeated evidence graph* receive a projection.
The remaining operations deliberately render canonical Protocol v1 JSON, and the decision is recorded
with its measured ceiling:

| Operation | Declined because | Duplication ceiling | Envelope-only saving |
| --- | --- | --- | --- |
| `target.resolve` | one evidence record, referenced once | 104 B | 4 B |
| `plugin.verify` | no evidence graph | 57 B | 5 B |
| `plugin.verify.start` | no evidence graph | 0 B | −1 B |
| `operation.get` | no evidence graph | 185 B | 5 B |
| `operation.cancel` | no evidence graph | 0 B | 2 B |

"Duplication ceiling" is a deliberately generous upper bound: the bytes recoverable by interning every
repeated string scalar anywhere in the response, ignoring the reference table a real projection would
pay for. "Envelope-only saving" is what remains if the success envelope is elided and the response
carries its own representation identity instead. Both are measured on the canonical
`spec/examples/v1` response for that operation.

The rule is bounded, not asserted: a declined operation whose duplication ceiling exceeds
`256` bytes, or whose envelope-only saving exceeds `19` bytes, fails its gate and must be revisited
rather than silently declined. Three of the five declined operations are also withheld from the
default agent surface, so their model-facing text is not on the default path at all.

The decline registry is executable: every registered native tool must be classified as either
projected or declined, so a newly added operation cannot reach a model unclassified.

## Determinism

- ref assignment follows canonical evidence-array order;
- the projection is a pure function of the canonical response;
- serializer selection depends only on the exact UTF-8 bytes of two deterministic JSON
  representations;
- the measurement has no timestamps, random values, provider calls, tokenizers or filesystem-order
  dependencies, and its worst-case selection breaks ties by code point;
- the frozen receipt is compared for exact equality, so implementation or fixture drift fails loudly.

## Error handling

Projection defects are programmer/invariant failures, not normal target or plugin errors. An
unresolved evidence reference or a duplicate evidence id throws. Normal `failed` and `stale`
application responses bypass projection and keep their diagnostics unchanged.

## Testing strategy

1. Model-level specs specify each projection's exact shape, deterministic refs, implied envelope
   invariants, non-empty diagnostics, per-operation decision fields, fallback, and fail-loud
   behaviour.
2. `tests/evaluation/m2-model-render-compaction.spec.ts` measures a real frozen population — the
   36-case R1 Search corpus and derived `plugin.check` subjects built from the frozen Contract Index —
   and independently expands every response back to canonical Protocol v1.
3. The same gates require strict shortening for every measured response that repeats an evidence id,
   byte non-regression for every response, canonical passthrough for failed/stale responses, and exact
   preservation of verdict and completeness fields.
4. The measured aggregate receipt is frozen in
   `docs/evaluation/m2/model-render-compaction-v1.json` and compared exactly.
5. The deterministic surface baseline keeps a byte-derived gate: a compact tool must be strictly
   smaller than canonical, and a non-compact tool must be canonical byte for byte.
6. The real DSH composition smoke independently expands compact Contract Search text and verifies
   canonical round-trip plus byte non-regression, accepting a legitimate canonical fallback.
7. The bounded performance profile exercises the Search and Plugin Check serializer paths so the
   production call path stays covered outside the test suite.
8. Full CI remains the authoritative cross-Node/platform/package/composition verification gate.

## Acceptance boundary

The slice is complete only if:

- every measured successful response expands back to its exact canonical Protocol v1 value;
- no measured response is larger than canonical JSON, and every response that repeats an evidence id
  is strictly smaller;
- failed and stale responses remain canonical;
- evidence ids, evidence records and per-operation decision fields survive expansion;
- the canonical Protocol v1 schema, generated types and examples are untouched;
- native DSH and MCP text share the serializer while MCP `structuredContent` and CLI stay canonical;
- the frozen receipt reproduces exactly and the decline ceilings hold;
- the exact-byte receipt shows improvement without relabeling bytes as provider tokens;
- full CI is green on the exact PR head.

## Follow-up gate

This design establishes a semantically equivalent model-facing representation and exact-byte
reduction. It does **not** establish provider token savings, billed-token reduction, wall-time
improvement, model-quality improvement or end-to-end task success; any provider-backed measurement
must be separately specified and authorized.

Progressive disclosure (`core | provenance | full`), MCP resource links and pagination intentionally
change *when* data is delivered rather than how one response is encoded, and therefore require their
own design. The remaining post-H2 lane items — installing the Toolchain operating policy with the
capability, and a disclosed public development ablation of the lean surface — are separate work.
