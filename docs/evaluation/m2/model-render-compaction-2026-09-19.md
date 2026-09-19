# Model-facing render compaction — 2026-09-19

## Status

**COMPLETE / PROVIDER-FREE PRODUCT MEASUREMENT** for the frozen `rc2-web-v1` evaluation fixture,
pending the enclosing PR's full exact-head CI/merge gate.

This result measures the production model-facing serializers for `contract.search`, `contract.inspect`
and `plugin.check`. It does not change canonical Toolchain Protocol v1 responses, Search ranking,
`dsh-target-v2`, `dsh-contract-index-v1`, or any CLI/MCP machine-facing payload.

Design: [`2026-09-19-model-render-lossless-compaction-design.md`](../../superpowers/specs/2026-09-19-model-render-lossless-compaction-design.md).
Canonical machine receipt: [`model-render-compaction-v1.json`](model-render-compaction-v1.json).

## Production boundary

Successful model-facing responses may be projected to one explicit representation per operation
(`dsh-contract-search-compact-v1`, `dsh-contract-inspect-compact-v1`,
`dsh-plugin-check-compact-v1`), which interns canonical evidence records once and replaces repeated
long evidence ids with deterministic local refs (`e0`, `e1`, ...). The representation identity fixes
`protocolVersion='1'`, `status='ok'` and "omitted diagnostics means `[]`"; non-empty diagnostics stay
explicit.

Native DSH and MCP use the same serializer for text; MCP `structuredContent` and CLI output remain
canonical Protocol v1. The policy is `strictly-smaller-utf8-v1`: a projection is emitted only when its
exact UTF-8 payload is strictly smaller than canonical JSON, so ties and regressions fall back to
canonical bytes rather than growing the model-facing payload.

## Measured population

| Population | Source | Cases |
| --- | --- | --- |
| `contract.search` | the frozen `M2_RETRIEVAL_R1` query corpus against the frozen `rc2-web-v1` Contract Index | 36 |
| `plugin.check` | subjects derived from the frozen Contract Index: five real versioned package contracts as `host-peer-required` rows, once satisfied, once version-mismatched, plus a `partial` subject and a zero-requirement subject | 4 |

The `plugin.check` population is **derived, not observed**: the frozen fixture is a real DSH target and
Contract Index, but it contains no plugin workspace. Each derived requirement names a package the exact
target really exposes and the subject is bounded to five Host peers so the measured responses stay in
the same order of magnitude as a real plugin check rather than describing a pathological construction.
It is therefore not real-plugin coverage; the network-backed real-plugin corpus workflow is a separate
boundary.

The canonical `spec/examples/v1` responses are deliberately *not* the measured population. They are
hand-written contract examples: `plugin-check-version-mismatch.json` carries empty `evidenceIds` and
empty `evidence`, so it cannot show whether evidence interning pays. Measurement uses kernel-produced
responses for exactly that reason.

## Frozen result

`contract.search` (36 cases):

- lossless round-trip: **36/36**;
- improved: **30**; unchanged: **6**; regressed: **0**;
- aggregate bytes: `48,474 → 44,612`;
- aggregate reduction: **3,862 bytes / 7.9672%**;
- p50: `1,258 → 1,171` bytes; p95: `3,080 → 2,725` bytes; max: `3,241 → 2,841` bytes;
- largest case `natural-session-search-text`: `3,241 → 2,841` bytes, saving `400` bytes.

`plugin.check` (4 cases):

- lossless round-trip: **4/4**;
- improved: **3**; unchanged: **1**; regressed: **0**;
- aggregate bytes: `25,070 → 22,199`;
- aggregate reduction: **2,871 bytes / 11.4519%**;
- largest case `mismatch-all-packages`: `10,033 → 8,897` bytes; largest saving
  `satisfied-all-packages`: `1,153` bytes.

`contract.inspect` is unchanged by this work and remains frozen in
[`contract-inspect-compaction-v1.json`](contract-inspect-compaction-v1.json): **184/184** lossless,
`1,070,705 → 708,825` bytes, aggregate reduction **33.7983%**, 0 ties and 0 regressions.

The six unchanged Search cases are responses with no repeated evidence reference (no-match and
single-reference shapes) and the one unchanged `plugin.check` case declares no requirements. They keep
canonical JSON byte for byte, which is the serializer policy working as designed rather than a case
that failed to improve.

## Decline decision

Five operations deliberately keep canonical Protocol v1 text: `target.resolve`, `plugin.verify`,
`plugin.verify.start`, `operation.get` and `operation.cancel`. None of them carries a repeated evidence
graph, so the only mechanism available to them is eliding the success envelope and adding a
representation identity. Measured on their canonical examples, that is worth at most `5` bytes, and
their largest recoverable duplication — every repeated string scalar, ignoring the reference table a
real projection would pay for — is `185` bytes on `operation.get`. Three of the five are additionally
withheld from the default agent surface.

The decision is bounded rather than asserted: the gate carries a `256`-byte duplication ceiling and a
`19`-byte envelope ceiling, so a declined operation that could actually be compacted fails the gate and
forces the decline to be revisited. The registry is exhaustive over the registered native tools, so a
new operation cannot reach a model unclassified.

## What this establishes — and does not

It establishes a semantically equivalent model-facing representation for three operations, exact
lossless round-trip parity on the measured populations, strict byte reduction wherever a response
repeats an evidence id, zero byte regressions anywhere, and a measured, mechanical decline rule for
the remaining operations.

It does **not** establish provider token savings, billed-token reduction, wall-time improvement,
model-quality improvement or end-to-end task success. No tokenizer or provider is part of this
measurement boundary, and byte counts must not be relabeled as tokens. Any provider/model experiment
must be separately specified and authorized, and H2 remains frozen: its tasks are not development
material and it must not be rerun.

## Next boundary

The remaining post-H2 lane items are separate work: installing the Toolchain operating policy with the
capability, and a disclosed public development ablation of the lean against the full surface. Provider
backed measurement of compaction impact, progressive disclosure and pagination remain deferred to
their own designs.
