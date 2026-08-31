# M2.3 operational status

This file is the **current operational index** for the M2.3 exit experiment. It answers what is complete, what historical evidence is immutable, what remains blocked, and what action is permitted next.

It is not a normative contract and does not redefine Protocol, target identity, Contract Index semantics, measurement rules, or the H1 experiment. Normative specifications remain under `spec/`; accepted architectural decisions remain under `docs/decisions/`; capability sequencing remains in [`docs/roadmap.md`](../../roadmap.md). The detailed H1 publication barrier is defined by [`h1-preregistration-publication-v2.md`](h1-preregistration-publication-v2.md).

## Frozen M2.3 target

The controlled M2.3 evaluation remains bound to the registry-installable Web target used by the existing R1/P0 evidence:

- DSH: `@deepseek-ai/dsh@0.1.1-rc.2`;
- profile: `web`;
- target: `dsh-target-v2:42e2fb68eb872295076c826d207c06308ac0748d1153647dd620e1ece3126fbe`;
- Contract Index: `dsh-contract-index-v1:e4e873f597349309f365154a2f43b0a3556d0c77dc56c3ede3ed7ab03a5e82b2`.

Upstream `dsh-v0.1.2-alpha.1` / `profile.patchReload` compatibility remains a separate Issue #33 track and must not mutate the frozen rc.2 experiment.

## Current gate state

| Gate | State | Evidence / meaning |
| --- | --- | --- |
| M2.1 offline Contract Index | **COMPLETE** | Merged exact-target Contract Index/search/inspect semantics. |
| M2.2 Agent-scoped Host Inspect enrichment | **COMPLETE** | Merged bounded live Host Service/Event/Tool evidence with fail-closed target binding. |
| R1 deterministic retrieval baseline | **COMPLETE** | Frozen real-target corpus/index and immutable first-run report exist. |
| R1 Success@5 | **56.25%** | Measured before retrieval tuning. |
| R1 MRR | **54.6875%** | Measured before retrieval tuning. |
| R1 natural-language | **0%** | Evidence-sufficiency checks classify these misses as retrieval gaps, not acquisition gaps. |
| R1 indirect | **0%** | Same retrieval-gap conclusion as above. |
| R1 forbidden-hit rate@5 | **20%** | Frozen baseline diagnostic. |
| Real provider-backed P0 execution | **COMPLETE** | Retained live run executed the frozen 72-entry schedule; 69 model outcomes were recorded. |
| Historical P0 result | **INCONCLUSIVE — IMMUTABLE** | The historical result is not rewritten or relabeled. |
| Corrected offline P0 readjudication | **COMPLETE** | Deterministic re-adjudication of retained observations under corrected measurement semantics; it does not replace the historical result. |
| Post-P0 measurement correction policy | **FROZEN** | Corrected oracle/adjudication semantics are separated from product retrieval changes and from historical v1 artifacts. |
| H1 MCID | **FROZEN: 0.10** | Required absolute reduction in Invalid API Task Rate, C vs B. |
| H1 task-success non-inferiority margin | **FROZEN: 0.05** | Required guardrail margin. |
| H1 task count | **FROZEN: 96** | Prospective design selection. |
| H1 trials | **FROZEN: 3 per task/arm** | A/B/C balanced trial design. |
| H1 schedule | **FROZEN: 864 entries** | `96 tasks × 3 arms × 3 trials`. |
| H1 analysis | **FROZEN** | Paired-task percentile bootstrap, 95% confidence, 10,000 resamples with frozen seeds. |
| Durable H1 ledger/store/retry model | **IMPLEMENTED** | Hash-chained retry-aware execution state and crash-safe persistence exist. |
| Single-attempt coordinator + resumable schedule | **IMPLEMENTED** | Pending intent, terminal evidence, ledger commit and recovery are ordered and tested. |
| Frozen H1 execution-definition machinery | **IMPLEMENTED** | Exact execution definition and derived attempt inputs are content-addressed/fail-closed. |
| Public preregistration receipt constructor/validator | **IMPLEMENTED** | Synthetic fixtures prove deterministic construction/validation only. |
| H1 managed-gateway provider contract | **IMPLEMENTED** | H1 is fixed to OpenCode Go / `deepseek-v4-flash`; exact endpoint/model/settings/capability receipt is committed without claiming an unobservable backend checkpoint. |
| Real private 96-task H1 dataset | **NOT FINALIZED** | Must be independently reviewed outside public Git before publication. |
| Real managed-gateway provider receipt | **NOT FINALIZED** | One Flash-only provider probe must be selected and retained; it contains no H1 task or prompt. |
| Real finalized H1 commitment/execution definition | **NOT FINALIZED** | Must be produced privately from the reviewed dataset and exact provider receipt. |
| Real public H1 preregistration receipt | **NOT PUBLISHED** | No real receipt currently exists in the repository. |
| H1 provider execution | **PROHIBITED** | No H1 task may be sent to the provider before the publication barrier below is satisfied. |
| M2 exit | **PENDING** | Requires one valid controlled H1 outcome under the frozen rule. |

## Historical P0 is not a pending rerun

The live P0 run is historical evidence, not an unfinished request to obtain a prettier status string. Its canonical status remains `INCONCLUSIVE`.

