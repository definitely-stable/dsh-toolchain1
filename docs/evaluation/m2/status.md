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
| H1 | **864/864; INCONCLUSIVE / IMMUTABLE** | `227/576` B/C observations unresolved under the preregistered path. Never rerun or relabel. |
| H1 corpus | **DISCLOSED / DEVELOPMENT_ONLY** | Never reusable as unseen H2 evidence. |
| Contract Search v3 | **FROZEN** | R2-dev cumulative vs v2: 4 wins / 0 losses / 14 ties. No further disclosed-corpus ranking/proximity tuning is authorized. |
| Staged dev-v1 | **COMPLETE / UNINFORMATIVE** | Run `33939213526`: selector chose 20/20 `api-absent` tasks; zero delta is selection-bias evidence, not Toolchain equivalence. |
| Staged dev-v2 | **EXECUTED / METHODOLOGY DEFECT EXPOSED** | Run `33948582894`: B exhausted the frozen 31-tool budget on 2/8 canary tasks, C completed 8/8 and used Toolchain 8/8; report-v2 incorrectly projected those B terminals as measurement failure. |
| Product/measurement separation | **PR #183** | Evaluation-only repair: explicit bounded product terminals, health-v2, report-v3 bounded metrics, safe per-observation receipts. No production `src/` or ranker changes. |
| Exact Target Plugin Check alpha | **COMPLETE** | Static/read-only exact-target plugin verdict path is merged. |
| H2 | **NOT READY** | Requires a fresh hidden dataset and independently specified end-to-end success endpoint before outcomes exist. |

## Canonical receipts

- H1: [`h1-terminal-outcome-2026-09-02.md`](h1-terminal-outcome-2026-09-02.md)
- accepted staged measurement repair: [`staged-measurement-repair-acceptance-2026-09-04.md`](staged-measurement-repair-acceptance-2026-09-04.md)
- dev-v1: [`staged-dev-v1-outcome-2026-09-05.md`](staged-dev-v1-outcome-2026-09-05.md)
- frozen dev-v2 selection: [`staged-dev-v2-selection.json`](staged-dev-v2-selection.json)
- original dev-v2 outcome: [`staged-dev-v2-outcome-2026-09-05.md`](staged-dev-v2-outcome-2026-09-05.md)
- current staged semantics: [`staged-evaluation.md`](staged-evaluation.md)

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

## Next permitted engineering work

After PR #183 is merged and the exact merge SHA passes post-merge `main` CI, the next recommended workstream is **Contract Search / Inspect compactness evidence**, not another ranking tweak.

The first compactness phase must be **measurement-only** and must not alter production output yet. It should establish, on frozen deterministic fixtures and retained safe staged telemetry where available:

- serialized bytes and approximate model-token footprint returned by `toolchain_contract_search` and `toolchain_contract_inspect`;
- useful-evidence density: evidence-bearing fields per returned byte/token;
- duplicate/repeated content within a single tool response;
- overlap between consecutive Search → Inspect responses for the same contract/evidence path;
- repeated context across turns attributable to Toolchain results;
- per-tool and per-task distributions (median, p90/p95, maxima), not only averages;
- strict semantic parity checks proving any later compaction candidate preserves contract ids, ranking/order, evidence ids, target binding, fail-closed behavior and inspectability.

Only after that baseline exists should a separate production-compaction proposal be considered. Do not change IDF, coherence, abstention, proximity, target identity, Contract Index fingerprint semantics, or the 31-call staged budget in the compactness-baseline phase.

## H2 boundary

H2 remains a separate confirmatory experiment. Before any H2 provider outcome exists, freeze at minimum: product candidate, exact target, hidden dataset commitment, B/C capability boundary, model/provider/reasoning identity, independent primary and guardrail outcomes, repetition/retry/resource policy, and statistical decision rules.
