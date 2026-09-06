# M2.3 operational status

This file is the **current operational index** for M2.3 and post-H1 evaluation work. It is intentionally concise: immutable historical evidence lives in the linked receipts. This file does not redefine Protocol, target identity, Contract Index semantics, H1, or accepted ADRs.

## Frozen experiment boundary

- DSH: `@deepseek-ai/dsh@0.1.1-rc.2`
- profile: `web`
- target: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`
- Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`
- frozen Contract Search candidate: `dsh-contract-search-v3-conservative-abstention`
- frozen candidate commit: `8eba7eccba77bb3e047868dbad8ea9c9ced3b033`

Later upstream DSH trains are a separate compatibility track. They must not retroactively mutate these evidence identities.

## Current state

| Item | State | Meaning |
| --- | --- | --- |
| M2.1 Contract Index | **COMPLETE** | Exact-target acquisition and deterministic search/inspect are merged. |
| M2.2 Host Inspect enrichment | **COMPLETE** | Bounded live host evidence is merged. |
| R1 | **IMMUTABLE REGRESSION EVIDENCE** | Never tuning data. |
| H1 | **864/864; INCONCLUSIVE / IMMUTABLE** | `227/576` B/C observations unresolved under the preregistered path. H1 MUST NOT be rerun or relabeled. |
| H1 corpus | **DISCLOSED / DEVELOPMENT_ONLY** | Never reusable as unseen H2 evidence. |
| Contract Search v3 | **FROZEN** | R2-dev cumulative vs v2: 4 wins / 0 losses / 14 ties. No further disclosed-corpus ranking/proximity tuning is authorized. |
| One-dispatch staged runner | **COMPLETE / ACCEPTANCE STOP** | Historical run `33763657085` accepted the fail-closed runner: `FORMAT_COMPLIANCE_BELOW_MINIMUM` and `DECISION_RESOLUTION_BELOW_MINIMUM`, with zero authorized remainder. Later measurement repairs do not rewrite this result. |
| Staged dev-v1 | **COMPLETE / UNINFORMATIVE** | Run `33939213526`: selector chose 20/20 `api-absent` tasks; zero delta is selection-bias evidence, not Toolchain equivalence. |
| Staged dev-v2 | **EXECUTED / METHODOLOGY DEFECT EXPOSED** | Run `33948582894`: B exhausted the frozen 31-tool budget on 2/8 canary tasks, C completed 8/8 and used Toolchain 8/8; report-v2 incorrectly projected those B terminals as measurement failure. |
| Product/measurement separation | **COMPLETE** | #183 separated measurement health, bounded product terminals and cost/trajectory evidence without production ranker changes. |
| Contract Search / Inspect compactness baseline | **COMPLETE / MEASUREMENT-ONLY** | Provider-free exhaustive baseline: 36 Search cases, all 184 Inspect contracts and 30 actual Search→top-1 Inspect paths. Inspect, not Search, is the compactness hotspot. |
| Contract Inspect lossless compaction | **COMPLETE / PROVIDER-FREE PRODUCT MEASUREMENT** | #186 / PR #187: 184/184 exact lossless parity; production serializer improves all 184 frozen Inspect responses, 0 ties/regressions; aggregate exact-byte reduction 33.7983%. |
| Exact Target Plugin Check alpha | **COMPLETE** | Static/read-only exact-target plugin verdict path is merged. |
| H2 | **NOT READY** | Requires a fresh hidden dataset and independently specified end-to-end success endpoint before outcomes exist. |

## Canonical receipts

- H1: [`h1-terminal-outcome-2026-09-02.md`](h1-terminal-outcome-2026-09-02.md)
- first one-dispatch canary: [`staged-canary-acceptance-2026-09-03.md`](staged-canary-acceptance-2026-09-03.md)
- accepted staged measurement repair: [`staged-measurement-repair-acceptance-2026-09-04.md`](staged-measurement-repair-acceptance-2026-09-04.md)
- dev-v1: [`staged-dev-v1-outcome-2026-09-05.md`](staged-dev-v1-outcome-2026-09-05.md)
- frozen dev-v2 selection: [`staged-dev-v2-selection.json`](staged-dev-v2-selection.json)
- original dev-v2 outcome: [`staged-dev-v2-outcome-2026-09-05.md`](staged-dev-v2-outcome-2026-09-05.md)
- current staged semantics: [`staged-evaluation.md`](staged-evaluation.md)
- compactness machine receipt: [`contract-compactness-baseline-v1.json`](contract-compactness-baseline-v1.json)
- compactness interpretation: [`contract-compactness-baseline-2026-09-05.md`](contract-compactness-baseline-2026-09-05.md)
- Inspect compaction machine receipt: [`contract-inspect-compaction-v1.json`](contract-inspect-compaction-v1.json)
- Inspect compaction interpretation: [`contract-inspect-compaction-2026-09-06.md`](contract-inspect-compaction-2026-09-06.md)

Historical receipts are append-only. Later methodology must not rewrite their run ids, commits, artifacts, outcomes, or evidence classifications.

## Staged evaluation after PR #183

The control plane separates three evidence planes:

1. **measurement health** — provider/process/finalization trustworthiness;
2. **bounded product outcome** — completed vs recognized resource-budget terminal;
3. **cost/trajectory evidence** — tokens, wall time, turns, provider completions, ordinary/Toolchain tool counts and safe task-level receipts.

The product tool-call budget remains **31**. `tool_budget_exhausted` is a valid product outcome, not infrastructure failure. Genuine malformed structured finalization and unrecovered infrastructure remain fail-closed measurement failures.

