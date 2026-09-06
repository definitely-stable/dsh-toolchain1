# Contract Inspect lossless compaction — 2026-09-06

## Status

**COMPLETE / PROVIDER-FREE PRODUCT MEASUREMENT** for the frozen rc2 Web fixture, pending the enclosing PR's full exact-head CI/merge gate.

This result measures the production model-facing `contract.inspect` serializer introduced by #186 / PR #187. It does not change canonical Toolchain Protocol v1 responses, Search ranking, `dsh-target-v2`, or `dsh-contract-index-v1`.

Canonical machine receipt: [`contract-inspect-compaction-v1.json`](contract-inspect-compaction-v1.json).

## Production boundary

Successful Inspect responses may be projected to `dsh-contract-inspect-compact-v1`, which interns canonical evidence records once and replaces repeated long evidence ids in contract/fact provenance with deterministic local refs (`e0`, `e1`, ...).

The compact-v1 identity implies three fixed canonical success-envelope values rather than repeating them in model text: `protocolVersion='1'`, `status='ok'`, and omitted diagnostics means `[]`. Non-empty diagnostics remain explicit. An independent test-only inverse reconstructs those invariants and must reproduce every frozen successful canonical Inspect response exactly.

Native DSH and MCP use the same model-facing serializer; MCP `structuredContent` and CLI output remain canonical Protocol v1.

The serializer policy is `strictly-smaller-utf8-v1`: compact JSON is used only when its exact UTF-8 `JSON.stringify` payload is strictly smaller than canonical JSON. Ties or regressions fall back to canonical JSON. Failed/stale Inspect responses remain canonical.

## Frozen result

Population: all **184/184** successful Inspect contracts in frozen fixture `rc2-web-v1`.

Production serializer:

- lossless round-trip: **184/184**;
- improved: **184**;
- unchanged: **0**;
- regressed: **0**;
- aggregate bytes: `1,070,705 → 708,825`;
- aggregate reduction: **361,880 bytes / 33.7983%**;
- p50: `4,260 → 3,063` bytes;
- p95: `14,223 → 8,838` bytes;
- max: `44,998 → 23,707` bytes;
- minimum saving: `10` bytes / `1.1806%`;
- p50 saving: `1,219` bytes / `28.6241%`;
- p95 saving: `6,310` bytes / `41.7362%`;
- maximum saving: `21,291` bytes / up to `51.8221%`.

The largest canonical and compacted case is `package:@deepseek-ai/dsh-client-runtime`: `44,998 → 23,707` bytes, saving `21,291` bytes.

The exhaustive acceptance gate additionally requires strict byte reduction for every frozen successful Inspect containing repeated canonical evidence references. The final representation satisfies that gate; no frozen response needs serializer fallback. Separate synthetic tests retain canonical fallback coverage for no-benefit and pathological short-reference inputs.

An intermediate development shape had exposed a 43-byte regression on the smallest frozen repeated-reference case. That RED evidence was not accepted or hidden: redundant success-envelope invariants were removed from compact-v1, after which the exhaustive final measurement reached `184 / 0 / 0` improved/unchanged/regressed.

## Duplication attribution

Across the canonical Inspect population, the largest exact repeated-string source is evidence references: **334,887 repeated scalar bytes across 5,364 repeated occurrences**. Other notable categories are fact keys (`66,811` bytes), evidence record ids (`62,771` bytes), and other repeated strings (`23,421` bytes).

This supports the baseline diagnosis that within-Inspect provenance duplication, rather than Search payload size or Search→Inspect overlap, is the correct first production compaction target.

## What this establishes

The change establishes a semantically equivalent model-facing representation with deterministic exact-byte reduction on every frozen Inspect response and no observed wire-byte regression. It preserves canonical evidence ids/records and exact target/index provenance after expansion.

It does **not** establish provider token savings, billed-token reduction, wall-time improvement, model-quality improvement, or end-to-end task success. No tokenizer or provider is part of this measurement boundary. Any provider/model experiment must be separately specified and authorized.

## Next boundary

After PR #187 is merged, Contract Search v3 and Inspect compaction should remain frozen unless new independent evidence justifies another change. Do not rerun H1 or disclosed development evaluations to obtain preferred outcomes.

The next product-level roadmap work remains isolated runtime verification (`plugin.verify`, M4). A provider-backed compaction measurement, if desired, is a separate measurement task and must not block M4.
