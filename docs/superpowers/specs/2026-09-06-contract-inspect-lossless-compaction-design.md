# Contract Inspect Lossless Compaction Design

Status: **APPROVED FOR IMPLEMENTATION**

Related: #186, #160, #184, PR #185.

## Problem

The frozen provider-free compactness baseline proves that `contract.inspect` is the model-visible payload bottleneck on the rc2 Web fixture. Across all 184 contracts, canonical Inspect responses reach p95 `14,223` UTF-8 bytes and max `44,998`; exact repeated leaf bytes reach p95 `8,048` and max `27,101`. Search is bounded and Search -> Inspect overlap is secondary.

The current canonical Protocol v1 shape repeats canonical evidence ids in three places: `contract.evidenceIds`, each `fact.evidenceIds`, and `data.evidence[].id`. The application result is semantically correct and must remain the source of truth, but its direct JSON rendering is unnecessarily expensive for a model to read.

## Goals

1. Remove exact repeated evidence-id strings from model-facing successful Inspect text without dropping evidence.
2. Keep the canonical Protocol v1 response unchanged as the application/kernel and machine-facing contract.
3. Prove losslessness by exhaustive round-trip parity on every one of the 184 frozen Inspect contracts.
4. Keep native DSH and MCP model-facing text on the same compact representation.
5. Quantify exact-byte effects deterministically before any provider/model experiment.

## Non-goals

- no Search/ranker/score/order changes;
- no `dsh-contract-index-v1` or `dsh-target-v2` identity changes;
- no Protocol v1 schema/generated-type changes;
- no hidden truncation or lossy summarization;
- no evidence removal;
- no `core | provenance | full` modes yet;
- no MCP Resources/resource links yet;
- no pagination;
- no string-table/tuple encoding;
- no provider token or wall-time claim;
- no H1/H2 or staged-evaluation change.

## Architecture

The canonical application path remains unchanged:

```text
ContractIndex
    |
    v
ApplicationKernel.inspectContract
    |
    v
canonical ContractInspectResponse (Protocol v1)
    |                         |
    |                         +--> CLI machine JSON (unchanged)
    |                         +--> MCP structuredContent (unchanged)
    |
    v
serializeContractInspectModelResponse
    |
    +--> native DSH text renderer
    +--> MCP text content
```

Compaction is therefore a deterministic semantic projection, not a second source of truth. The kernel continues to produce one canonical response. Frontends that expose model-facing text may render a compact view of that response, while machine-facing Protocol v1 remains available unchanged.

The projection belongs in the runtime-neutral semantic model because it is deterministic, has no transport concepts, performs no IO, and is shared by DSH and MCP. It MUST NOT import Node, DSH, MCP, filesystem, or frontend packages.

## Compact representation

Successful Inspect responses use an explicit model representation identity:

```ts
interface CompactContractInspectSuccessResponse {
  readonly representation: 'dsh-contract-inspect-compact-v1'
  readonly requestId: string
  readonly snapshotFingerprint: string
  readonly data: {
    readonly contractIndexFingerprint: string
    readonly contract: CompactContractDefinition
    readonly evidenceByRef: Readonly<Record<string, Evidence>>
  }
  readonly diagnostics?: readonly Diagnostic[]
}
```

The representation identity itself fixes three success-envelope invariants and therefore does not repeat them in model text:

- `protocolVersion` is exactly `'1'`;
- `status` is exactly `'ok'`;
- omitted `diagnostics` means the canonical empty array `[]`.

Non-empty diagnostics remain explicit. These are not dropped variable semantics: the independent test-only inverse reconstructs the fixed values and must reproduce the canonical Protocol v1 response exactly. This small invariant-envelope normalization is necessary so the compact representation remains strictly smaller even for the smallest frozen successful response with repeated evidence references.

`CompactContractDefinition` preserves `id`, `kind`, `name`, `qualifiedName`, `availability`, optional `summary`, and the exact fact order/content. Canonical long `evidenceIds` arrays become `evidenceRefs` arrays.

`evidenceByRef` interns each canonical evidence record once:

```json
{
  "evidenceRefs": ["e0"],
  "evidenceByRef": {
    "e0": {
      "id": "<canonical evidence id>",
      "kind": "type-declaration",
      "strength": "authoritative"
    }
  }
}
```

Local refs are deterministic `e0`, `e1`, ... assigned in canonical `data.evidence` order. The compact representation does not rename or hash canonical evidence ids; each canonical id remains present exactly in its evidence record.

A compact success MUST fail loud during projection if a contract/fact references an evidence id not present in canonical `data.evidence`, because silently emitting an unresolved ref would weaken provenance. Duplicate canonical evidence records with the same id also fail loud.

Failed and stale Inspect responses are returned unchanged by the model serializer. They are already small and contain no successful evidence graph to intern.

## Non-regressing serializer

The frontends do not blindly emit the compact projection. `serializeContractInspectModelResponse` compares exact UTF-8 byte lengths of canonical `JSON.stringify(response)` and compact JSON and emits compact only when it is strictly smaller. Ties or regressions fall back to canonical JSON.

