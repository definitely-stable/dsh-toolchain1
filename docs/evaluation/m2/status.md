# M2.3 operational status

This file is the **current operational index** for M2.3 and post-H1 evaluation work. It records the immutable historical evidence, the current development boundary, and the work that is permitted next.

It is not a normative contract and does not redefine Protocol, target identity, Contract Index semantics, historical H1 rules, or accepted ADRs. Normative specifications remain under `spec/`; accepted architectural decisions remain under `docs/decisions/`; capability sequencing remains in [`docs/roadmap.md`](../../roadmap.md).

## Frozen M2.3 target

The historical R1/P0/H1 evidence remains bound to the registry-installable Web target used by the controlled experiment:

- DSH: `@deepseek-ai/dsh@0.1.1-rc.2`;
- profile: `web`;
- target: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`;
- Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.

Later upstream DSH trains are a separate compatibility track. They MUST NOT retroactively mutate the frozen experiment or its evidence identities.

## Current state

| Item | State | Meaning |
| --- | --- | --- |
| M2.1 offline Contract Index | **COMPLETE** | Exact-target package/declaration acquisition, deterministic search/inspect and stale-safe index identity are merged. |
| M2.2 Agent-scoped Host Inspect enrichment | **COMPLETE** | Bounded live Host Service/Event/Tool evidence with fail-closed target binding is merged. |
| Historical R1 baseline | **COMPLETE / IMMUTABLE** | Pre-tuning retrieval baseline remains regression evidence. |
| Historical provider-backed P0 | **INCONCLUSIVE / IMMUTABLE** | Retained live calibration evidence; not a pending rerun. |
| Corrected offline P0 readjudication | **COMPLETE** | Separately versioned calibration evidence; it does not rewrite historical P0. |
| H1 design / preregistration / execution machinery | **COMPLETE** | The controlled 96-task, 864-entry experiment was fully constructed and executed. |
| H1 execution | **COMPLETE: 864 / 864** | All scheduled H1 outcomes were executed. |
| H1 terminal result | **INCONCLUSIVE / IMMUTABLE** | Confirmatory estimates were intentionally not computed because the frozen measurement path left unresolved decision evidence. |
| H1 unresolved B/C observations | **227 / 576** | Measurement-resolution failure that invalidated confirmatory interpretation. |
| H1 corpus | **DISCLOSED / DEVELOPMENT_ONLY** | May be used for development, calibration and regression work; MUST NOT be reused as an unseen H2 holdout. |
| Contract Search v2 | **MERGED** | Deterministic intent fallback materially improves the historical R1 retrieval gap while preserving strict/no-result behavior. |
| Contract Search v3 foundation | **MERGED** | Derived SearchIndex, explainability and bounded fingerprint cache preserve v2 rank/score/evidence behavior. |
| Contract Search v3 R2-dev boundary | **IN DEVELOPMENT** | Issue #164 / PR #165 establish a new development corpus before any v3 ranking change. |
| Staged evaluation control plane | **IN DEVELOPMENT** | Issue #149 / PR #150 replace H1-scale manual development runs with bounded canary-first evaluation. |
| One-dispatch staged runner | **PENDING** | Issue #151 owns structured-result transport and automatic STOP/PASS execution. |
| Exact Target Plugin Check alpha | **IN DEVELOPMENT** | Issue #154 / PR #158 is the first one-call product flow and may proceed without rerunning H1. |
| Parent M2 exit | **OPEN** | Historical H1 did not establish the preregistered PASS claim; M2 therefore remains open without authorizing a rerun of H1. |

## Canonical H1 terminal outcome

The canonical terminal record is [`h1-terminal-outcome-2026-09-02.md`](h1-terminal-outcome-2026-09-02.md).

H1 completed all `864 / 864` scheduled outcomes. Its scientific status is `INCONCLUSIVE`, not an Actions failure and not a `NEEDS-IMPROVEMENT` product verdict. The frozen decision path left `227 / 576` B/C observations unresolved, so the preregistered paired confirmatory estimates were not computed.

The H1 result is historical evidence and MUST NOT be changed, relabeled, extended until a preferred result appears, or rerun as a fresh holdout after task disclosure.

## Historical R1 and retrieval development

The immutable R1 baseline measured a real retrieval gap before retrieval tuning:

- Success@5: **56.25%**;
- MRR: **54.6875%**;
- natural-language Success@5: **0%**;
- indirect Success@5: **0%**;
- forbidden-hit rate@5: **20%**.

Evidence-sufficiency checks established that the answerable routes existed in the authoritative declaration universe, so these failures were retrieval failures rather than missing-evidence excuses.

Contract Search v2 subsequently improved the historical regression corpus while preserving exact/no-result behavior. Contract Search v3 now develops from that proven v2 baseline.

R1 is regression evidence only. It MUST NOT be used to select v3 IDF/field/coherence/abstention constants. Issue #160 requires a separate R2 development corpus before production ranking changes, and a future fresh R2 holdout remains unseen during tuning.

## Post-H1 evaluation boundary

H1 demonstrated that development evaluation needs to validate measurement health before spending a large provider budget. Issue #149 therefore replaces ordinary H1-style manual chunking with bounded modes and an early health gate.

The intended development lifecycle is:

```text
deterministic checks
    -> bounded mode
    -> 16-call B/C canary
    -> measurement-health STOP or PASS
    -> only the pre-authorized remainder
    -> product + cost report
```

The disclosed H1 tasks may be used as `DEVELOPMENT_ONLY` calibration/regression data for this work. They are not confirmatory evidence after disclosure.

A future H2 is permitted only after the structured measurement path is healthy, the product candidate is frozen, and a fresh hidden task set plus stopping/analysis rules are preregistered before outcomes exist.

## Exact Target Plugin Check may proceed

The `INCONCLUSIVE` H1 result does not require product development to stop until H1 is rerun. Issue #154 owns the first one-call product path:

```text
plugin subject + exact TargetSnapshot + target-bound ContractIndex
    -> normalized static analysis
    -> evidence-backed compatibility diagnostics
```

This alpha MUST remain read-only and MUST NOT execute/import candidate plugin code. Runtime proof remains an M4 verification responsibility.

The alpha may reuse the current production Contract Search behavior. It does not need to wait for every Contract Search v3 ranking phase, provided it remains bound to the exact target/index evidence and does not duplicate search/compatibility semantics in frontends.

## Explicit prohibitions

- do not rerun H1 to obtain a different terminal label;
- do not reuse the disclosed H1 corpus as the future H2 holdout;
- do not reinterpret historical P0 or H1 evidence under product-tuned rules;
- do not tune v3 ranking constants on R1;
- do not change `dsh-target-v2` or `dsh-contract-index-v1` retroactively to accommodate a later upstream train;
- do not infer `verified` runtime compatibility from static Plugin Check;
- do not make required repository CI depend on external model/provider calls;
- do not mix Issue #33 upstream lifecycle compatibility work into the frozen rc.2 experiment evidence.

## Next permitted work

The current implementation order is:

1. finish and merge the R2 development boundary in #164 / PR #165 without production ranking changes;
2. continue Contract Search v3 through separately reviewed ranking-changing PRs using R2-dev while retaining R1 invariants;
3. finish the staged evaluation control plane (#149) and one-dispatch structured canary runner (#151) before any future confirmatory H2;
4. rebase/rebuild Exact Target Plugin Check (#154) on the current product baseline and complete the smallest source-directory static vertical slice;
5. freeze a fresh R2 holdout and later H2 only after measurement transport and the product candidate are stable.

No additional H1 execution is a permitted next step.