`report-v3` retains resolved-only API validity for continuity but adds `boundedCompletion` and `boundedApiSuccess`, so recognized budget exhaustion cannot disappear through complete-case censoring. `taskSuccessGuardrail.measured=false` remains explicit because the current single-API-claim oracle is not an independent end-to-end developer-task grader.

Safe observation receipts may retain task id/domain/oracle kind, arm, bounded terminal, API-validity when available, cost and exact tool-count summaries. They must not persist prompt text, raw model prose, chain-of-thought/reasoning, raw tool arguments/results, workspace contents, credentials, or provider bodies.

## What dev-v2 established — and did not establish

Original run `33948582894` is historically `STOP` under report-v2 and must remain so. It established a concrete harness defect: two B observations hit the same frozen product budget while C reached finalization, but the old transport mapped the bounded B terminal to generic unsupported structured transport.

It does **not** establish either of these claims:

- “Toolchain has no effect” — the complete-case zero API delta used only surviving resolved pairs;
- “Toolchain improves success by 25 pp” — bounded completion was not preregistered as that run's primary endpoint and the 24-call remainder was never authorized.

Do not automatically rerun dev-v2 merely to obtain a preferred classification.

## Compactness baseline result

The deterministic baseline measures the exact UTF-8 bytes of the production `JSON.stringify(response)` text visible through native DSH Search/Inspect tools. Stable serialization is used only for receipt identity. No model-token estimate is published because no pinned tokenizer is part of this evaluation boundary; bytes must not be relabeled as provider-billed tokens.

Key frozen results:

- Search wire bytes: p50 `1,258`, p95 `3,080`, max `3,241`;
- Inspect wire bytes: p50 `4,260`, p95 `14,223`, max `44,998`;
- Inspect exact repeated leaf bytes: p50 `1,761`, p95 `8,048`, max `27,101`;
- Inspect repeated-leaf rate: p50 `40.89%`, p95 `55.15%`, max `65.31%`;
- exact descriptive Inspect content already present in the preceding Search: p50 `7.72%`, p95 `12.17%`, max `14.14%`.

The result classifies **Inspect payload size plus within-response duplication** as the primary compaction signal. Search→Inspect overlap exists but is secondary; Search itself is not the primary bottleneck. Five-token shingle statistics are lexical corroboration only, not semantic equivalence or removable-byte estimates.

## Inspect compaction result

PR #187 implements the first authorized production response to that baseline without changing Protocol v1 or Search. Successful model-facing Inspect text may use lossless `dsh-contract-inspect-compact-v1`, which interns canonical evidence records and replaces repeated long evidence ids with deterministic local refs. Native DSH and MCP share one serializer; MCP `structuredContent` and CLI remain canonical.

The compact-v1 identity implies canonical `protocolVersion='1'`, `status='ok'`, and empty diagnostics when `diagnostics` is omitted. Non-empty diagnostics remain explicit. Independent expansion must recover the exact canonical Protocol v1 value.

The production serializer uses `strictly-smaller-utf8-v1`: compact JSON is emitted only if its exact UTF-8 `JSON.stringify` representation is strictly smaller; otherwise canonical JSON is emitted. Failed/stale results remain canonical.

Frozen provider-free results over all 184 Inspect contracts:

- exact lossless round-trip: `184/184`;
- improved / unchanged / regressed: `184 / 0 / 0`;
- aggregate bytes: `1,070,705 → 708,825`, saving `361,880` bytes (`33.7983%`);
- p50: `4,260 → 3,063` bytes;
- p95: `14,223 → 8,838` bytes;
- max: `44,998 → 23,707` bytes;
- minimum saving: `10` bytes (`1.1806%`);
- p50 saving rate: `28.6241%`; p95 `41.7362%`; max `51.8221%`.

The exhaustive gate requires strict byte reduction for every frozen successful response containing repeated canonical evidence references. Final compact-v1 satisfies it; raw compact projection itself is `184 / 0 / 0` improved/unchanged/regressed, so no frozen response relies on fallback.

Exact repeated-string attribution identifies evidence references as the dominant duplicated scalar category: `334,887` repeated bytes across `5,364` repeated occurrences. This matches the pre-change diagnosis and supports evidence interning as the correct first compaction mechanism.

These are wire-byte measurements, not token/provider claims. No provider, tokenizer, model-quality, wall-time, or end-to-end success conclusion is authorized by this receipt.

## Post-compaction boundary

Contract Search v3 and the lossless Inspect projection should remain frozen after merge unless independent evidence justifies another change. Do not reopen ranking on disclosed R1/R2 data, do not rerun H1, and do not add hidden truncation, lossy summaries, evidence removal or Protocol v2 under the compaction label.

A provider/model measurement of compaction impact is a separate future experiment and requires explicit authorization. It is not required to continue product development.

The next product-level roadmap work remains **M4 isolated runtime verification (`plugin.verify`)**: execute candidate verification only in a disposable exact-target composition, bind receipts to the candidate artifact and TargetSnapshot, preserve cleanup/cancellation/fail-closed semantics, and never reinterpret static `plugin.check` as runtime verification.

## H2 boundary

H2 remains a separate confirmatory experiment. Before any H2 provider outcome exists, freeze at minimum: product candidate, exact target, hidden dataset commitment, B/C capability boundary, model/provider/reasoning identity, independent primary and guardrail outcomes, repetition/retry/resource policy, and statistical decision rules.