This policy is `strictly-smaller-utf8-v1`. It is a safety boundary for future/pathological inputs; the frozen exhaustive acceptance additionally requires every successful Inspect that actually repeats evidence references to be strictly smaller, not merely protected by fallback.

## Lossless parity contract

The production code contains only the forward compact projection. Tests maintain an independent test-only expander so round-trip verification does not merely test a production encoder against its own decoder.

For every successful canonical Inspect response in the frozen exhaustive population:

```text
expandForTest(compactContractInspectModelResponse(canonical)) == canonical
```

Equality is semantic JSON-value equality, including:

- reconstructed Protocol v1 success-envelope invariants;
- request id and target snapshot fingerprint;
- Contract Index fingerprint;
- contract identity and availability;
- optional summary;
- fact ordering, keys, values and canonical evidence ids;
- contract-level canonical evidence ids;
- full evidence records and their order;
- non-empty diagnostics, with omitted diagnostics reconstructed as `[]`.

The test additionally proves every `evidenceRef` resolves exactly once and every canonical evidence record is reachable.

## Duplication attribution

Before interpreting byte improvements, the evaluation suite adds deterministic path-level attribution over the same 184 canonical responses. Repeated string occurrences are grouped by exact value. One canonical occurrence is retained according to a fixed priority; remaining bytes are attributed to their occurrence path.

Attribution categories:

- `evidence-reference` — values under contract/fact `evidenceIds`;
- `evidence-record-id` — canonical `data.evidence[].id`;
- `evidence-source`;
- `evidence-content-hash`;
- `evidence-location`;
- `fact-key`;
- `fact-value`;
- `contract-identity`;
- `other`;
- `summary`.

For evidence ids the retained authoritative occurrence is `evidence-record-id`; repeated contract/fact references are therefore attributed to `evidence-reference`. This directly measures the bytes targeted by evidence interning instead of relying only on a generic repeated-leaf total.

The receipt is provider-free and reports distributions and worst cases only. It does not publish raw prompts, model traces, workspace contents, or a byte-to-token conversion.

## Frontend behavior

### Native DSH

`toolchain_contract_inspect` continues to execute and return the canonical `ContractInspectResponse` value internally. Its text renderer uses the shared non-regressing model serializer. Search rendering is unchanged.

### MCP

`contract.inspect` keeps Protocol v1 `outputSchema` and canonical Protocol v1 `structuredContent`. Only human/model text `content[0].text` uses the shared non-regressing serializer. This preserves machine consumers while reducing the redundant text channel used by model clients.

### CLI

CLI JSON remains canonical Protocol v1. This slice does not add a compact CLI flag because the measured bottleneck is model-facing Inspect rendering, not machine JSON transport.

## Determinism

- ref assignment follows canonical evidence-array order;
- no maps keyed by filesystem path or runtime object identity;
- no random values, timestamps, provider calls, tokenizers or platform-dependent sorting are introduced;
- the projection is a pure function of the canonical response;
- serializer selection depends only on exact UTF-8 bytes of the two deterministic JSON representations.

## Error handling

Projection defects are programmer/invariant failures, not normal target/plugin errors. A canonical successful response with an unresolved evidence reference or duplicate evidence id throws rather than emitting a partially supported compact result.

Normal `failed` and `stale` application responses bypass compaction and retain existing diagnostics unchanged.

## Testing strategy

1. Synthetic RED unit tests specify exact compact shape, deterministic refs, implied envelope invariants, non-empty diagnostics, fallback, and fail-loud evidence behavior.
2. Exhaustive RED test covers all 184 frozen successful Inspect contracts and independently expands every compact result back to canonical Protocol v1.
3. The exhaustive gate requires strict byte reduction for each successful frozen Inspect containing repeated canonical evidence references; no-benefit cases may only tie, never regress.
4. Frontend tests prove native DSH and MCP text use the same serializer while MCP structured content stays canonical.
5. Real DSH composition smoke independently expands compact text and verifies canonical round-trip plus byte non-regression.
6. Existing Search, Inspect, stale/not-found and frontend suites remain regression guards.
7. Provider-free evaluation computes before/after exact UTF-8 distributions and attribution.
8. Full CI remains the authoritative cross-Node/platform/package/composition verification gate.

## Acceptance boundary

The slice is complete only if:

- 184/184 exhaustive round-trip parity passes;
- every compact evidence ref is resolvable and deterministic;
- every frozen successful response with repeated evidence references is strictly smaller through the production serializer;
- no measured response regresses;
- Search production behavior is untouched;
- Protocol v1 schema/generated types are untouched;
- native DSH and MCP model text share the serializer;
- MCP structured content and CLI remain canonical;
- exact-byte receipt shows improvement without relabeling bytes as provider tokens;
- full CI is green on the exact PR head.

## Follow-up decision gate

Only after this lossless representation is proven should a separate design consider progressive disclosure (`core | provenance | full`), deterministic MCP resource URIs/resource links, or pagination for pathological contracts. Those mechanisms intentionally change when data is delivered, unlike this first lossless single-response compaction, and therefore require separate review.