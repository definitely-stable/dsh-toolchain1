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
| One-dispatch staged runner | **IMPLEMENTED / CANARY PENDING** | Issue #151 / PR #175 provide the closed B/C canary-first runner, real OpenCode Go executor and manual workflow; acceptance still requires inspection of a real 16-call provider canary. |
| Exact Target Plugin Check alpha | **COMPLETE** | Issue #154 / PR #173 implement the first one-call product flow for directory and packed subjects across CLI/native/MCP with evidence-backed static verdicts and real packed-DSH smoke. |
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

The implemented development lifecycle is:

```text
deterministic checks
    -> one bounded mode
    -> fresh managed-provider probe
    -> 16-call B/C canary
    -> measurement-health STOP or PASS
    -> only the pre-authorized remainder
    -> product + cost report
```

PR #175 now contains the deterministic schedule, structured-result transport, exact B/C development executor, fresh process/retry boundary, one-command runner and manual **M2 Staged Development Evaluation** workflow. Required repository CI remains provider-free. The implementation is not yet accepted as provider-ready until a real 16-call provider canary is executed and its run-local evidence is inspected.

If that canary returns `STOP`, zero remainder calls are authorized. A `PASS` only validates the development measurement path and may authorize the remainder of the already selected bounded mode; it is not an H2 result.

The disclosed H1 tasks may be used as `DEVELOPMENT_ONLY` calibration/regression data for this work. They are not confirmatory evidence after disclosure. H1 remains immutable and MUST NOT be rerun.

A future H2 is permitted only after the structured measurement path is healthy, the product candidate is frozen, and a fresh hidden task set plus stopping/analysis rules are preregistered before outcomes exist.

## Exact Target Plugin Check alpha

Issue #154 / PR #173 implement the first one-call product path:

```text
plugin subject + exact TargetSnapshot + target-bound ContractIndex
    -> normalized static analysis
    -> evidence-backed compatibility diagnostics
```

The alpha accepts explicit directory and packed `.tgz` subjects, shares one kernel/application operation across CLI, native DSH and MCP, and reports `compatible-in-scope`, `incompatible`, or `unproven` without forcing unknown evidence into pass/fail. Requirement findings are bound to exact target/contract provenance, malformed subjects preserve semantic diagnostics where possible, and stale target/index evidence cannot produce a successful compatibility claim.

The safety boundary remains static and read-only: candidate plugin code/lifecycle scripts are not executed, and runtime verification remains an M4 responsibility. CI proves the exact packed Toolchain artifact can perform the operation against a real supported DSH train without mutating the active profile.

The shipped Agent Skill now prefers `plugin.check` as the default post-edit/static-review workflow. Contract search/inspect remain the drill-down surfaces when a diagnostic requires contract-level investigation.

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

1. complete PR #175 acceptance with exactly one real 16-call staged provider canary and inspect its report before authorizing any larger staged mode;
2. finish and merge the R2 development boundary in #164 / PR #165 without production ranking changes;
3. continue Contract Search v3 through separately reviewed ranking-changing PRs using R2-dev while retaining R1 invariants;
4. grow M3 diagnostics only from reproduced plugin failure fixtures while preserving the shared `plugin.check` semantics and static/read-only boundary;
5. freeze a fresh R2 holdout and later H2 only after measurement transport and the product candidate are stable.

No additional H1 execution is a permitted next step.