The post-P0 governance amendment identified measurement-boundary defects and explicitly forbids another live P0 merely to obtain `CALIBRATED`, improve an aggregate, or validate evaluator-only corrections. The retained observations were instead re-adjudicated offline under separately versioned corrected semantics. That derived analysis is calibration evidence and **does not mutate the historical result**.

A new provider-backed calibration would require a separately justified decision-relevant observation that is genuinely absent after offline analysis. It is not part of the normal path to H1.

Relevant artifacts:

- [`agent-comparison-amendment-2026-08-30.md`](agent-comparison-amendment-2026-08-30.md);
- [`p0-readjudication-v2.json`](p0-readjudication-v2.json).

## R1 establishes a measured retrieval problem, not an automatic retrieval redesign

The frozen R1 baseline is strong for exact symbols/package API/no-result behavior but fails the natural-language and indirect categories. Evidence-sufficiency checks prove the answerable routes exist in the frozen authoritative declaration universe, so those misses are real retrieval gaps.

M2.3 deliberately did **not** change production ranking after observing the baseline. The controlled H1 comparison exists to answer the product-level question first: whether an ordinary exact-target coding agent materially reduces invalid API claims when Toolchain search/inspect is available.

Therefore embeddings, semantic reranking, vector databases, benchmark-specific query expansion, or a replacement scorer are not authorized by the R1 numbers alone. If H1 resolves `NEEDS-IMPROVEMENT`, retrieval changes move to a separate bounded slice with the frozen H1 result preserved.

## H1 public authorization barrier

The implementation required to construct, freeze, schedule, persist, recover and validate H1 exists. That is **not equivalent to a real preregistration**.

H1 is intentionally scoped to the observable managed service, not an unverifiable hidden checkpoint: OpenCode Go at `https://opencode.ai/zen/go/v1`, request/response model `deepseek-v4-flash`, thinking enabled, reasoning effort high, verified tool calling, verified reasoning continuation and provider token accounting. The provider receipt is content-addressed; every model outcome must still match response model `deepseek-v4-flash`.

No H1 task may be sent to the provider until all of the following occur in order:

1. finish and independently review the real 96-task H1 dataset privately under [`h1-dataset-construction-policy-v2.md`](h1-dataset-construction-policy-v2.md), with no H1 provider calls;
2. run the single provider-only `deepseek-v4-flash` capability probe, containing no H1 task/prompt, and retain the exact receipt;
3. privately execute the existing finalization path and require the H1 commitment to become `COMMITTED`, readiness to become `READY`, and `runAllowed=true`;
4. privately create the frozen H1 execution definition against the exact ordinary workspace and verify exactly 96 model tasks plus 864 balanced schedule entries at concurrency 1;
5. generate and independently validate the real `dsh-toolchain-m2-h1-preregistration-receipt-v2`;
6. commit that exact real receipt and `receiptSha256` to protected `main` without replacing the pristine BLOCKED source commitment template;
7. bind the publication commit/receipt SHA to an immutable repository ref/tag;
8. only then initialize the canonical durable H1 run store and execute the exact frozen schedule;
9. after terminal resolution, publish the exact hidden dataset bytes and verify that they reproduce the precommitted dataset/model-task projection hashes.

Until steps 1–7 complete, **H1 provider execution remains prohibited**.

## M2 exit routing

The frozen H1 result controls the next product action.

### `PASS`

A valid H1 meets both frozen requirements:

- paired confidence lower bound for C-vs-B absolute Invalid API Task Rate reduction meets MCID `0.10`;
- paired task-success lower bound satisfies the `0.05` non-inferiority margin.

Then M2.3 / #34 and parent M2 / #28 may close, and the next product slice is the smallest **Exact Target Plugin Check alpha** path described in the roadmap.

### `NEEDS-IMPROVEMENT`

The controlled experiment is valid and complete but fails the primary rule or guardrail. Freeze the result, keep M2 open, and open one separately reviewed retrieval-improvement slice. Do not alter the observed H1 definition/result to make the milestone pass.

### `INCONCLUSIVE`

Preregistered validity criteria prevent interpretation, including incomplete scheduled execution or unresolved decision evidence. Do not rerun until a preferred outcome appears; only the preregistered reserve/extension path may add evidence.

## Explicit non-goals of the current operational gate

- no production `src/**` changes;
- no Protocol/schema changes;
- no change to `dsh-target-v2` or Contract Index identity;
- no retrieval/ranking tuning before H1 justifies a separate slice;
- no modification of historical P0 outputs, v1 oracle artifacts, or pristine H1 commitment templates;
- no synthetic real H1 dataset, provider receipt, preregistration receipt or result;
- no hidden-checkpoint inference or backend-fingerprint requirement for the managed OpenCode Go route;
- no H1 provider execution before the public barrier;
- no M3 plugin validation or M4 runtime verification implementation;
- no mixing Issue #33 `profile.patchReload` lifecycle semantics into the frozen rc.2 experiment.

## Next permitted work

The next substantive M2.3 work is **operational H1 finalization**: finish/review the private 96-task dataset, retain the one real Flash-only provider capability receipt, finalize the real commitment/execution definition, and publish the real preregistration receipt. Only that publication unlocks the single controlled H1 execution.
