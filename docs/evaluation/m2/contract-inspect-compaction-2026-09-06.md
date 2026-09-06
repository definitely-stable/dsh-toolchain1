# Contract Inspect lossless compaction — 2026-09-06

## Status

**COMPLETE / PROVIDER-FREE PRODUCT MEASUREMENT** for the frozen rc2 Web fixture, pending the enclosing PR's full exact-head CI/merge gate.

This result measures the production model-facing `contract.inspect` serializer introduced by #186 / PR #187. It does not change canonical Toolchain Protocol v1 responses, Search ranking, `dsh-target-v2`, or `dsh-contract-index-v1`.

Canonical machine receipt: [`contract-inspect-compaction-v1.json`](contract-inspect-compaction-v1.json).

## Production boundary

Successful Inspect responses may be projected to `dsh-contract-inspect-compact-v1`, which interns canonical evidence records once and replaces repeated long evidence ids in contract/fact provenance with deterministic local refs (`e0`, `e1`, ...).

The projection is lossless. An independent test-only inverse must reproduce every frozen successful canonical Inspect response exactly. Native DSH and MCP use the same model-facing serializer; MCP `structuredContent` and CLI output remain canonical Protocol v1.

The serializer policy is `strictly-smaller-utf8-v1`: compact JSON is used only when its exact UTF-8 `JSON.stringify` payload is strictly smaller than canonical JSON. Ties or regressions fall back to canonical JSON. Failed/stale Inspect responses remain canonical.

## Frozen result

Population: all **184/184** successful Inspect contracts in frozen fixture `rc2-web-v1`.

Production serializer:

- improved: **183**;
- unchanged: **1**;
- regressed: **0**;
- aggregate bytes: `1,070,705 → 718,534`;
- aggregate reduction: **352,171 bytes / 32.8915%**;
- p50: `4,260 → 3,116` bytes;
- p95: `14,223 → 8,891` bytes;
- max: `44,998 → 23,760` bytes;
- p50 saving: `1,166` bytes / `27.2727%`;
- p95 saving: `6,257` bytes / `41.3416%`;
- maximum saving: `21,238` bytes / up to `51.5883%`.

The largest canonical and compacted case is `package:@deepseek-ai/dsh-client-runtime`: `44,998 → 23,760` bytes, saving `21,238` bytes.

The raw compact projection itself improves 183 cases but would make the minimal `package:@deepseek-ai/dsh` case 43 bytes larger. The production serializer therefore returns canonical JSON for that no-benefit case. This is the reason the production result has one unchanged case and zero regressions.

## Duplication attribution

Across the canonical Inspect population, the largest exact repeated-string source is evidence references: **334,887 repeated scalar bytes across 5,364 repeated occurrences**. Other notable categories are fact keys (`66,811` bytes), evidence record ids (`62,771` bytes), and other envelope/enum strings (`23,421` bytes).

This supports the baseline diagnosis that within-Inspect provenance duplication, rather than Search payload size or Search→Inspect overlap, is the correct first production compaction target.

## What this establishes

The change establishes a semantically equivalent model-facing representation with deterministic exact-byte reduction and no observed wire-byte regression on the exhaustive frozen population. It preserves canonical evidence ids/records and exact target/index provenance after expansion.

It does **not** establish provider token savings, billed-token reduction, wall-time improvement, model-quality improvement, or end-to-end task success. No tokenizer or provider is part of this measurement boundary. Any provider/model experiment must be separately specified and authorized.

## Next boundary

After PR #187 is merged, Contract Search v3 and Inspect compaction should remain frozen unless new independent evidence justifies another change. Do not rerun H1 or disclosed development evaluations to obtain preferred outcomes.

The next product-level roadmap work remains isolated runtime verification (`plugin.verify`, M4). A provider-backed compaction measurement, if desired, is a separate measurement task and must not block M4.
